// Transport-agnostic worker protocol handler (unit tested without Electron).
import { randomUUID } from 'node:crypto'
import type { JobRequest } from '../shared/types'
import type { Engine, EngineAdapters, EngineOptions, HostToWorker, WorkerToHost } from './api'
import { EngineError } from './errors'

export interface WorkerPort {
  post(msg: WorkerToHost): void
  onMessage(cb: (msg: HostToWorker) => void): void
}

export const HTML_TO_PDF_TIMEOUT_MS = 60_000

export interface WorkerHandle {
  /** Jobs currently running (for tests/diagnostics). */
  activeJobs(): number
}

/**
 * Wire an engine to a port: posts 'ready', waits for 'init', then runs jobs, forwards events, cancels on request
 * and proxies htmlToPdf calls to the host.
 */
export function createWorkerHandler(
  port: WorkerPort,
  makeEngine: (adapters: EngineAdapters, options: EngineOptions) => Engine,
  opts: { htmlToPdfTimeoutMs?: number } = {}
): WorkerHandle {
  let engine: Engine | undefined
  const pendingRuns: JobRequest[] = []
  const jobs = new Map<string, AbortController>()
  const pdfRequests = new Map<string, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  const timeoutMs = opts.htmlToPdfTimeoutMs ?? HTML_TO_PDF_TIMEOUT_MS

  const adapters: EngineAdapters = {
    htmlToPdf(html: string): Promise<Uint8Array> {
      const requestId = randomUUID()
      return new Promise<Uint8Array>((resolve, reject) => {
        const timer = setTimeout(() => {
          pdfRequests.delete(requestId)
          reject(new EngineError('TOOL_FAILED', 'Printing to PDF took too long.', 'htmlToPdf timeout'))
        }, timeoutMs)
        timer.unref?.()
        pdfRequests.set(requestId, { resolve, reject, timer })
        port.post({ type: 'htmlToPdf', requestId, html })
      })
    }
  }

  const start = (req: JobRequest): void => {
    if (!engine) {
      pendingRuns.push(req)
      return
    }
    const controller = new AbortController()
    const key = typeof req?.id === 'string' ? req.id : ''
    jobs.get(key)?.abort() // a duplicate id replaces the older job
    jobs.set(key, controller)
    void engine
      .run(req, (event) => port.post({ type: 'event', event }), controller.signal)
      .finally(() => {
        if (jobs.get(key) === controller) jobs.delete(key)
      })
  }

  port.onMessage((msg) => {
    if (!msg || typeof msg !== 'object') return
    switch (msg.type) {
      case 'init':
        if (engine) return
        engine = makeEngine(adapters, msg.options)
        pendingRuns.splice(0).forEach(start)
        return
      case 'run':
        start(msg.req)
        return
      case 'cancel':
        jobs.get(msg.jobId)?.abort()
        return
      case 'htmlToPdf:result': {
        const pending = pdfRequests.get(msg.requestId)
        if (!pending) return
        pdfRequests.delete(msg.requestId)
        clearTimeout(pending.timer)
        if (msg.error !== undefined || !msg.pdf) pending.reject(new EngineError('TOOL_FAILED', "I couldn't print this to PDF.", msg.error ?? 'no pdf'))
        else pending.resolve(msg.pdf instanceof Uint8Array ? msg.pdf : new Uint8Array(msg.pdf as ArrayBufferLike))
        return
      }
      default:
        return
    }
  })

  // 'ready' = the worker process is up and listening (same as the scaffold). The host then sends
  // 'init'; 'run' messages that arrive before 'init' are queued, not dropped.
  port.post({ type: 'ready' })
  return { activeJobs: () => jobs.size }
}
