// Host side of the engine protocol (src/engine/api.ts).
// The worker process is created through an injected `fork` so this module stays electron-free
// and unit testable; index.ts passes a factory around electron's utilityProcess.fork().
//
// Responsibilities:
// - send `init` first, then queue `run` messages until the worker says `ready`;
// - forward validated JobEvents to `onEvent`;
// - answer `htmlToPdf` requests through the injected adapter;
// - if the worker dies unexpectedly: fail in-flight jobs with INTERNAL and restart it
//   (bounded: at most MAX_RESTARTS within RESTART_WINDOW_MS, then give up until the next job).

import { z } from 'zod'
import type { EngineOptions, HostToWorker } from '../engine/api'
import type { JobError, JobEvent, JobRequest } from '../shared/types'

export interface WorkerLike {
  postMessage(message: HostToWorker): void
  on(event: 'message', listener: (message: unknown) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  kill(): boolean
}

export interface EngineHostDeps {
  fork(): WorkerLike
  options: EngineOptions
  htmlToPdf(html: string): Promise<Uint8Array>
  onEvent(event: JobEvent): void
  /** Optional diagnostics sink (no console noise by default). */
  log?: (message: string) => void
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  now?: () => number
}

export const MAX_RESTARTS = 5
export const RESTART_WINDOW_MS = 60_000
export const RESTART_DELAY_MS = 500

const jobErrorSchema = z.object({
  code: z.enum([
    'UNSUPPORTED',
    'INPUT_NOT_FOUND',
    'INPUT_INVALID',
    'OUTPUT_NOT_WRITABLE',
    'TOOL_MISSING',
    'TOOL_FAILED',
    'MODEL_DOWNLOAD_FAILED',
    'CANCELLED',
    'INTERNAL'
  ]),
  message: z.string(),
  detail: z.string().optional()
})

export const jobEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('queued'), jobId: z.string() }),
  z.object({ type: z.literal('progress'), jobId: z.string(), progress: z.number(), stage: z.string().optional() }),
  z.object({ type: z.literal('done'), jobId: z.string(), outputPaths: z.array(z.string()) }),
  z.object({ type: z.literal('error'), jobId: z.string(), error: jobErrorSchema })
])

const workerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('event'), event: jobEventSchema }),
  z.object({ type: z.literal('htmlToPdf'), requestId: z.string(), html: z.string() })
])

export const CRASH_ERROR: JobError = {
  code: 'INTERNAL',
  message: 'The converter stopped unexpectedly. Please try again.'
}

export const UNAVAILABLE_ERROR: JobError = {
  code: 'INTERNAL',
  message: "The converter couldn't start. Please restart Let us drag!."
}

export class EngineHost {
  private worker: WorkerLike | null = null
  private ready = false
  private stopping = false
  private gaveUp = false
  private restartTimer: unknown = null
  private crashTimes: number[] = []
  /** Jobs accepted but not yet sent to the worker (worker not ready). */
  private pending: JobRequest[] = []
  /** Jobs sent to the worker and not finished yet. */
  private readonly dispatched = new Set<string>()

  constructor(private readonly deps: EngineHostDeps) {}

  private get setTimer(): (fn: () => void, ms: number) => unknown {
    return this.deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  }

  private get clearTimer(): (h: unknown) => void {
    return this.deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  get isReady(): boolean {
    return this.ready
  }

  /** Jobs that have not finished yet (queued in host or running in the worker). */
  get inFlight(): string[] {
    return [...this.pending.map((r) => r.id), ...this.dispatched]
  }

  isInFlight(jobId: string): boolean {
    return this.dispatched.has(jobId) || this.pending.some((r) => r.id === jobId)
  }

  start(): void {
    if (this.worker || this.stopping) return
    this.ready = false
    let worker: WorkerLike
    try {
      worker = this.deps.fork()
    } catch (err) {
      this.deps.log?.(`engine fork failed: ${String(err)}`)
      this.handleExit(null)
      return
    }
    this.worker = worker
    worker.on('message', (m) => this.handleMessage(worker, m))
    worker.on('exit', (code) => {
      if (this.worker !== worker) return
      this.deps.log?.(`engine exited with code ${code}`)
      this.handleExit(worker)
    })
    worker.postMessage({ type: 'init', options: this.deps.options })
  }

  /** Accept a job. Throws if a job with the same id is still running. */
  run(req: JobRequest): void {
    if (this.stopping) {
      this.emit({ type: 'error', jobId: req.id, error: UNAVAILABLE_ERROR })
      return
    }
    if (this.isInFlight(req.id)) throw new Error(`Job ${req.id} is already running`)
    if (this.gaveUp) {
      // Give the worker another chance for this new job.
      this.gaveUp = false
      this.crashTimes = []
      this.start()
    }
    if (this.ready && this.worker) this.dispatch(this.worker, req)
    else this.pending.push(req)
  }

  cancel(jobId: string): void {
    const idx = this.pending.findIndex((r) => r.id === jobId)
    if (idx >= 0) {
      this.pending.splice(idx, 1)
      this.emit({ type: 'error', jobId, error: { code: 'CANCELLED', message: 'Cancelled.' } })
      return
    }
    if (this.dispatched.has(jobId) && this.worker) {
      this.worker.postMessage({ type: 'cancel', jobId })
    }
  }

  stop(): void {
    this.stopping = true
    if (this.restartTimer !== null) this.clearTimer(this.restartTimer)
    this.restartTimer = null
    const w = this.worker
    this.worker = null
    this.ready = false
    this.pending = []
    this.dispatched.clear()
    if (w) {
      try {
        w.kill()
      } catch {
        // already gone
      }
    }
  }

  private dispatch(worker: WorkerLike, req: JobRequest): void {
    this.dispatched.add(req.id)
    worker.postMessage({ type: 'run', req })
  }

  private emit(event: JobEvent): void {
    try {
      this.deps.onEvent(event)
    } catch (err) {
      this.deps.log?.(`onEvent listener threw: ${String(err)}`)
    }
  }

  private handleMessage(worker: WorkerLike, raw: unknown): void {
    if (this.worker !== worker) return
    const parsed = workerMessageSchema.safeParse(raw)
    if (!parsed.success) {
      this.deps.log?.('engine sent an invalid message')
      return
    }
    const msg = parsed.data
    switch (msg.type) {
      case 'ready': {
        this.deps.log?.('engine ready')
        this.ready = true
        const queue = this.pending
        this.pending = []
        for (const req of queue) this.dispatch(worker, req)
        return
      }
      case 'event': {
        const ev = msg.event as JobEvent
        if (!this.dispatched.has(ev.jobId)) return // unknown / already finished job
        if (ev.type === 'done' || ev.type === 'error') this.dispatched.delete(ev.jobId)
        this.emit(ev)
        return
      }
      case 'htmlToPdf': {
        const { requestId, html } = msg
        this.deps
          .htmlToPdf(html)
          .then(
            (pdf) => ({ type: 'htmlToPdf:result', requestId, pdf }) as const,
            (err: unknown) => ({ type: 'htmlToPdf:result', requestId, error: err instanceof Error ? err.message : String(err) }) as const
          )
          .then((reply) => {
            if (this.worker === worker) worker.postMessage(reply)
          })
        return
      }
    }
  }

  private handleExit(worker: WorkerLike | null): void {
    if (worker && this.worker !== worker) return
    this.worker = null
    this.ready = false
    for (const jobId of [...this.dispatched]) {
      this.dispatched.delete(jobId)
      this.emit({ type: 'error', jobId, error: CRASH_ERROR })
    }
    if (this.stopping) return
    const now = this.now()
    this.crashTimes = [...this.crashTimes.filter((t) => now - t < RESTART_WINDOW_MS), now]
    if (this.crashTimes.length > MAX_RESTARTS) {
      this.gaveUp = true
      const queue = this.pending
      this.pending = []
      for (const req of queue) this.emit({ type: 'error', jobId: req.id, error: UNAVAILABLE_ERROR })
      return
    }
    const delay = RESTART_DELAY_MS * this.crashTimes.length
    this.restartTimer = this.setTimer(() => {
      this.restartTimer = null
      this.start()
    }, delay)
  }
}
