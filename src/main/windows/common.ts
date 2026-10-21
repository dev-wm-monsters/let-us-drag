// Shared window factory: security baseline + renderer page loading.

import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { preloadPath, rendererTarget, type RendererPage, type RuntimeLayout } from '../paths'
import { hardenWebContents, secureWebPreferences } from '../security'

/** Renderer flag that enables the E2E-only preload surface (see src/main/test-hooks.ts). */
export const E2E_RENDERER_ARG = '--lud-e2e'

export interface WindowContext {
  layout: RuntimeLayout
  e2e: boolean
  /** Called for every created window so IPC can trust its webContents. */
  register(win: BrowserWindow): void
}

export function createAppWindow(
  ctx: WindowContext,
  options: BrowserWindowConstructorOptions,
  extraPrefs: { backgroundThrottling?: boolean; transparent?: boolean } = {}
): BrowserWindow {
  const win = new BrowserWindow({
    ...options,
    webPreferences: secureWebPreferences({
      preload: preloadPath(ctx.layout),
      additionalArguments: ctx.e2e ? [E2E_RENDERER_ARG] : [],
      devTools: !ctx.layout.isPackaged,
      ...extraPrefs
    })
  })
  hardenWebContents(win.webContents)
  // Our windows never need an application menu bar (Windows/Linux).
  win.removeMenu()
  ctx.register(win)
  return win
}

export function loadPage(win: BrowserWindow, page: RendererPage, layout: RuntimeLayout): Promise<void> {
  const target = rendererTarget(page, layout)
  return target.kind === 'url' ? win.loadURL(target.url) : win.loadFile(target.path)
}
