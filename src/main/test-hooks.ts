// E2E hooks (src/shared/test-hooks.ts). Installed as globalThis.__ludTest ONLY when LUD_E2E=1.
//
// Production safety:
// - index.ts calls installTestHooks() only when process.env.LUD_E2E === '1'.
// - TEST_DROP_CHANNEL is only ever sent from here (OverlayController.sendTestDrop).
// - The preload only listens to TEST_DROP_CHANNEL when main passed '--lud-e2e' to the renderer,
//   which it does only when LUD_E2E=1.
// LUD_E2E is read from the environment of the app process; anyone who can set it can already run
// arbitrary code as the user, so it does not widen the attack surface.

import { z } from 'zod'
import type { LudTestHooks } from '../shared/test-hooks'
import type { JobEvent, OptionId } from '../shared/types'
import { optionIdSchema, parseOrThrow, pathListSchema } from './ipc-validation'
import type { Point } from './windows/overlay-geometry'

export function isE2E(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env['LUD_E2E'] === '1'
}

export interface TestHookDeps {
  primaryCenter(): Point
  overlay: {
    readonly phase: string
    arm(at?: Point): void
    disarm(): void
    isVisible(): boolean
    whenLoaded(): Promise<void>
    sendTestDrop(payload: { paths: string[]; optionId: OptionId | null }): void
  }
  jobEvents(): JobEvent[]
  openFeedWindow(): Promise<unknown>
  openSettingsWindow(): Promise<unknown>
}

export function createTestHooks(deps: TestHookDeps): LudTestHooks {
  return {
    async arm() {
      await deps.overlay.whenLoaded()
      deps.overlay.arm(deps.primaryCenter())
    },
    async dropFiles(paths, optionId) {
      const p = parseOrThrow(pathListSchema, paths, 'paths')
      const o = parseOrThrow(z.union([optionIdSchema, z.null()]), optionId, 'option id')
      await deps.overlay.whenLoaded()
      if (deps.overlay.phase === 'hidden') deps.overlay.arm(deps.primaryCenter())
      deps.overlay.sendTestDrop({ paths: p, optionId: o })
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
    }
  }
}

export function installTestHooks(hooks: LudTestHooks): void {
  ;(globalThis as { __ludTest?: LudTestHooks }).__ludTest = hooks
}
