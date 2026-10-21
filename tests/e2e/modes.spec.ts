// E2E-MODES: Hungry Mode, Plain Mode, refuse wording, and the chew moods hamster / struggle
// (TPM decision D1: overlay root exposes data-uncle-mood="hamster|struggle|none").
// Test plan IDs: E2E-74..E2E-78 (docs/qa/TEST_PLAN.md §15), UNC-07, UNC-09, UNC-10, UNC-14, UNC-26.
import { closeSync, openSync, ftruncateSync } from 'node:fs'
import { join } from 'node:path'
import { expect, expectUncleState, hook, test, waitForTerminalEvent } from './support/app'
import { makeBlocked, makePng } from './support/fixtures'
import { armOverlay, convertViaDrop, expectNoNewJob, expectOverlayHidesItself, outputsOf } from './support/flows'
import { expectedOutputPath, firstStateDuration, isSubsequence } from './support/naming'
import { NEEDS_P2, changeSettings, expectAttr, stageSamples, startStageRecorder } from './support/p2'

/** A sparse file (no disk blocks used) that reports `bytes` as its size. */
function sparseFile(path: string, bytes: number): string {
  const fd = openSync(path, 'w')
  try {
    ftruncateSync(fd, bytes)
  } finally {
    closeSync(fd)
  }
  return path
}

test.describe('settings-driven modes', () => {
  test('E2E-74 Hungry Mode: no chew minimum (chew shorter than the normal 700 ms)', async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    await changeSettings(app, { hungryMode: true })
    // Warm-up: the first job also starts sharp in the engine; measure the second one.
    const warm = await makePng(join(lud.workDir, 'warm.png'))
    expect((await convertViaDrop(app, testInfo, 'hungry-warmup', [warm], 'to-jpg')).event.type).toBe('done')
    await expectOverlayHidesItself(app)

    const input = await makePng(join(lud.workDir, 'snack.png'))
    const { event, timeline } = await convertViaDrop(app, testInfo, 'hungry', [input], 'to-jpg')
    expect(event.type, JSON.stringify(event)).toBe('done')
    expect(outputsOf(event)).toEqual([expectedOutputPath(input, 'jpg')])
    const states = timeline.map((s) => s.state)
    expect(states, states.join(' → ')).toContain('spit')
    const chewMs = firstStateDuration(timeline, 'chew')
    // Chew may be skipped entirely for a job that finishes during "eat"; if shown, it is short.
    if (chewMs !== null) expect(chewMs, `chew lasted ${chewMs} ms in Hungry Mode`).toBeLessThan(650)
    await expectOverlayHidesItself(app)
  })

  test('E2E-75 Plain Mode: no character, the plain ring still converts', async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    await changeSettings(app, { plainMode: true })
    const input = await makePng(join(lud.workDir, 'plain.png'))
    const armed = await armOverlay(app, testInfo, 'plain')
    try {
      await hook(app, 'dropFiles', [input], null)
      await expectUncleState(armed.overlay, 'feedMe')
      await expect(armed.overlay.getByTestId('overlay-root')).toHaveAttribute('data-plain', 'true')
      await expect(armed.overlay.getByTestId('plain-target')).toBeVisible()
      await expect(armed.overlay.getByTestId('uncle'), 'Plain Mode must not render the character').toHaveCount(0)
      await armed.overlay.getByTestId('option-to-webp').click()
      const event = await waitForTerminalEvent(app, armed.eventsBefore)
      expect(event.type, JSON.stringify(event)).toBe('done')
      expect(outputsOf(event)).toEqual([expectedOutputPath(input, 'webp')])
      await expectUncleState(armed.overlay, 'spit')
      await expect(armed.overlay.getByTestId('uncle')).toHaveCount(0)
    } finally {
      await armed.stopScreens()
    }
    await expectOverlayHidesItself(app)
  })

  test('E2E-76 refuse says "Nope" — mouth drop and option drop, any case of a blocked extension', async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    for (const [name, option] of [
      ['Setup.EXE', null],
      ['installer.dmg', 'zip'],
      ['run.sh', 'to-txt']
    ] as const) {
      const input = makeBlocked(join(lud.workDir, name))
      const armed = await armOverlay(app, testInfo, `refuse-${name}`)
      try {
        await hook(app, 'dropFiles', [input], option)
        await expectUncleState(armed.overlay, 'refuse')
        await expect(armed.overlay.getByTestId('speech-bubble'), name).toHaveText(/nope/i)
        await expectNoNewJob(app, armed.eventsBefore, 1_000)
      } finally {
        await armed.stopScreens()
      }
      await expectOverlayHidesItself(app)
    }
  })
})

test.describe('chew moods (data-uncle-mood, TPM D1)', () => {
  test('E2E-77 hamster: 3+ files puff the cheeks while chewing', { tag: NEEDS_P2 }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const inputs = await Promise.all(['h1.png', 'h2.png', 'h3.png'].map((n) => makePng(join(lud.workDir, n))))
    const armed = await armOverlay(app, testInfo, 'hamster')
    await startStageRecorder(armed.overlay, 'overlay-root')
    try {
      await hook(app, 'dropFiles', inputs, 'to-jpg')
      await expectAttr(armed.overlay, 'overlay-root', 'data-uncle-mood', 'hamster')
      const event = await waitForTerminalEvent(app, armed.eventsBefore)
      expect(event.type, JSON.stringify(event)).toBe('done')
      await expectUncleState(armed.overlay, 'spit') // the job can finish while he is still in "eat"
      const samples = await stageSamples(armed.overlay, 'overlay-root')
      expect(samples.some((s) => s.state === 'chew' && s.mood === 'hamster'), JSON.stringify(samples)).toBe(true)
      expect(samples.some((s) => s.mood === 'struggle'), 'small files never struggle').toBe(false)
    } finally {
      await armed.stopScreens()
    }
  })

  test('E2E-78 struggle: an input > 200 MB makes him sweat while chewing', { tag: NEEDS_P2 }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const big = sparseFile(join(lud.workDir, 'huge.bin'), 210 * 1024 * 1024)
    const armed = await armOverlay(app, testInfo, 'struggle')
    await startStageRecorder(armed.overlay, 'overlay-root')
    try {
      await hook(app, 'dropFiles', [big], 'zip')
      await expectAttr(armed.overlay, 'overlay-root', 'data-uncle-mood', 'struggle')
      const event = await waitForTerminalEvent(app, armed.eventsBefore)
      expect(event.type, JSON.stringify(event)).toBe('done')
      expect(outputsOf(event)).toEqual([join(lud.workDir, 'huge.zip')])
      await expectUncleState(armed.overlay, 'spit')
      const samples = await stageSamples(armed.overlay, 'overlay-root')
      expect(samples.some((s) => s.state === 'chew' && s.mood === 'struggle'), JSON.stringify(samples)).toBe(true)
    } finally {
      await armed.stopScreens()
    }
  })

  test('E2E-79 a single small file chews with mood "none"', { tag: NEEDS_P2 }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = await makePng(join(lud.workDir, 'one.png'))
    const armed = await armOverlay(app, testInfo, 'mood-none')
    await startStageRecorder(armed.overlay, 'overlay-root')
    try {
      await hook(app, 'dropFiles', [input], 'to-jpg')
      const event = await waitForTerminalEvent(app, armed.eventsBefore)
      expect(event.type, JSON.stringify(event)).toBe('done')
      await expectUncleState(armed.overlay, 'spit')
      const samples = await stageSamples(armed.overlay, 'overlay-root')
      const chew = samples.filter((s) => s.state === 'chew')
      expect(chew.length, JSON.stringify(samples)).toBeGreaterThan(0)
      expect(isSubsequence(['chew', 'spit'], samples.map((s) => s.state))).toBe(true)
      for (const s of chew) expect(s.mood).toBe('none')
    } finally {
      await armed.stopScreens()
    }
  })
})
