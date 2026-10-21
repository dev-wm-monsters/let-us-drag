// EngineAdapters.renderPdfPages implementation (host side): pdf.js inside one hidden, sandboxed
// BrowserWindow. Needed because @napi-rs/canvas crashes inside Electron (see src/engine/api.ts).
//
// Isolation (the PDF is untrusted data):
// - sandbox, contextIsolation, no node integration, NO preload, no devtools; JavaScript is on
//   because pdf.js needs it, but the only scripts that can run are pdf.js and our tiny page
//   script, served by main from node_modules/pdfjs-dist (CSP `script-src 'self'`, no eval).
// - Dedicated in-memory session (`lud-pdf-render`, no "persist:"). Its `lud-sandbox://pdf/…`
//   protocol handler serves only: the page, the page script, the pdf.js build files and data
//   folders (cmaps, standard_fonts, wasm, iccs) and, while a job runs, the job's PDF bytes.
//   Its webRequest filter cancels every other URL (no http(s), no file://, no ws).
// - Permissions, downloads, navigation, window.open and <webview> are denied.
// - pdf.js: no XFA, no system fonts, no scripting/annotation layers, embedded image size capped.
// Robustness:
// - Jobs are serialized; one window is reused and destroyed after IDLE_MS without work.
// - Every job has a timeout; on timeout, abort or a renderer crash the window is thrown away.
// - Results that come back from the page are validated (PNG magic, sizes, page count, bytes).

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import { BrowserWindow, session, type Session } from 'electron'
import type { PdfRenderOptions } from '../engine/api'
import {
  clampRenderOptions,
  describeError,
  isPngBytes,
  PDF_MAX_IMAGE_PIXELS,
  PDF_MAX_PAGES,
  PDF_MAX_TOTAL_BYTES,
  PDF_RENDER_CSP,
  PDF_RENDER_HOST,
  PDF_RENDER_HTML,
  PDF_RENDER_SCRIPT,
  planPage
} from './pdf-render-plan'
import { contentTypeFor, isSandboxUrl, mapSandboxPath, SANDBOX_SCHEME, sandboxResponse } from './sandbox-protocol'
import { hardenSession, hardenWebContents, secureWebPreferences } from './security'
import { SerialQueue, TimeoutError, withTimeout } from './serial-queue'

/** Whole document. The engine waits 5 minutes for the adapter; we give up a little earlier. */
export const PDF_RENDER_TIMEOUT_MS = 4 * 60_000
/** Close the hidden window after this long without work (frees the renderer's memory). */
export const PDF_RENDER_IDLE_MS = 60_000
export const PDF_RENDER_PARTITION = 'lud-pdf-render'

const ORIGIN = `${SANDBOX_SCHEME}://${PDF_RENDER_HOST}`
/** Folders of pdfjs-dist the page may read (request path prefix → package sub-folder). */
const PDFJS_PREFIXES = ['/pdfjs/build/', '/pdfjs/cmaps/', '/pdfjs/standard_fonts/', '/pdfjs/wasm/', '/pdfjs/iccs/'] as const
const PDFJS_BUILD_FILES = new Set(['pdf.mjs', 'pdf.worker.mjs'])

/** Directory of the installed pdfjs-dist package (inside app.asar when packaged; fs reads it). */
export function pdfjsDir(): string {
  const req = typeof require === 'function' ? require : createRequire(__filename)
  return dirname(req.resolve('pdfjs-dist/package.json'))
}

export class PdfRenderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfRenderError'
  }
}

export interface PdfRendererDeps {
  log?: (message: string) => void
  /** Override for tests / unusual layouts. */
  pdfjsDir?: string
  timeoutMs?: number
}

export class PdfRenderer {
  private ses: Session | null = null
  private win: BrowserWindow | null = null
  private ready: Promise<void> | null = null
  private job: { url: string; bytes: Uint8Array } | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private readonly queue = new SerialQueue()
  private readonly root: string

  constructor(private readonly deps: PdfRendererDeps = {}) {
    this.root = deps.pdfjsDir ?? pdfjsDir()
  }

  /** Rasterise every page to PNG (white background), in page order. */
  render(pdf: Uint8Array, options: PdfRenderOptions, signal?: AbortSignal): Promise<Uint8Array[]> {
    return this.queue.push(() => this.renderNow(pdf, options, signal))
  }

  dispose(): void {
    this.clearIdle()
    this.destroyWindow()
  }

  // --- session + window ---------------------------------------------------------------------

  private getSession(): Session {
    if (this.ses) return this.ses
    const ses = session.fromPartition(PDF_RENDER_PARTITION) // no "persist:" → in-memory
    hardenSession(ses)
    ses.webRequest.onBeforeRequest((details, callback) => {
      const ok = isSandboxUrl(details.url, PDF_RENDER_HOST)
      if (!ok) this.deps.log?.(`renderPdf blocked request: ${details.url.slice(0, 120)}`)
      callback({ cancel: !ok })
    })
    ses.protocol.handle(SANDBOX_SCHEME, (request) => this.serve(request))
    this.ses = ses
    return ses
  }

  private async serve(request: Request): Promise<Response> {
    const notFound = (): Response => sandboxResponse(null, 404, 'text/plain', PDF_RENDER_CSP)
    if (request.method !== 'GET' || !isSandboxUrl(request.url, PDF_RENDER_HOST)) return notFound()
    const path = new URL(request.url).pathname
    if (path === '/index.html') return sandboxResponse(PDF_RENDER_HTML, 200, contentTypeFor(path), PDF_RENDER_CSP)
    if (path === '/render.mjs') return sandboxResponse(PDF_RENDER_SCRIPT, 200, contentTypeFor(path), PDF_RENDER_CSP)
    const job = this.job
    if (job && request.url === job.url) return sandboxResponse(job.bytes, 200, 'application/pdf', PDF_RENDER_CSP)
    const mapped = mapSandboxPath(path, PDFJS_PREFIXES)
    if (!mapped) return notFound()
    if (mapped.prefix === '/pdfjs/build/' && !PDFJS_BUILD_FILES.has(mapped.rel)) return notFound()
    const sub = mapped.prefix.slice('/pdfjs/'.length)
    const file = join(this.root, sub, ...mapped.rel.split('/'))
    if (!file.startsWith(this.root + sep)) return notFound()
    try {
      return sandboxResponse(new Uint8Array(await readFile(file)), 200, contentTypeFor(file), PDF_RENDER_CSP)
    } catch {
      return notFound()
    }
  }

  private getWindow(): { win: BrowserWindow; ready: Promise<void> } {
    if (this.win && !this.win.isDestroyed() && this.ready) return { win: this.win, ready: this.ready }
    const win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      skipTaskbar: true,
      webPreferences: secureWebPreferences({
        // pdf.js needs JavaScript; the PDF itself cannot run any (see the header comment).
        javascript: true,
        devTools: false,
        backgroundThrottling: false,
        session: this.getSession()
      })
    })
    hardenWebContents(win.webContents)
    win.webContents.on('render-process-gone', (_e, details) => {
      this.deps.log?.(`renderPdf renderer gone: ${details.reason}`)
      if (this.win === win) this.destroyWindow()
    })
    this.win = win
    this.ready = win.loadURL(`${ORIGIN}/index.html`).then(async () => {
      const ok: unknown = await win.webContents.executeJavaScript("typeof globalThis.__ludPdf === 'object'")
      if (ok !== true) throw new PdfRenderError('pdf.js did not load')
    })
    // Avoid an unhandled rejection if the window dies before anyone awaits `ready`.
    this.ready.catch(() => undefined)
    return { win, ready: this.ready }
  }

  private destroyWindow(): void {
    const win = this.win
    this.win = null
    this.ready = null
    if (win && !win.isDestroyed()) {
      try {
        // A renderer stuck in pdf.js code would not unload; make sure the process goes away.
        win.webContents.forcefullyCrashRenderer()
      } catch {
        // already gone
      }
      win.destroy()
    }
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private scheduleIdle(): void {
    this.clearIdle()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.queue.pending === 0) this.destroyWindow()
    }, PDF_RENDER_IDLE_MS)
    this.idleTimer.unref?.()
  }

  // --- one job ------------------------------------------------------------------------------

  private async renderNow(pdf: Uint8Array, options: PdfRenderOptions, signal?: AbortSignal): Promise<Uint8Array[]> {
    this.clearIdle()
    if (!(pdf instanceof Uint8Array) || pdf.length === 0) throw new PdfRenderError('No PDF data.')
    if (signal?.aborted) throw new PdfRenderError('Cancelled.')
    const opts = clampRenderOptions(options)
    const { win, ready } = this.getWindow()
    this.job = { url: `${ORIGIN}/job/${randomUUID()}.pdf`, bytes: pdf }
    let failed = false
    const onAbort = (): void => {
      failed = true
      if (this.win === win) this.destroyWindow()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const work = this.renderPages(win, ready, opts, signal)
      return await withTimeout(work, this.deps.timeoutMs ?? PDF_RENDER_TIMEOUT_MS, 'Drawing the PDF pages took too long.')
    } catch (err) {
      failed = true
      if (signal?.aborted) throw new PdfRenderError('Cancelled.')
      if (err instanceof TimeoutError || err instanceof PdfRenderError) throw err
      // pdf.js / renderer errors: keep the message short and free of stack traces.
      throw new PdfRenderError(`pdf.js could not render this PDF: ${describeError(err)}`)
    } finally {
      signal?.removeEventListener('abort', onAbort)
      this.job = null
      if (failed) {
        // A failed/timed-out document may have left the renderer in a bad state: start fresh.
        if (this.win === win) this.destroyWindow()
      } else if (this.win === win && !win.isDestroyed()) {
        await win.webContents.executeJavaScript('globalThis.__ludPdf.close()').catch(() => undefined)
        this.scheduleIdle()
      }
    }
  }

  private async renderPages(win: BrowserWindow, ready: Promise<void>, opts: PdfRenderOptions, signal?: AbortSignal): Promise<Uint8Array[]> {
    await ready
    const wc = win.webContents
    const job = this.job
    if (!job) throw new PdfRenderError('No job.')
    const count: unknown = await wc.executeJavaScript(`globalThis.__ludPdf.open(${JSON.stringify(job.url)}, ${PDF_MAX_IMAGE_PIXELS})`)
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) throw new PdfRenderError('This PDF has no pages.')
    if (count > PDF_MAX_PAGES) throw new PdfRenderError(`This PDF has too many pages (${count}; the limit is ${PDF_MAX_PAGES}).`)
    const pages: Uint8Array[] = []
    let total = 0
    for (let n = 1; n <= count; n++) {
      if (signal?.aborted) throw new PdfRenderError('Cancelled.')
      const size: unknown = await wc.executeJavaScript(`globalThis.__ludPdf.size(${n})`)
      const s = size as { width?: unknown; height?: unknown } | null
      const plan = planPage(Number(s?.width), Number(s?.height), opts)
      if (!plan) throw new PdfRenderError(`Page ${n} has an invalid size.`)
      const png: unknown = await wc.executeJavaScript(`globalThis.__ludPdf.render(${n}, ${plan.scale}, ${plan.width}, ${plan.height})`)
      if (!isPngBytes(png)) throw new PdfRenderError(`Page ${n} could not be drawn.`)
      total += png.byteLength
      if (total > PDF_MAX_TOTAL_BYTES) throw new PdfRenderError('The pages of this PDF are too big to convert in one go.')
      pages.push(png)
    }
    return pages
  }
}
