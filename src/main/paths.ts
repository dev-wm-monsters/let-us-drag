// Pure path resolution for renderer pages, preload, resources and tray icons.

import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type RendererPage = 'overlay' | 'feed' | 'settings'

export interface RuntimeLayout {
  /** Directory of the bundled main script (out/main). */
  mainDir: string
  /** ELECTRON_RENDERER_URL in `electron-vite dev`, otherwise undefined. */
  devServerUrl?: string
  isPackaged: boolean
  /** process.resourcesPath */
  resourcesPath: string
  /** app.getAppPath() (repo root in development). */
  appPath: string
}

export type RendererTarget = { kind: 'url'; url: string } | { kind: 'file'; path: string }

/** Dev server URL only when it is a loopback http(s) URL (never load remote content). */
export function safeDevServerUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const u = new URL(raw)
    if ((u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]')) {
      return u.origin
    }
  } catch {
    // fall through
  }
  return undefined
}

export function rendererDir(layout: RuntimeLayout): string {
  return resolve(layout.mainDir, '..', 'renderer')
}

export function rendererTarget(page: RendererPage, layout: RuntimeLayout): RendererTarget {
  const dev = safeDevServerUrl(layout.devServerUrl)
  if (dev) return { kind: 'url', url: `${dev}/${page}/index.html` }
  return { kind: 'file', path: join(rendererDir(layout), page, 'index.html') }
}

export function preloadPath(layout: RuntimeLayout): string {
  return resolve(layout.mainDir, '..', 'preload', 'index.cjs')
}

export function engineWorkerPath(layout: RuntimeLayout): string {
  return join(layout.mainDir, 'engine-worker.js')
}

/** Packaged resources (process.resourcesPath) or the repo's resources/ folder in development. */
export function resourcesDir(layout: RuntimeLayout): string {
  return layout.isPackaged ? layout.resourcesPath : join(layout.appPath, 'resources')
}

/**
 * Tray icon files to try, in order. The Frontend dev provides resources/tray/trayTemplate.png
 * (+ @2x, macOS template image) and resources/tray/tray.png (Windows/Linux). The last entry is the
 * app icon, which the caller must resize.
 */
export function trayIconCandidates(platform: NodeJS.Platform, resDir: string): { path: string; template: boolean; resize: boolean }[] {
  const tray = join(resDir, 'tray')
  const list =
    platform === 'darwin'
      ? [{ path: join(tray, 'trayTemplate.png'), template: true, resize: false }]
      : [{ path: join(tray, 'tray.png'), template: false, resize: false }]
  list.push({ path: join(resDir, 'icon.png'), template: false, resize: true })
  return list
}

/** Tray icon edge length (DIP) used when we must resize the fallback app icon. */
export function trayIconSize(platform: NodeJS.Platform): number {
  if (platform === 'darwin') return 18
  if (platform === 'win32') return 16
  return 22
}

/**
 * Is `url` one of our renderer pages? Used to reject IPC from anything else
 * (e.g. a navigated-away or injected frame).
 */
export function isTrustedRendererUrl(url: string, layout: RuntimeLayout): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  const dev = safeDevServerUrl(layout.devServerUrl)
  if (dev) {
    return u.origin === dev
  }
  if (u.protocol !== 'file:' || u.host !== '') return false
  let p: string
  try {
    p = fileURLToPath(u)
  } catch {
    return false
  }
  const rel = relative(rendererDir(layout), p)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}
