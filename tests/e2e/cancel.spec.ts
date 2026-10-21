// E2E-CANCEL: cancelling a running conversion (TPM decision D3): the "Spit it out" button on the
// progress ring ([data-testid=cancel-job]) and the __ludTest.cancelActive() hook share one code path.
// Expected: a CANCELLED job event, no output and no temp file left next to the input, no ffmpeg
// child left running, the Uncle leaves, and the app keeps working.
// Test plan IDs: E2E-80, E2E-81 (docs/qa/TEST_PLAN.md §15), ERR-05, UNC-16.
import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import type { LudApi } from '../../src/shared/api'
import { T, expect, expectUncleState, hook, newJobEvents, test, waitForTerminalEvent } from './support/app'
import { listNames, makePng, resolveFfmpeg } from './support/fixtures'
import { armOverlay, convertViaDrop, expectOverlayHidesItself } from './support/flows'
import { NEEDS_P2, hookP2, processesMentioning } from './support/p2'

/** 30 s 720p H.264 clip: VP9 encoding it takes several seconds even on a fast machine. */
function makeLongVideo(ffmpeg: string, path: string): string {
  const r = spawnSync(
    ffmpeg,
    [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', path
    ],
    { shell: false, stdio: ['ignore', 'ignore', 'pipe'], timeout: 120_000 }
  )
  if (r.status !== 0) throw new Error(`ffmpeg failed to create ${path}: ${r.stderr?.toString() ?? ''}`)
  return path
}

async function cancelFlow(
  app: ElectronApplication,
  testInfo: TestInfo,
  label: string,
  workDir: string,
  cancel: (overlay: Page, jobId: string) => Promise<void>
): Promise<void> {
  const ffmpeg = resolveFfmpeg()
  test.skip(ffmpeg === null, 'ffmpeg not available (set LUD_FFMPEG_PATH or put ffmpeg on PATH)')
  const input = makeLongVideo(ffmpeg!, join(workDir, 'long.mp4'))

  const armed = await armOverlay(app, testInfo, label)
  try {
    await hook(app, 'dropFiles', [input], 'to-webm')
    await expectUncleState(armed.overlay, 'chew')
    // Make sure the encoder is really running (a progress event > 0) before cancelling.
    await expect
      .poll(async () => (await newJobEvents(app, armed.eventsBefore)).some((e) => e.type === 'progress' && e.progress > 0), {
        timeout: T.job,
        message: 'no progress event from the running conversion'
      })
      .toBe(true)
    const jobId = (await newJobEvents(app, armed.eventsBefore))[0]!.jobId
    const started = Date.now()
    await cancel(armed.overlay, jobId)

    const event = await waitForTerminalEvent(app, armed.eventsBefore)
    expect(event.type, JSON.stringify(event)).toBe('error')
    if (event.type === 'error') expect(event.error.code).toBe('CANCELLED')
    expect(Date.now() - started, 'cancel must take effect quickly').toBeLessThan(10_000)
    const after = await newJobEvents(app, armed.eventsBefore)
    expect(after.filter((e) => e.type === 'done'), 'no done event after a cancel').toEqual([])
  } finally {
    await armed.stopScreens()
  }

  // The Uncle leaves; nothing stays on screen.
  await expectOverlayHidesItself(app)
  // No partial output, no hidden temp file (D3: "leaves no partial output"); no ffmpeg left running
  // (main kills/restarts the worker after ~5 s if needed).
  await expect.poll(() => listNames(workDir), { timeout: 10_000, message: 'partial output/temp left behind' }).toEqual(['long.mp4'])
  await expect.poll(() => processesMentioning(workDir), { timeout: 10_000, message: 'ffmpeg still running after cancel' }).toEqual([])

  // The app still converts afterwards (engine not wedged).
  const png = await makePng(join(workDir, 'after.png'))
  const again = await convertViaDrop(app, testInfo, `${label}-after`, [png], 'to-jpg')
  expect(again.event.type, JSON.stringify(again.event)).toBe('done')
}

test.describe('cancel during chew (TPM D3)', () => {
  test('E2E-82 window.lud.cancelJob(jobId) from the overlay → CANCELLED, no partial output, no orphan ffmpeg', async ({ lud }, testInfo) => {
    // The IPC path that the cancel button uses underneath (exists since phase 1).
    const app = await lud.launchReady()
    await cancelFlow(app, testInfo, 'cancel-ipc', lud.workDir, async (overlay, jobId) => {
      await overlay.evaluate((id) => (globalThis as unknown as { lud: LudApi }).lud.cancelJob(id), jobId)
    })
  })

  test('E2E-80 __ludTest.cancelActive() → CANCELLED, no partial output, Uncle leaves', { tag: NEEDS_P2 }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    await cancelFlow(app, testInfo, 'cancel-hook', lud.workDir, async () => {
      await hookP2(app, 'cancelActive')
    })
  })

  test('E2E-81 clicking [data-testid=cancel-job] ("Spit it out") → CANCELLED, no partial output, Uncle leaves', { tag: NEEDS_P2 }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    await cancelFlow(app, testInfo, 'cancel-click', lud.workDir, async (overlay) => {
      const button = overlay.getByTestId('cancel-job')
      await expect(button).toBeVisible({ timeout: T.state })
      // The button sits on the animated progress ring, which never becomes "stable" for Playwright's
      // actionability check; visibility is asserted above, so click without waiting for stability.
      await button.click({ force: true })
    })
  })
})
