// Transport-agnostic worker protocol handler (unit tested without Electron).
import { randomUUID } from 'node:crypto'
import type { JobRequest } from '../shared/types'
import type { Engine, EngineAdapters, EngineOptions, HostToWorker, PdfRenderOptions, WorkerToHost } from './api'
import { EngineError } from './errors'

export interface WorkerPort {
  post(msg: WorkerToHost): void
  onMessage(cb: (msg: HostToWorker) => void): void
}

export const HTML_TO_PDF_TIMEOUT_MS = 60_000
export const RENDER_PDF_TIMEOUT_MS = 5 * 60_000

export interface WorkerHandle {
  /** Jobs currently running (for tests/diagnostics). */
  activeJobs(): number
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

function asBytes(v: unknown): Uint8Array {
  return v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBufferLike)
}

/**
 * Wire an engine to a port: posts 'ready', waits for 'init', then runs jobs, forwards events,
 * cancels on request and proxies adapter calls (htmlToPdf, optional renderPdfPages) to the host.
 */
export function createWorkerHandler(
  port: WorkerPort,
  makeEngine: (adapters: EngineAdapters, options: EngineOptions) => Engine,
  opts: { htmlToPdfTimeoutMs?: number; renderPdfTimeoutMs?: number } = {}
): WorkerHandle {
  let engine: Engine | undefined
  const pendingRuns: JobRequest[] = []
  const jobs = new Map<string, AbortController>()
  const requests = new Map<string, Pending>()

  const ask = <T>(timeoutMs: number, timeoutMessage: string, send: (requestId: string) => void): Promise<T> => {
    const requestId = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        requests.delete(requestId)
        reject(new EngineError('TOOL_FAILED', timeoutMessage, 'host adapter timeout'))
      }, timeoutMs)
      timer.unref?.()
      requests.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer })
      send(requestId)
    })
  }

  const settle = (requestId: string, error: string | undefined, value: unknown, failMessage: string): void => {
    const pending = requests.get(requestId)
    if (!pending) return
    requests.delete(requestId)
    clearTimeout(pending.timer)
    if (error !== undefined || value === undefined) pending.reject(new EngineError('TOOL_FAILED', failMessage, error ?? 'empty result'))
    else pending.resolve(value)
  }

  const htmlToPdf = (html: string): Promise<Uint8Array> =>
    ask<Uint8Array>(opts.htmlToPdfTimeoutMs ?? HTML_TO_PDF_TIMEOUT_MS, 'Printing to PDF took too long.', (requestId) =>
      port.post({ type: 'htmlToPdf', requestId, html })
    )

  const renderPdfPages = (pdf: Uint8Array, options: PdfRenderOptions): Promise<Uint8Array[]> =>
    ask<Uint8Array[]>(opts.renderPdfTimeoutMs ?? RENDER_PDF_TIMEOUT_MS, 'Drawing the PDF pages took too long.', (requestId) =>
      port.post({ type: 'renderPdf', requestId, pdf, options })
    )

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
      case 'init': {
        if (engine) return
        const adapters: EngineAdapters = { htmlToPdf }
        if (msg.hostAdapters?.includes('renderPdfPages')) adapters.renderPdfPages = renderPdfPages
        engine = makeEngine(adapters, msg.options)
        pendingRuns.splice(0).forEach(start)
        return
      }
      case 'run':
        start(msg.req)
        return
      case 'cancel':
        jobs.get(msg.jobId)?.abort()
        return
      case 'htmlToPdf:result':
        settle(msg.requestId, msg.error, msg.pdf === undefined ? undefined : asBytes(msg.pdf), "I couldn't print this to PDF.")
        return
      case 'renderPdf:result':
        settle(msg.requestId, msg.error, msg.pages?.map(asBytes), "I couldn't draw the pages of this PDF.")
        return
      default:
        return
    }
  })

  // 'ready' = the worker process is up and listening (same as the scaffold). The host then sends
  // 'init'; 'run' messages that arrive before 'init' are queued, not dropped.
  port.post({ type: 'ready' })
  return { activeJobs: () => jobs.size }
}
