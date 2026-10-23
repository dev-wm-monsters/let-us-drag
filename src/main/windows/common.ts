// Shared window factory: security baseline + renderer page loading.

import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { preloadPath, rendererTarget, type RendererPage, type RuntimeLayout } from '../paths'
import { hardenWebContents, secureWebPreferences } from '../security'

/** Renderer flag that enables the E2E-only preload surface (see src/main/test-hooks.ts). */
export const E2E_RENDERER_ARG = '--lud-e2e'

export interface WindowContext {
  layout: RuntimeLayout
  e2e: boolean
  /** Called for every created window so IPC can trust its webContents (and only for `page`). */
  register(win: BrowserWindow, page: RendererPage): void
}

export function createAppWindow(
  ctx: WindowContext,
  page: RendererPage,
  options: BrowserWindowConstructorOptions,
  extraPrefs: { backgroundThrottling?: boolean; transparent?: boolean } = {},
  /** Extra renderer flags (field diagnostics only: DEBUG_RENDERER_ARG). */
  rendererArgs: readonly string[] = []
): BrowserWindow {
  const win = new BrowserWindow({
    ...options,
    webPreferences: secureWebPreferences({
      ...extraPrefs,
      preload: preloadPath(ctx.layout),
      // ctx.e2e is false in packaged builds (e2e-mode.ts), so this flag never reaches production.
      additionalArguments: [...(ctx.e2e && !ctx.layout.isPackaged ? [E2E_RENDERER_ARG] : []), ...rendererArgs],
      devTools: !ctx.layout.isPackaged
    })
  })
  hardenWebContents(win.webContents)
  // Our windows never need an application menu bar (Windows/Linux).
  win.removeMenu()
  ctx.register(win, page)
  return win
}

export function loadPage(win: BrowserWindow, page: RendererPage, layout: RuntimeLayout): Promise<void> {
  const target = rendererTarget(page, layout)
  return target.kind === 'url' ? win.loadURL(target.url) : win.loadFile(target.path)
}
