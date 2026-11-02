// E2E test-hook contract (Playwright `_electron`). Contract owner: TPM.
// Active ONLY when the app is started with env LUD_E2E=1; otherwise never installed.
import type { LicenceView } from './licence'
import type { JobEvent, OptionId } from './types'

/**
 * Installed by main as `globalThis.__ludTest` when LUD_E2E=1.
 * Use from Playwright: `await app.evaluate(async () => globalThis.__ludTest.arm())`.
 */
export interface LudTestHooks {
  /** Simulate the global trigger arming (drag + key) at the center of the primary display. */
  arm(): Promise<void>
  /**
   * Simulate a file drag entering the overlay and being dropped.
   * optionId = option to drop on, or null to drop on the Uncle's mouth (feedMe flow).
   * Goes through the same renderer code path as a real drop once paths are known.
   */
  dropFiles(paths: string[], optionId: OptionId | null): Promise<void>
  /** Simulate releasing the mouse without dropping on the overlay. */
  disarm(): Promise<void>
  /** Whether the overlay window is currently shown. */
  overlayVisible(): boolean
  /** All job events emitted since app start (for assertions). */
  jobEvents(): JobEvent[]
  openFeedWindow(): Promise<void>
  openSettingsWindow(): Promise<void>
  /**
   * ADDITIVE (Platform, TPM D2): simulate files dropped on the Feed Window's drop zone.
   * Opens the Feed Window if needed, then delivers TEST_FEED_DROP_CHANNEL to the feed renderer.
   * optionId = option to pick, or null to just "hold" the files (feedMe flow), like dropFiles.
   */
  dropFilesOnFeed(paths: string[], optionId: OptionId | null): Promise<void>
  /**
   * ADDITIVE (Platform, TPM D3): press the visible cancel button ("Spit it out").
   * Delivers TEST_CANCEL_CHANNEL to the overlay and Feed Window renderers; a renderer with a
   * running job cancels it through the same code path as its cancel button. Renderers without a
   * running job ignore it. Resolves when delivered (watch jobEvents() for the CANCELLED event).
   */
  cancelActive(): Promise<void>
  /** ADDITIVE (D26): the licence state main holds (what renderers get from getLicence). */
  licence(): LicenceView
  /**
   * ADDITIVE (D26): run the background licence re-check now, through the same code path as its
   * timer. Resolves with 'valid' | 'transient' | 'disabled' | 'reactivate', or null (nothing to check).
   */
  licenceRecheckNow(): Promise<string | null>
  /** ADDITIVE (D26): what powerMonitor 'resume' does (reschedules the re-check when 24 h are over). */
  licenceResume(): Promise<void>
  /**
   * ADDITIVE (D26): URLs main would have opened in the default browser (shell.openExternal is
   * replaced by this recorder in E2E runs, so no browser starts).
   */
  openedUrls(): string[]
}

/**
 * E2E-only launch environment for licensing (D26), honoured ONLY when LUD_E2E=1 and the app is not
 * packaged (D12, D18):
 * - LUD_E2E_LICENSE=active: start with an active licence (no network). The E2E fixture sets it by
 *   default so the conversion specs keep converting; licensing specs pass 'none'.
 * - LUD_E2E_DODO_URL=http://127.0.0.1:<port>: the mock Dodo server (loopback only). Without it the
 *   client points at an unroutable local address, so E2E never reaches Dodo.
 */
export const E2E_LICENCE_ENV = 'LUD_E2E_LICENSE' as const
export const E2E_DODO_URL_ENV = 'LUD_E2E_DODO_URL' as const

/** IPC channel used by main to deliver a simulated drop to the overlay renderer (E2E only). */
export const TEST_DROP_CHANNEL = 'lud:test-drop' as const
export interface TestDropPayload {
  paths: string[]
  optionId: OptionId | null
}

/** ADDITIVE (TPM D2): main → feed renderer, payload TestDropPayload (E2E only, like TEST_DROP_CHANNEL). */
export const TEST_FEED_DROP_CHANNEL = 'lud:test-feed-drop' as const
/** ADDITIVE (TPM D3): main → overlay/feed renderers, no payload (E2E only). */
export const TEST_CANCEL_CHANNEL = 'lud:test-cancel' as const

/**
 * DOM contract for E2E/visual tests (renderer must honour):
 * - overlay root element has `data-testid="overlay-root"` and `data-uncle-state="<state>"` where
 *   state ∈ hidden|appear|hover|feedMe|eat|chew|spit|choke|refuse|leave
 * - each option bubble has `data-testid="option-<OptionId>"`
 * - output card has `data-testid="output-card"`, error message `data-testid="error-message"`
 * - feed window drop zone `data-testid="feed-dropzone"`; settings controls `data-testid="setting-<key>"`
 * Additive (Frontend):
 * - overlay root also carries `data-hamster` / `data-struggle` ("true"|"false") and `data-plain`
 * - feed window stage `data-testid="feed-root"` with `data-uncle-state` (adds 'idle' = resting, Uncle visible)
 * - `data-testid="speech-bubble"`, `"progress-ring"`, `"held-files"` (feedMe with dropped files),
 *   `"plain-target"` (Plain Mode), `"feed-pick"` (Feed Window file picker button)
 * - settings: `data-testid="settings-root"` (data-loaded="true" once settings arrived), `"onboarding"`,
 *   `"onboarding-done"`, `"platform-status"`, `"accessibility-section"`, `"grant-accessibility"`,
 *   `"open-feed-window"`, `"test-sound"`
 * - option bubbles are <button>s: clickable only while files are held (feedMe after a drop on the mouth)
 * Additive (Frontend, phase 2):
 * - overlay root and feed root carry `data-uncle-mood` = "hamster" | "struggle" | "none" (TPM D1;
 *   struggle wins when both apply; set from the drop until the session rests, like data-hamster)
 * - `data-uncle-state` may also be `cancel` (TPM D3): the user cancelled during eat/chew; the Uncle spits
 *   the file back, the speech bubble says "Fine, keep it.", then → leave → hidden (feed: idle) after ~1.4 s.
 *   A CANCELLED job error for the running job enters the same state.
 * - `data-testid="cancel-job"` ("Spit it out" button on the progress ring) exists only while chewing;
 *   clicking it, Esc (window focused) and `cancelActive()` (renderer side: LudApi.onTestCancel) all run
 *   the same code path: one `cancelJob(jobId)` call, sent after the startJob invoke settled.
 * - Feed Window handles `dropFilesOnFeed` via LudApi.onTestFeedDrop (same path as onTestDrop).
 */
export {}
