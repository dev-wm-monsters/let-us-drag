// E2E test-hook contract (Playwright `_electron`). Contract owner: TPM.
// Active ONLY when the app is started with env LUD_E2E=1; otherwise never installed.
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
}

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
 */
export {}
