// EngineAdapters.htmlToPdf implementation: Chromium printToPDF in one hidden, locked-down window.
// - JavaScript disabled, sandboxed, context-isolated, no node integration, no preload.
// - Dedicated in-memory session whose webRequest filter cancels every request except the temp
//   HTML file itself and data: URLs (embedded images/fonts) → no network, no other local files.
// - A CSP <meta> is injected as a second layer.
// - The HTML is written to a private temp dir (data: URLs are too small for big documents),
//   which is removed afterwards.
// - One window, reused; jobs serialized; 30 s timeout per document (window recreated on timeout).

import { BrowserWindow, session, type Session } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { injectCsp } from './pdf-csp'
import { SerialQueue, withTimeout } from './serial-queue'
import { hardenSession, hardenWebContents } from './security'

export const PDF_TIMEOUT_MS = 30_000

export class HtmlToPdf {
  private win: BrowserWindow | null = null
  private ses: Session | null = null
  private allowedUrl: string | null = null
  private readonly queue = new SerialQueue()

  constructor(private readonly log?: (message: string) => void) {}

  convert(html: string): Promise<Uint8Array> {
    return this.queue.push(() => this.convertNow(html))
  }

  dispose(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }

  private getSession(): Session {
    if (this.ses) return this.ses
    const ses = session.fromPartition('lud-html-to-pdf') // no "persist:" → in-memory
    hardenSession(ses)
    ses.webRequest.onBeforeRequest((details, callback) => {
      const ok = details.url.startsWith('data:') || (this.allowedUrl !== null && details.url === this.allowedUrl)
      if (!ok) this.log?.(`htmlToPdf blocked request: ${details.url.slice(0, 200)}`)
      callback({ cancel: !ok })
    })
    this.ses = ses
    return ses
  }

  private getWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      show: false,
      width: 816,
      height: 1056,
      skipTaskbar: true,
      webPreferences: {
        javascript: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
        spellcheck: false,
        session: this.getSession()
      }
    })
    hardenWebContents(win.webContents)
    this.win = win
    return win
  }

  private async convertNow(html: string): Promise<Uint8Array> {
    const dir = await mkdtemp(join(tmpdir(), 'lud-pdf-'))
    const file = join(dir, 'document.html')
    try {
      await writeFile(file, injectCsp(html), 'utf8')
      this.allowedUrl = pathToFileURL(file).href
      const win = this.getWindow()
      const work = (async () => {
        await win.loadFile(file)
        const buf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice()
      })()
      return await withTimeout(work, PDF_TIMEOUT_MS, 'Rendering the PDF took too long.', () => {
        // A stuck page: throw the window away; the next job gets a fresh one.
        this.dispose()
      })
    } finally {
      this.allowedUrl = null
      if (this.win && !this.win.isDestroyed()) {
        // Unload the document so it does not linger in memory.
        this.win.webContents.loadURL('about:blank').catch(() => undefined)
      }
      await rm(dir, { recursive: true, force: true })
    }
  }
}
