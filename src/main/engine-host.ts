// Host side of the engine protocol (src/engine/api.ts).
// The worker process is created through an injected `fork` so this module stays electron-free
// and unit testable; app.ts passes a factory around electron's utilityProcess.fork().
//
// Responsibilities:
// - send `init` first (declaring the optional host adapters we serve), then queue `run`
//   messages until the worker says `ready`;
// - forward validated JobEvents to `onEvent`;
// - answer `htmlToPdf` and `renderPdf` requests through the injected adapters;
// - if the worker dies unexpectedly: fail in-flight jobs with INTERNAL and restart it
//   (bounded: at most MAX_RESTARTS within RESTART_WINDOW_MS, then give up until the next job);
// - watchdog (synchronous parsers inside the worker cannot be interrupted): if a cancelled job
//   has not finished CANCEL_GRACE_MS after the cancel, or a job runs longer than JOB_HARD_TIMEOUT_MS,
//   kill the worker, report CANCELLED (cancelled jobs) / INTERNAL (all other in-flight jobs) and
//   start a fresh worker right away. Deliberate kills do not count as crashes.

import { z } from 'zod'
import type { EngineOptions, HostAdapterName, HostToWorker, PdfRenderOptions } from '../engine/api'
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
  /** Optional: rasterise PDF pages (declared to the worker as host adapter 'renderPdfPages'). */
  renderPdfPages?(pdf: Uint8Array, options: PdfRenderOptions, signal: AbortSignal): Promise<Uint8Array[]>
  onEvent(event: JobEvent): void
  /** Optional diagnostics sink (no console noise by default). */
  log?: (message: string) => void
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  now?: () => number
  /** Watchdog tuning (tests). */
  cancelGraceMs?: number
  jobHardTimeoutMs?: number
}

export const MAX_RESTARTS = 5
export const RESTART_WINDOW_MS = 60_000
export const RESTART_DELAY_MS = 500
/** A cancelled job must report back within this time, or the worker is killed. */
export const CANCEL_GRACE_MS = 5_000
/** The engine gives up on a job after 30 minutes (src/engine/jobs.ts); we allow 2 more. */
export const JOB_HARD_TIMEOUT_MS = 32 * 60_000

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

const requestIdSchema = z.string().min(1).max(128)

const workerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('event'), event: jobEventSchema }),
  z.object({ type: z.literal('htmlToPdf'), requestId: requestIdSchema, html: z.string() }),
  z.object({
    type: z.literal('renderPdf'),
    requestId: requestIdSchema,
    pdf: z.instanceof(Uint8Array),
    options: z.object({ scale: z.number(), maxSide: z.number(), maxPixels: z.number() })
  })
])

export const CRASH_ERROR: JobError = {
  code: 'INTERNAL',
  message: 'The converter stopped unexpectedly. Please try again.'
}

export const UNAVAILABLE_ERROR: JobError = {
  code: 'INTERNAL',
  message: "The converter couldn't start. Please restart Let us drag!."
}

export const CANCELLED_ERROR: JobError = { code: 'CANCELLED', message: 'Cancelled.' }

export const HUNG_ERROR: JobError = {
  code: 'INTERNAL',
  message: 'This took too long, so I gave up. Try a smaller file.'
}

export const RESTARTED_ERROR: JobError = {
  code: 'INTERNAL',
  message: 'The converter had to restart. Please try again.'
}

interface Watch {
  timer: unknown
  started: boolean
  cancelRequested: boolean
  cancelTimer: unknown
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
  /** Jobs sent to the worker and not finished yet, with their watchdog state. */
  private readonly dispatched = new Map<string, Watch>()
  /** Aborts adapter work (e.g. PDF rendering) requested by the current worker when it goes away. */
  private adapterAbort = new AbortController()

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
    return [...this.pending.map((r) => r.id), ...this.dispatched.keys()]
  }

  isInFlight(jobId: string): boolean {
    return this.dispatched.has(jobId) || this.pending.some((r) => r.id === jobId)
  }

  /** Host adapters declared to the worker in 'init'. */
  get hostAdapters(): HostAdapterName[] {
    return this.deps.renderPdfPages ? ['renderPdfPages'] : []
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
    this.adapterAbort = new AbortController()
    worker.on('message', (m) => this.handleMessage(worker, m))
    worker.on('exit', (code) => {
      if (this.worker !== worker) return
      this.deps.log?.(`engine exited with code ${code}`)
      this.handleExit(worker)
    })
    const adapters = this.hostAdapters
    worker.postMessage(adapters.length > 0 ? { type: 'init', options: this.deps.options, hostAdapters: adapters } : { type: 'init', options: this.deps.options })
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
      this.emit({ type: 'error', jobId, error: CANCELLED_ERROR })
      return
    }
    const watch = this.dispatched.get(jobId)
    if (!watch || !this.worker) return
    this.worker.postMessage({ type: 'cancel', jobId })
    if (watch.cancelRequested) return
    watch.cancelRequested = true
    watch.cancelTimer = this.setTimer(() => {
      watch.cancelTimer = null
      if (this.dispatched.get(jobId) !== watch) return
      this.deps.log?.(`engine did not stop job ${jobId} within ${this.cancelGraceMs} ms; restarting the worker`)
      this.recycle(null)
    }, this.cancelGraceMs)
  }

  stop(): void {
    this.stopping = true
    if (this.restartTimer !== null) this.clearTimer(this.restartTimer)
    this.restartTimer = null
    const w = this.worker
    this.worker = null
    this.ready = false
    this.pending = []
    for (const watch of this.dispatched.values()) this.clearWatch(watch)
    this.dispatched.clear()
    this.adapterAbort.abort()
    if (w) this.killQuietly(w)
  }

  private get cancelGraceMs(): number {
    return this.deps.cancelGraceMs ?? CANCEL_GRACE_MS
  }

  private get jobHardTimeoutMs(): number {
    return this.deps.jobHardTimeoutMs ?? JOB_HARD_TIMEOUT_MS
  }

  private killQuietly(w: WorkerLike): void {
    try {
      w.kill()
    } catch {
      // already gone
    }
  }

  private dispatch(worker: WorkerLike, req: JobRequest): void {
    const watch: Watch = { timer: null, started: false, cancelRequested: false, cancelTimer: null }
    this.dispatched.set(req.id, watch)
    this.armHardTimeout(req.id, watch)
    worker.postMessage({ type: 'run', req })
  }

  /** (Re)start the job's hard timeout. */
  private armHardTimeout(jobId: string, watch: Watch): void {
    if (watch.timer !== null) this.clearTimer(watch.timer)
    watch.timer = this.setTimer(() => {
      watch.timer = null
      if (this.dispatched.get(jobId) !== watch) return
      this.deps.log?.(`job ${jobId} exceeded the hard timeout; restarting the worker`)
      this.recycle(jobId)
    }, this.jobHardTimeoutMs)
  }

  private clearWatch(watch: Watch): void {
    if (watch.timer !== null) this.clearTimer(watch.timer)
    if (watch.cancelTimer !== null) this.clearTimer(watch.cancelTimer)
    watch.timer = null
    watch.cancelTimer = null
  }

  /**
   * Watchdog: kill the current worker, fail every in-flight job (CANCELLED for cancelled jobs,
   * HUNG for the job that timed out, RESTARTED for the others) and start a fresh worker now.
   */
  private recycle(timedOutJobId: string | null): void {
    const w = this.worker
    this.worker = null
    this.ready = false
    this.adapterAbort.abort()
    const jobs = [...this.dispatched]
    this.dispatched.clear()
    if (w) this.killQuietly(w)
    for (const [jobId, watch] of jobs) {
      this.clearWatch(watch)
      const error = watch.cancelRequested ? CANCELLED_ERROR : jobId === timedOutJobId ? HUNG_ERROR : RESTARTED_ERROR
      this.emit({ type: 'error', jobId, error })
    }
    if (!this.stopping) this.start()
  }

  private emit(event: JobEvent): void {
    try {
      this.deps.onEvent(event)
    } catch (err) {
      this.deps.log?.(`onEvent listener threw: ${String(err)}`)
    }
  }

  /** Any message proves the worker's event loop is alive: refresh timers of jobs not started yet. */
  private touchQueuedJobs(): void {
    for (const [jobId, watch] of this.dispatched) if (!watch.started) this.armHardTimeout(jobId, watch)
  }

  private handleMessage(worker: WorkerLike, raw: unknown): void {
    if (this.worker !== worker) return
    const parsed = workerMessageSchema.safeParse(raw)
    if (!parsed.success) {
      this.deps.log?.('engine sent an invalid message')
      return
    }
    const msg = parsed.data
    this.touchQueuedJobs()
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
        const watch = this.dispatched.get(ev.jobId)
        if (!watch) return // unknown / already finished job
        if (ev.type === 'done' || ev.type === 'error') {
          this.clearWatch(watch)
          this.dispatched.delete(ev.jobId)
        } else if (ev.type === 'progress' && !watch.started) {
          // The engine started working on it: the hard timeout now measures the run itself.
          watch.started = true
          this.armHardTimeout(ev.jobId, watch)
        }
        this.emit(ev)
        return
      }
      case 'htmlToPdf': {
        const { requestId, html } = msg
        this.answer(worker, this.deps.htmlToPdf(html), (pdf) => ({ type: 'htmlToPdf:result', requestId, pdf }), (error) => ({ type: 'htmlToPdf:result', requestId, error }))
        return
      }
      case 'renderPdf': {
        const { requestId, pdf, options } = msg
        const render = this.deps.renderPdfPages
        const work = render ? render(pdf, options, this.adapterAbort.signal) : Promise.reject(new Error('renderPdfPages is not available'))
        this.answer(worker, work, (pages) => ({ type: 'renderPdf:result', requestId, pages }), (error) => ({ type: 'renderPdf:result', requestId, error }))
        return
      }
    }
  }

  private answer<T>(worker: WorkerLike, work: Promise<T>, ok: (value: T) => HostToWorker, fail: (error: string) => HostToWorker): void {
    work
      .then(ok, (err: unknown) => fail(err instanceof Error ? err.message : String(err)))
      .then((reply) => {
        if (this.worker === worker) worker.postMessage(reply)
      })
      .catch((err: unknown) => this.deps.log?.(`adapter reply failed: ${String(err)}`))
  }

  private handleExit(worker: WorkerLike | null): void {
    if (worker && this.worker !== worker) return
    this.worker = null
    this.ready = false
    this.adapterAbort.abort()
    for (const [jobId, watch] of [...this.dispatched]) {
      this.clearWatch(watch)
      this.dispatched.delete(jobId)
      this.emit({ type: 'error', jobId, error: watch.cancelRequested ? CANCELLED_ERROR : CRASH_ERROR })
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
