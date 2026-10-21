// Engine entry point (pure Node, no electron import). See src/engine/api.ts for the contract.
import type { JobEvent, JobRequest } from '../shared/types'
import type { Engine, EngineAdapters } from './api'
import { cancelledOrTimeout, toJobError } from './errors'
import { runJob, type EngineRuntimeOptions } from './jobs'

export { describePaths } from './registry'
export { FRIENDLY_MESSAGES, EngineError } from './errors'
export type { EngineRuntimeOptions } from './jobs'

/** Jobs running at the same time; later jobs wait (they already got their 'queued' event). */
export const MAX_CONCURRENT_JOBS = 2

/** Small FIFO semaphore. */
export class Limiter {
  private active = 0
  private readonly waiting: (() => void)[] = []

  constructor(private readonly max: number) {}

  async acquire(signal: AbortSignal): Promise<void> {
    if (this.active < this.max) {
      this.active++
      return
    }
    await new Promise<void>((resolve, reject) => {
      const go = (): void => {
        signal.removeEventListener('abort', onAbort)
        this.active++
        resolve()
      }
      const onAbort = (): void => {
        const i = this.waiting.indexOf(go)
        if (i >= 0) this.waiting.splice(i, 1)
        reject(cancelledOrTimeout(signal))
      }
      this.waiting.push(go)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  release(): void {
    this.active--
    const next = this.waiting.shift()
    if (next) next()
  }
}

export function createEngine(adapters: EngineAdapters, options: EngineRuntimeOptions): Engine {
  const limiter = new Limiter(MAX_CONCURRENT_JOBS)
  return {
    async run(req: JobRequest, onEvent: (e: JobEvent) => void, signal: AbortSignal): Promise<void> {
      const jobId = typeof req?.id === 'string' ? req.id : ''
      const emit = (e: JobEvent): void => {
        try {
          onEvent(e)
        } catch {
          // ignore listener errors
        }
      }
      emit({ type: 'queued', jobId })
      try {
        await limiter.acquire(signal)
      } catch (err) {
        emit({ type: 'error', jobId, error: toJobError(err) })
        return
      }
      try {
        await runJob(req, emit, signal, adapters, options)
      } finally {
        limiter.release()
      }
    }
  }
}
