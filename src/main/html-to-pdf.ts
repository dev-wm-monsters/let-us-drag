// EngineAdapters.htmlToPdf implementation: Chromium printToPDF in a hidden, locked-down window
// (SEC-82).
// - JavaScript disabled, sandboxed, context-isolated, no node integration, no preload, no devtools.
// - Dedicated in-memory session (no "persist:" partition). The document is served from memory by
//   the session's own `lud-sandbox://print/…` protocol handler (never from file://, nothing is
//   written to disk). The handler serves exactly one URL: the current job's document.
// - The session's webRequest filter cancels every request except that URL and data: URLs
//   (embedded images/fonts): no network, no local files, no other documents.
// - A CSP <meta> is injected as a second layer (pdf-csp.ts), and sent as a header as a third.
// - Permissions, downloads, navigation, window.open and <webview> are denied.
// - Jobs are serialized, the HTML size is capped, each job has a timeout, and the window is
//   destroyed after every job (a fresh renderer per document).

import { randomUUID } from 'node:crypto'
import { BrowserWindow, session, type Session } from 'electron'
import { injectCsp, isAllowedPrintRequest, PDF_CSP, PRINT_HOST } from './pdf-csp'
import { SANDBOX_SCHEME, sandboxResponse } from './sandbox-protocol'
import { hardenSession, hardenWebContents, secureWebPreferences } from './security'
import { SerialQueue, withTimeout } from './serial-queue'

export const PDF_TIMEOUT_MS = 30_000
/** Largest HTML document we print (UTF-8 bytes). Inline data: images make documents big. */
export const MAX_HTML_BYTES = 64 * 1024 * 1024
export const PRINT_PARTITION = 'lud-html-to-pdf'

export class HtmlToPdf {
  private ses: Session | null = null
  private win: BrowserWindow | null = null
  private current: { url: string; html: string } | null = null
  private readonly queue = new SerialQueue()

  constructor(private readonly log?: (message: string) => void) {}

  convert(html: string): Promise<Uint8Array> {
    return this.queue.push(() => this.convertNow(html))
  }

  dispose(): void {
    this.destroyWindow()
  }

  private getSession(): Session {
    if (this.ses) return this.ses
    const ses = session.fromPartition(PRINT_PARTITION) // no "persist:" → in-memory
    hardenSession(ses)
    ses.webRequest.onBeforeRequest((details, callback) => {
      const ok = isAllowedPrintRequest(details.url, this.current?.url ?? null)
      if (!ok) this.log?.(`htmlToPdf blocked request: ${details.url.slice(0, 120)}`)
      callback({ cancel: !ok })
    })
    ses.protocol.handle(SANDBOX_SCHEME, (request) => {
      const cur = this.current
      if (!cur || request.method !== 'GET' || request.url !== cur.url) return sandboxResponse(null, 404, 'text/plain', PDF_CSP)
      return sandboxResponse(cur.html, 200, 'text/html; charset=utf-8', PDF_CSP)
    })
    this.ses = ses
    return ses
  }

  private createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      show: false,
      width: 816,
      height: 1056,
      skipTaskbar: true,
      webPreferences: secureWebPreferences({
        javascript: false,
        devTools: false,
        images: true,
        backgroundThrottling: false,
        session: this.getSession()
      })
    })
    hardenWebContents(win.webContents)
    this.win = win
    return win
  }

  private destroyWindow(): void {
    const win = this.win
    this.win = null
    if (win && !win.isDestroyed()) win.destroy()
  }

  private async convertNow(html: string): Promise<Uint8Array> {
    if (typeof html !== 'string') throw new Error('Invalid document.')
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new Error('This document is too big to print to PDF.')
    const url = `${SANDBOX_SCHEME}://${PRINT_HOST}/${randomUUID()}.html`
    this.current = { url, html: injectCsp(html) }
    const win = this.createWindow()
    try {
      const work = (async () => {
        await win.loadURL(url)
        const buf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice()
      })()
      return await withTimeout(work, PDF_TIMEOUT_MS, 'Rendering the PDF took too long.')
    } finally {
      this.current = null
      // One renderer per document: nothing lingers in memory between jobs.
      if (this.win === win) this.destroyWindow()
    }
  }
}
