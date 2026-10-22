// Security baseline shared by every window / session (docs/security/CHECKLIST.md §A, §I).

import type { Session, WebContents, WebPreferences } from 'electron'

/**
 * webPreferences every window uses, app windows and hidden helper windows alike (SEC-01/02).
 * Callers may add options (preload, session, javascript: false, …); the security-relevant keys
 * below always win, so they can never be weakened by a caller.
 */
export function secureWebPreferences(extra: WebPreferences = {}): WebPreferences {
  return {
    ...extra,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    experimentalFeatures: false,
    enableWebSQL: false,
    navigateOnDragDrop: false,
    safeDialogs: true,
    spellcheck: false
  }
}

const hardenedContents = new WeakSet<WebContents>()

/**
 * Block navigation (main frame and sub-frames), new windows and <webview> for one webContents
 * (SEC-05). Our pages never navigate themselves: main loads every page with loadFile/loadURL,
 * which does not emit these events, so every renderer-initiated navigation is refused.
 * Idempotent. Installed for every webContents by app 'web-contents-created' (app.ts), and again
 * explicitly by each window factory (so a window is safe even before that handler is wired).
 */
export function hardenWebContents(wc: WebContents): void {
  if (hardenedContents.has(wc)) return
  hardenedContents.add(wc)
  wc.on('will-navigate', (event) => event.preventDefault())
  wc.on('will-frame-navigate', (event) => event.preventDefault())
  wc.on('will-redirect', (event) => event.preventDefault())
  wc.on('will-attach-webview', (event) => event.preventDefault())
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
}

const hardenedSessions = new WeakSet<Session>()

/** Deny every permission request / check, screen capture and downloads (SEC-06). Idempotent. */
export function hardenSession(ses: Session): void {
  if (hardenedSessions.has(ses)) return
  hardenedSessions.add(ses)
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.setDevicePermissionHandler(() => false)
  // No source → getDisplayMedia() is rejected.
  ses.setDisplayMediaRequestHandler((_request, callback) => callback(null))
  ses.on('will-download', (event) => event.preventDefault())
  disableSpellChecker(ses)
}

const REMOTE_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:'])

/**
 * Pure decision for the default session's request filter (SEC-150): cancel every remote request
 * (http, https, ws, wss, ftp). `devOrigin` (only passed when the app is not packaged) is the
 * loopback electron-vite dev server, which is allowed.
 * Also cancelled: `file:` URLs that name a server (`file://server/share/…`, or the
 * `file:////server/…` spelling). On Windows Chromium opens those as UNC paths over SMB, which
 * sends the user's NTLM credentials to that server; our pages are local files (`file:///…`, no
 * host) and never need one.
 */
export function isBlockedAppRequest(url: string, devOrigin?: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return true
  }
  if (u.protocol === 'file:') return u.host !== '' || /^\/(?:[\\/]|%5c|%2f)/i.test(u.pathname)
  if (!REMOTE_PROTOCOLS.has(u.protocol)) return false
  if (devOrigin) {
    const ws = devOrigin.replace(/^http/, 'ws')
    if (u.origin === devOrigin || `${u.protocol}//${u.host}` === ws) return false
  }
  return true
}

/** Install the SEC-150 filter on the session used by our app windows. */
export function blockRemoteRequests(ses: Session, devOrigin: string | undefined, log?: (message: string) => void): void {
  ses.webRequest.onBeforeRequest((details, callback) => {
    const blocked = isBlockedAppRequest(details.url, devOrigin)
    if (blocked) log?.(`blocked request: ${details.url.slice(0, 120)}`)
    callback({ cancel: blocked })
  })
}

/** Never reached: setSpellCheckerDictionaryDownloadURL needs a URL; nothing listens on port 9 here. */
export const NO_DICTIONARY_URL = 'https://127.0.0.1:9/'

/**
 * TPM D22 / F-24 (B-059): no spell checker, so Chromium never downloads a Hunspell dictionary
 * (a request to redirector.gvt1.com at every launch on Windows/Linux; macOS uses the OS checker
 * and these calls are no-ops there). `spellcheck: false` in webPreferences alone does not stop the
 * session-level download. The download URL is pointed at an unroutable local address as a second
 * layer, in case a future Chromium starts the downloader anyway.
 */
export function disableSpellChecker(ses: Pick<Session, 'setSpellCheckerEnabled' | 'setSpellCheckerDictionaryDownloadURL'>): void {
  ses.setSpellCheckerEnabled(false)
  ses.setSpellCheckerDictionaryDownloadURL(NO_DICTIONARY_URL)
}
