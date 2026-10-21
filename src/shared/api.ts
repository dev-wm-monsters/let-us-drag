// IPC channel names and the preload API (window.lud). Contract owner: TPM.
import type { TestDropPayload } from './test-hooks'
import type { DroppedItem, JobEvent, JobRequest, OptionId, PlatformStatus, Settings } from './types'

export const IPC = {
  // renderer → main (invoke)
  describePaths: 'lud:describe-paths', // (paths: string[]) => DroppedItem[]
  startJob: 'lud:start-job', // (req: JobRequest) => void   (events arrive on jobEvent)
  cancelJob: 'lud:cancel-job', // (jobId: string) => void
  revealPath: 'lud:reveal-path', // (path: string) => void  (only paths produced by a job)
  getSettings: 'lud:get-settings', // () => Settings
  setSettings: 'lud:set-settings', // (patch: Partial<Settings>) => Settings
  getPlatformStatus: 'lud:get-platform-status', // () => PlatformStatus
  requestAccessibility: 'lud:request-accessibility', // () => boolean (macOS)
  overlayInteractive: 'lud:overlay-interactive', // (interactive: boolean) => void (focus/click for feedMe)
  overlayDone: 'lud:overlay-done', // () => void  renderer finished its leave animation
  openFeedWindow: 'lud:open-feed-window', // () => void
  overlayEngaged: 'lud:overlay-engaged', // () => void  renderer saw a real file dragenter; overlay is now visible (stop following the cursor)
  openSettingsWindow: 'lud:open-settings-window', // () => void
  // main → renderer (send)
  jobEvent: 'lud:job-event', // JobEvent
  overlayArm: 'lud:overlay-arm', // (info: OverlayArmInfo)
  overlayDisarm: 'lud:overlay-disarm', // ()  mouse released without a file drop
  cursor: 'lud:cursor', // (p: {x:number,y:number}) cursor in overlay-window coordinates (for eye tracking)
  settingsChanged: 'lud:settings-changed', // (s: Settings)
  platformStatusChanged: 'lud:platform-status-changed' // (s: PlatformStatus) e.g. after macOS Accessibility is granted
} as const

export interface OverlayArmInfo {
  /** Cursor position inside the overlay window, CSS pixels. */
  cursor: { x: number; y: number }
  settings: Settings
}

/** API exposed on window.lud by the preload script. */
export interface LudApi {
  /** Resolve absolute paths for dropped File objects (Electron webUtils). */
  pathsForFiles(files: File[]): string[]
  describePaths(paths: string[]): Promise<DroppedItem[]>
  startJob(req: JobRequest): Promise<void>
  cancelJob(jobId: string): Promise<void>
  revealPath(path: string): Promise<void>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  getPlatformStatus(): Promise<PlatformStatus>
  requestAccessibility(): Promise<boolean>
  setOverlayInteractive(interactive: boolean): Promise<void>
  overlayDone(): Promise<void>
  openFeedWindow(): Promise<void>
  onJobEvent(cb: (e: JobEvent) => void): () => void
  onOverlayArm(cb: (info: OverlayArmInfo) => void): () => void
  onOverlayDisarm(cb: () => void): () => void
  onCursor(cb: (p: { x: number; y: number }) => void): () => void
  onSettingsChanged(cb: (s: Settings) => void): () => void
  /** Overlay renderer received a file dragenter and shows the Uncle (main: stop moving the sensor). */
  overlayEngaged(): Promise<void>
  openSettingsWindow(): Promise<void>
  onPlatformStatusChanged(cb: (s: PlatformStatus) => void): () => void
  /**
   * E2E only (LUD_E2E=1): simulated drops sent by the test hooks (src/shared/test-hooks.ts).
   * In normal runs this never calls back and returns a no-op unsubscribe.
   */
  onTestDrop(cb: (p: TestDropPayload) => void): () => void
  /**
   * E2E only (LUD_E2E=1): simulated drops on the Feed Window (`LudTestHooks.dropFilesOnFeed`).
   * The feed renderer handles them exactly like `onTestDrop` (optionId null = drop on the mouth).
   * Optional so the preload can add it independently; the renderer treats a missing method as a no-op.
   */
  onTestFeedDrop?(cb: (p: TestDropPayload) => void): () => void
  /**
   * E2E only (LUD_E2E=1): `LudTestHooks.cancelActive()` asks the renderer that owns the running job
   * to cancel it through the same code path as the "Spit it out" button / Esc (calls cancelJob and
   * plays the spit-back). Renderers that are not busy ignore it. Optional, like onTestFeedDrop.
   */
  onTestCancel?(cb: () => void): () => void
}

export type { OptionId }
