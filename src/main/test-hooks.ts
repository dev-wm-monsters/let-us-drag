// E2E hooks (src/shared/test-hooks.ts). Installed as globalThis.__ludTest ONLY in E2E mode.
//
// Production safety (SEC-18, TPM D12):
// - app.ts loads this module with a dynamic import, and only when isE2E(env, app.isPackaged)
//   (LUD_E2E=1 AND not packaged; see e2e-mode.ts). A packaged build never installs the hooks.
// - The test channels (TEST_DROP_CHANNEL, TEST_FEED_DROP_CHANNEL, TEST_CANCEL_CHANNEL) are only
//   ever sent from here.
// - The preload only listens to them when main passed '--lud-e2e' to the renderer, which it does
//   only in E2E mode.

import { z } from 'zod'
import { TEST_FEED_DROP_CHANNEL, type LudTestHooks, type TestDropPayload } from '../shared/test-hooks'
import type { JobEvent, OptionId } from '../shared/types'
import { optionIdSchema, parseOrThrow, pathListSchema } from './ipc-validation'
import { withTimeout } from './serial-queue'
import type { Point } from './windows/overlay-geometry'

export interface TestHookDeps {
  primaryCenter(): Point
  overlay: {
    readonly phase: string
    arm(at?: Point): void
    disarm(): void
    isVisible(): boolean
    whenLoaded(): Promise<void>
    sendTestDrop(payload: TestDropPayload): void
  }
  jobEvents(): JobEvent[]
  openFeedWindow(): Promise<unknown>
  openSettingsWindow(): Promise<unknown>
  /** Open the Feed Window (if needed), wait for its page, deliver TEST_FEED_DROP_CHANNEL. */
  sendFeedDrop(payload: TestDropPayload): Promise<void>
  /** Deliver TEST_CANCEL_CHANNEL to the overlay and Feed Window renderers. */
  sendCancel(): void
}

const optionOrNull = z.union([optionIdSchema, z.null()])

function dropPayload(paths: unknown, optionId: unknown): { paths: string[]; optionId: OptionId | null } {
  return { paths: parseOrThrow(pathListSchema, paths, 'paths'), optionId: parseOrThrow(optionOrNull, optionId, 'option id') }
}

export function createTestHooks(deps: TestHookDeps): LudTestHooks {
  return {
    async arm() {
      await deps.overlay.whenLoaded()
      deps.overlay.arm(deps.primaryCenter())
    },
    async dropFiles(paths, optionId) {
      const payload = dropPayload(paths, optionId)
      await deps.overlay.whenLoaded()
      if (deps.overlay.phase === 'hidden') deps.overlay.arm(deps.primaryCenter())
      deps.overlay.sendTestDrop(payload)
    },
    async disarm() {
      deps.overlay.disarm()
    },
    overlayVisible() {
      return deps.overlay.isVisible()
    },
    jobEvents() {
      return deps.jobEvents()
    },
    async openFeedWindow() {
      await deps.openFeedWindow()
    },
    async openSettingsWindow() {
      await deps.openSettingsWindow()
    },
    async dropFilesOnFeed(paths, optionId) {
      await deps.sendFeedDrop(dropPayload(paths, optionId))
    },
    async cancelActive() {
      deps.sendCancel()
    }
  }
}

/** The bits of the Feed Window that deliverFeedDrop uses (a BrowserWindow in the app). */
export interface FeedDropTarget {
  isDestroyed(): boolean
  webContents: {
    executeJavaScript(code: string): Promise<unknown>
    send(channel: string, payload: unknown): void
  }
}

/** Resolves once the feed page rendered its drop zone (max 10 s) and two frames passed. */
export const FEED_READY_SCRIPT = `new Promise((resolve) => {
  const t0 = Date.now()
  const done = () => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50)))
  const check = () => (document.querySelector('[data-testid="feed-dropzone"]') || Date.now() - t0 > 10000 ? done() : setTimeout(check, 50))
  check()
})`

/** Upper bound for the readiness wait (rAF never fires in a page that is not visible). */
export const FEED_READY_TIMEOUT_MS = 12_000

/**
 * Deliver a simulated drop to a Feed Window that `SingletonWindow.open()` returned (its page has
 * been loaded). B-055 / QA3-10: this used to wait for 'did-finish-load' when isLoading() was still
 * true right after a fresh open (loadFile() resolves before the loading flag clears), and that
 * event had already fired, so the hook never resolved. Now it only waits for the page's own
 * readiness (drop zone rendered + two frames: the React effect that subscribes has run), bounded
 * by a timeout, and then sends.
 */
export async function deliverFeedDrop(win: FeedDropTarget, payload: TestDropPayload, timeoutMs = FEED_READY_TIMEOUT_MS): Promise<void> {
  if (win.isDestroyed()) return
  await withTimeout(win.webContents.executeJavaScript(FEED_READY_SCRIPT), timeoutMs, 'feed page not ready').catch(() => undefined)
  if (!win.isDestroyed()) win.webContents.send(TEST_FEED_DROP_CHANNEL, payload)
}

export function installTestHooks(hooks: LudTestHooks): void {
  ;(globalThis as { __ludTest?: LudTestHooks }).__ludTest = hooks
}
