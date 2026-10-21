// Pure path resolution for renderer pages, preload, resources and tray icons.

import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export type RendererPage = 'overlay' | 'feed' | 'settings'

export interface RuntimeLayout {
  /** Directory of the bundled main script (out/main). */
  mainDir: string
  /** ELECTRON_RENDERER_URL in `electron-vite dev`, otherwise undefined. Ignored when packaged (F-09). */
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

/**
 * The dev server origin we may load pages from: only in an unpackaged app (SEC-07 / F-09), and
 * only a loopback http(s) URL. A packaged app always loads its bundled files.
 */
export function devServerOrigin(layout: RuntimeLayout): string | undefined {
  return layout.isPackaged ? undefined : safeDevServerUrl(layout.devServerUrl)
}

export function rendererDir(layout: RuntimeLayout): string {
  return resolve(layout.mainDir, '..', 'renderer')
}

export function rendererTarget(page: RendererPage, layout: RuntimeLayout): RendererTarget {
  const dev = devServerOrigin(layout)
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

const PAGES: readonly RendererPage[] = ['overlay', 'feed', 'settings']

/**
 * Which of our renderer pages is `url`? null for anything else (another file, another origin,
 * a path that is not a page's index.html, a URL with credentials, ...). Used by IPC to reject
 * requests from anything but our own pages (SEC-11) and to apply the per-page allowlist (SEC-12).
 */
export function rendererPageOf(url: string, layout: RuntimeLayout): RendererPage | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.username !== '' || u.password !== '') return null
  const dev = devServerOrigin(layout)
  let rel: string
  if (dev) {
    if (u.origin !== dev) return null
    rel = u.pathname.replace(/^\/+/, '')
  } else {
    if (u.protocol !== 'file:' || u.host !== '') return null
    let p: string
    try {
      p = fileURLToPath(u)
    } catch {
      return null
    }
    rel = relative(rendererDir(layout), p)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
    rel = rel.split(sep).join('/')
  }
  return PAGES.find((pg) => rel === `${pg}/index.html`) ?? null
}

/**
 * Is `url` one of our renderer pages? Used to reject IPC from anything else
 * (e.g. a navigated-away or injected frame).
 */
export function isTrustedRendererUrl(url: string, layout: RuntimeLayout): boolean {
  return rendererPageOf(url, layout) !== null
}
