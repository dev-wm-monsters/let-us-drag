// Security baseline shared by every window / session (docs/PLAN.md §3, task brief).

import type { Session, WebContents, WebPreferences } from 'electron'

/** webPreferences every app window uses (callers may add, never weaken). */
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
    navigateOnDragDrop: false,
    spellcheck: false
  }
}

/** Block navigation, new windows and <webview> for one webContents. */
export function hardenWebContents(wc: WebContents): void {
  wc.on('will-navigate', (event) => event.preventDefault())
  wc.on('will-redirect', (event) => event.preventDefault())
  wc.on('will-attach-webview', (event) => event.preventDefault())
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
}

/** Deny every permission request / check (camera, notifications, clipboard-read, …). */
export function hardenSession(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.setDevicePermissionHandler(() => false)
}
