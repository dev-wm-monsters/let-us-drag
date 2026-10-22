// Preload (sandboxed, bundled to one CJS file): exposes exactly the LudApi as window.lud.
// Nothing else is exposed; ipcRenderer itself never reaches the page.
//
// E2E design: the onTest* listeners are attached only when main started this renderer with
// the '--lud-e2e' argument (webPreferences.additionalArguments, set only when LUD_E2E=1 and the
// app is not packaged). Main also never sends the test channels then. So in normal runs
// onTestDrop / onTestFeedDrop / onTestCancel are no-ops and those channels are never listened to.

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC, type LudApi, type LudTestApi, type OverlayArmInfo } from '../shared/api'
import { TEST_CANCEL_CHANNEL, TEST_DROP_CHANNEL, TEST_FEED_DROP_CHANNEL, type TestDropPayload } from '../shared/test-hooks'
import type { JobEvent, PlatformStatus, Settings } from '../shared/types'

const E2E = process.argv.includes('--lud-e2e')

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
