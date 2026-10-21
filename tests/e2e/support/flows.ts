// Reusable E2E flows built on the hook contract.
import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import type { JobEvent, OptionId } from '../../../src/shared/types'
import {
  T,
  expect,
  expectUncleState,
  hook,
  jobEvents,
  newJobEvents,
  recordedTimeline,
  startStateRecorder,
  waitForPage,
  waitForTerminalEvent,
  watchAndScreenshotStates,
  type StateSample
} from './app'

export interface ArmedOverlay {
  overlay: Page
  /** Number of job events recorded before the drop (for newJobEvents()). */
  eventsBefore: number
  /** Stops the screenshot watcher; returns states seen by polling. */
  stopScreens(): Promise<string[]>
}

/** Arm the trigger, wait for the overlay, start state recording + per-state screenshots. */
export async function armOverlay(app: ElectronApplication, testInfo: TestInfo, label: string): Promise<ArmedOverlay> {
  await hook(app, 'arm')
  await expect.poll(() => hook(app, 'overlayVisible'), { timeout: T.state, message: 'overlay not visible after arm()' }).toBe(true)
  const overlay = await waitForPage(app, 'overlay')
  await startStateRecorder(overlay)
  const watcher = watchAndScreenshotStates(overlay, testInfo, label)
  const eventsBefore = (await jobEvents(app)).length
  return { overlay, eventsBefore, stopScreens: () => watcher.stop() }
}

export interface ConversionResult {
  event: JobEvent
  timeline: StateSample[]
  overlay: Page
}

/** arm → dropFiles(paths, optionId) → wait for done/error. Leaves the overlay to hide on its own. */
export async function convertViaDrop(
  app: ElectronApplication,
  testInfo: TestInfo,
  label: string,
  paths: string[],
  optionId: OptionId
): Promise<ConversionResult> {
  const armed = await armOverlay(app, testInfo, label)
  try {
    await hook(app, 'dropFiles', paths, optionId)
    const event = await waitForTerminalEvent(app, armed.eventsBefore)
    // Let the renderer reach its reaction state so the watcher screenshots it; the caller asserts it.
    await expectUncleState(armed.overlay, event.type === 'done' ? 'spit' : 'choke').catch(() => undefined)
    return { event, timeline: await recordedTimeline(armed.overlay), overlay: armed.overlay }
  } finally {
    await armed.stopScreens()
  }
}

/** Wait until the overlay has hidden itself (2.5 s after spit/choke/refuse + leave animation). */
export async function expectOverlayHidesItself(app: ElectronApplication): Promise<void> {
  await expect
    .poll(() => hook(app, 'overlayVisible'), { timeout: T.hide, message: 'overlay stuck visible after the flow ended' })
    .toBe(false)
}

/** Assert that no job was started since `before`, waiting a little to catch late starts. */
export async function expectNoNewJob(app: ElectronApplication, before: number, waitMs = 2_000): Promise<void> {
  await new Promise((r) => setTimeout(r, waitMs))
  expect(await newJobEvents(app, before), 'no job must be started').toEqual([])
}

export function outputsOf(event: JobEvent): string[] {
  if (event.type !== 'done') throw new Error(`expected a done event, got ${JSON.stringify(event)}`)
  return event.outputPaths
}
