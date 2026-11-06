// IPC channel names and the preload API (window.lud). Contract owner: TPM.
import type { LicenceActionResult, LicenceLink, LicenceView, StartJobResult } from './licence'
import type { TestDropPayload } from './test-hooks'
import type { UpdateCheckResult, UpdateView } from './update'
import type { DroppedItem, JobEvent, JobRequest, OptionId, PlatformStatus, Settings } from './types'

export const IPC = {
  // renderer → main (invoke)
  describePaths: 'lud:describe-paths', // (paths: string[]) => DroppedItem[]
  startJob: 'lud:start-job', // (req: JobRequest) => StartJobResult (events arrive on jobEvent; refused without a licence, D26)
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
  overlayClickThrough: 'lud:overlay-click-through', // (clickThrough: boolean) => void  D20: ignore mouse except over interactive elements
  // licence (TPM D26): renderers see the state only; keys, instance IDs and network calls stay in main
  getLicence: 'lud:get-licence', // () => LicenceView
  activateLicence: 'lud:activate-licence', // (key: string) => LicenceActionResult   (settings only)
  deactivateLicence: 'lud:deactivate-licence', // () => LicenceActionResult           (settings only)
  openLicenceLink: 'lud:open-licence-link', // (link: LicenceLink) => void  opens checkout / website in the default browser
  openActivation: 'lud:open-activation', // () => void  "I have a key": opens Settings → Activate
  // --- updates (TPM D29) begin: renderers see an UpdateView only; URLs and the network stay in main
  getUpdate: 'lud:get-update', // () => UpdateView
  checkForUpdates: 'lud:check-for-updates', // () => UpdateCheckResult   (settings only)
  dismissUpdate: 'lud:dismiss-update', // () => UpdateView  "Later" for this version   (settings only)
  openUpdateDownload: 'lud:open-update-download', // () => void  opens this computer's download in the default browser
  updateHintSeen: 'lud:update-hint-seen', // () => void  the Uncle announced the soft update (once per version)
  // --- updates (TPM D29) end
  // crash reporting (TPM D28)
  openReportProblem: 'lud:open-report-problem', // () => void  Settings "Report a problem": mailto with version + OS (main builds the URL)
  // main → renderer (send)
  jobEvent: 'lud:job-event', // JobEvent
  overlayArm: 'lud:overlay-arm', // (info: OverlayArmInfo)
  overlayDisarm: 'lud:overlay-disarm', // ()  mouse released without a file drop
  cursor: 'lud:cursor', // (p: {x:number,y:number}) cursor in overlay-window coordinates (for eye tracking)
  settingsChanged: 'lud:settings-changed', // (s: Settings)
  platformStatusChanged: 'lud:platform-status-changed', // (s: PlatformStatus) e.g. after macOS Accessibility is granted
  licenceChanged: 'lud:licence-changed', // (v: LicenceView)
  updateChanged: 'lud:update-changed' // (v: UpdateView)  D29
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
  /**
   * Resolves `{ started: false, reason: 'LICENCE_REQUIRED' }` when main refuses (no active licence, D26),
   * `reason: 'UPDATE_REQUIRED'` while a forced update is pending (D29).
   */
  startJob(req: JobRequest): Promise<StartJobResult>
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
  /** D20: when true the overlay ignores the mouse (forwarding moves) except where the renderer turns it off. */
  setOverlayClickThrough(clickThrough: boolean): Promise<void>
  onPlatformStatusChanged(cb: (s: PlatformStatus) => void): () => void
  /** Licence state (D26): status + masked key only. */
  getLicence(): Promise<LicenceView>
  /** Settings → Activate. The key is trimmed in main. */
  activateLicence(key: string): Promise<LicenceActionResult>
  /** Settings → Deactivate this computer. */
  deactivateLicence(): Promise<LicenceActionResult>
  /** Open the checkout or a website page in the default browser (never an in-app web view). */
  openLicenceLink(link: LicenceLink): Promise<void>
  /** "I have a key": open Settings with the Activate field. */
  openActivation(): Promise<void>
  onLicenceChanged(cb: (v: LicenceView) => void): () => void
  // --- updates (TPM D29) begin
  /** Update notice state (soft / force / up to date). */
  getUpdate(): Promise<UpdateView>
  /** Settings → "Check for updates" (`ok: false` when the check failed; the state is kept). */
  checkForUpdates(): Promise<UpdateCheckResult>
  /** Settings → "Later": hide the banner and the Uncle's bubble for this version. */
  dismissUpdate(): Promise<UpdateView>
  /** Open the download for this computer (main picks the allow-listed URL) in the default browser. */
  openUpdateDownload(): Promise<void>
  /** The Uncle showed the "I learned new tricks!" bubble (once per version). */
  updateHintSeen(): Promise<void>
  onUpdateChanged(cb: (v: UpdateView) => void): () => void
  // --- updates (TPM D29) end
  /** D28: Settings → "Report a problem" (opens a prefilled e-mail; no logs attached). Optional for older mocks. */
  openReportProblem?(): Promise<void>
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

/**
 * ADDITIVE (Platform, TPM D2/D3) — E2E-only subscriptions, exposed by the preload on window.lud
 * next to LudApi (the preload's object is `LudApi & LudTestApi`). They are a separate interface so
 * every existing LudApi implementation (e.g. the renderer dev mock) stays valid; the TPM may fold
 * them into LudApi once the Frontend implements them. Outside E2E both are no-ops that return a
 * no-op unsubscribe (same rules as onTestDrop).
 */
export interface LudTestApi {
  /** Simulated drop on the Feed Window (TEST_FEED_DROP_CHANNEL, from __ludTest.dropFilesOnFeed). */
  onTestFeedDrop(cb: (p: TestDropPayload) => void): () => void
  /** "Press the cancel button" (TEST_CANCEL_CHANNEL, from __ludTest.cancelActive). */
  onTestCancel(cb: () => void): () => void
}

export type { OptionId }
