// A window that exists at most once; open() creates it or brings it to the front.

import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import type { RendererPage } from '../paths'
import { createAppWindow, loadPage, type WindowContext } from './common'

export class SingletonWindow {
  private win: BrowserWindow | null = null
  private opening: Promise<BrowserWindow> | null = null

  constructor(
    private readonly ctx: WindowContext,
    private readonly page: RendererPage,
    private readonly options: BrowserWindowConstructorOptions
  ) {}

  get window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  open(): Promise<BrowserWindow> {
    const existing = this.window
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.show()
      existing.focus()
      return Promise.resolve(existing)
    }
    if (this.opening) return this.opening
    const win = createAppWindow(this.ctx, this.page, { ...this.options, show: false })
    this.win = win
    win.on('closed', () => {
      if (this.win === win) this.win = null
    })
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show()
    })
    this.opening = loadPage(win, this.page, this.ctx.layout)
      .then(() => {
        // ready-to-show normally fired already; make sure the window is up when open() resolves.
        if (!win.isDestroyed() && !win.isVisible()) win.show()
        return win
      })
      .finally(() => {
        this.opening = null
      })
    return this.opening
  }

  close(): void {
    this.window?.destroy()
    this.win = null
  }
}
