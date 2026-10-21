// IPC channel names and the preload API (window.lud). Contract owner: TPM.
import type { DroppedItem, JobEvent, JobRequest, OptionId, PlatformStatus, Settings } from './types'
import type { TestDropPayload } from './test-hooks'

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
  // main → renderer (send)
  jobEvent: 'lud:job-event', // JobEvent
  overlayArm: 'lud:overlay-arm', // (info: OverlayArmInfo)
  overlayDisarm: 'lud:overlay-disarm', // ()  mouse released without a file drop
  cursor: 'lud:cursor', // (p: {x:number,y:number}) cursor in overlay-window coordinates (for eye tracking)
  settingsChanged: 'lud:settings-changed' // (s: Settings)
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
  /**
   * E2E only: main forwards TEST_DROP_CHANNEL (src/shared/test-hooks.ts) here when LUD_E2E=1.
   * Outside E2E the preload may return a no-op unsubscribe and never call cb.
   */
  onTestDrop(cb: (p: TestDropPayload) => void): () => void
}

export type { OptionId }
