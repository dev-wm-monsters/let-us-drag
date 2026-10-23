// Preload (sandboxed, bundled to one CJS file): exposes exactly the LudApi as window.lud.
// Nothing else is exposed; ipcRenderer itself never reaches the page.
//
// E2E design: the onTest* listeners are attached only when main started this renderer with
// the '--lud-e2e' argument (webPreferences.additionalArguments, set only when LUD_E2E=1 and the
// app is not packaged). Main also never sends the test channels then. So in normal runs
// onTestDrop / onTestFeedDrop / onTestCancel are no-ops and those channels are never listened to.

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC, type LudApi, type LudTestApi, type OverlayArmInfo } from '../shared/api'
import { DEBUG_DRAG_CHANNEL, DEBUG_RENDERER_ARG } from '../shared/debug'
import { TEST_CANCEL_CHANNEL, TEST_DROP_CHANNEL, TEST_FEED_DROP_CHANNEL, type TestDropPayload } from '../shared/test-hooks'
import type { JobEvent, PlatformStatus, Settings } from '../shared/types'

const E2E = process.argv.includes('--lud-e2e')
// Field diagnostics (main passes this to the overlay only while LUD_DEBUG=1 / debug.flag).
const DEBUG = process.argv.includes(DEBUG_RENDERER_ARG)

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: LudApi & LudTestApi = {
  // 1:1 with the input; '' for a File that is not backed by a file on disk.
  pathsForFiles: (files) => Array.from(files, (f) => webUtils.getPathForFile(f)),
  describePaths: (paths) => ipcRenderer.invoke(IPC.describePaths, paths),
  startJob: (req) => ipcRenderer.invoke(IPC.startJob, req),
  cancelJob: (jobId) => ipcRenderer.invoke(IPC.cancelJob, jobId),
  revealPath: (path) => ipcRenderer.invoke(IPC.revealPath, path),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  getPlatformStatus: () => ipcRenderer.invoke(IPC.getPlatformStatus),
  requestAccessibility: () => ipcRenderer.invoke(IPC.requestAccessibility),
  setOverlayInteractive: (interactive) => ipcRenderer.invoke(IPC.overlayInteractive, interactive),
  overlayDone: () => ipcRenderer.invoke(IPC.overlayDone),
  openFeedWindow: () => ipcRenderer.invoke(IPC.openFeedWindow),
  onJobEvent: (cb) => subscribe<JobEvent>(IPC.jobEvent, cb),
  onOverlayArm: (cb) => subscribe<OverlayArmInfo>(IPC.overlayArm, cb),
  onOverlayDisarm: (cb) => subscribe<void>(IPC.overlayDisarm, () => cb()),
  onCursor: (cb) => subscribe<{ x: number; y: number }>(IPC.cursor, cb),
  onSettingsChanged: (cb) => subscribe<Settings>(IPC.settingsChanged, cb),
  overlayEngaged: () => ipcRenderer.invoke(IPC.overlayEngaged),
  openSettingsWindow: () => ipcRenderer.invoke(IPC.openSettingsWindow),
  setOverlayClickThrough: (clickThrough) => ipcRenderer.invoke(IPC.overlayClickThrough, clickThrough),
  onPlatformStatusChanged: (cb) => subscribe<PlatformStatus>(IPC.platformStatusChanged, cb),
  onTestDrop: (cb) => (E2E ? subscribe<TestDropPayload>(TEST_DROP_CHANNEL, cb) : () => undefined),
  onTestFeedDrop: (cb) => (E2E ? subscribe<TestDropPayload>(TEST_FEED_DROP_CHANNEL, cb) : () => undefined),
  onTestCancel: (cb) => (E2E ? subscribe<void>(TEST_CANCEL_CHANNEL, () => cb()) : () => undefined)
}

contextBridge.exposeInMainWorld('lud', api)

// ——— field diagnostics: report the window's HTML5 drag events to main (debug runs only) ———
// Only dataTransfer.types, item kinds/MIME types, file count, effects and whether the page
// accepted the event (defaultPrevented). Never file names, paths or contents. Listeners are on
// `window` in the capture phase, so they see every drag event that reaches this document, even if
// the page's own handlers ignore it. dragover is summarised (first one, then every 500 ms).
if (DEBUG) installDragDiagnostics()

// The preload is compiled without the DOM lib: structural types for what we read.
interface DragLike {
  type: string
  clientX: number
  clientY: number
  defaultPrevented: boolean
  dataTransfer: {
    types?: ArrayLike<string>
    items?: ArrayLike<{ kind: string; type: string }>
    files?: { length: number }
    effectAllowed: string
    dropEffect: string
  } | null
}
interface WindowLike {
  innerWidth: number
  innerHeight: number
  devicePixelRatio: number
  document: { visibilityState: string; hasFocus(): boolean }
  addEventListener(type: string, listener: (e: DragLike) => void, capture?: boolean): void
}

function installDragDiagnostics(): void {
  const w = globalThis as unknown as WindowLike
  const report = (text: string): void => ipcRenderer.send(DEBUG_DRAG_CHANNEL, text)
  let overs = 0
  let lastOverReport = 0
  const describe = (e: DragLike): string => {
    const dt = e.dataTransfer
    if (!dt) return 'dataTransfer=null'
    const items = Array.from(dt.items ?? [], (it) => `${it.kind}:${it.type || '?'}`)
    const files = e.type === 'drop' ? ` files=${dt.files?.length ?? 0}` : ''
    return `types=[${Array.from(dt.types ?? []).join(',')}] items=[${items.join(',')}]${files} effectAllowed=${dt.effectAllowed} dropEffect=${dt.dropEffect}`
  }
  const onEvent = (e: DragLike): void => {
    if (e.type === 'dragover') {
      overs++
      const now = Date.now()
      if (overs > 1 && now - lastOverReport < 500) return
      lastOverReport = now
    }
    const extra = e.type === 'dragover' ? ` (#${overs})` : ''
    if (e.type === 'dragenter' || e.type === 'drop') overs = 0
    // dataTransfer is only readable during dispatch: read it now, check defaultPrevented after
    // every listener (the page's included) has run.
    const inWindow = e.clientX >= 0 && e.clientY >= 0 && e.clientX <= w.innerWidth && e.clientY <= w.innerHeight
    const text = `${e.type}${extra} ${describe(e)} inWindow=${inWindow} visibility=${w.document.visibilityState} focus=${w.document.hasFocus()}`
    setTimeout(() => report(`${text} defaultPrevented=${e.defaultPrevented}`), 0)
  }
  for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) w.addEventListener(type, onEvent, true)
  w.addEventListener('DOMContentLoaded', () => report(`overlay page ready ${w.innerWidth}x${w.innerHeight} dpr=${w.devicePixelRatio}`))
}
