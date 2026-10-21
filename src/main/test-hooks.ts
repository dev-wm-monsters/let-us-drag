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
import type { LudTestHooks, TestDropPayload } from '../shared/test-hooks'
import type { JobEvent, OptionId } from '../shared/types'
import { optionIdSchema, parseOrThrow, pathListSchema } from './ipc-validation'
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

export function installTestHooks(hooks: LudTestHooks): void {
  ;(globalThis as { __ludTest?: LudTestHooks }).__ludTest = hooks
}
