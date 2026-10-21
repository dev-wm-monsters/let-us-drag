// E2E-CONVERT: simulated drop → real conversion → output next to the input.
// Test plan IDs: E2E-20..E2E-32 (docs/qa/TEST_PLAN.md).
// All tests need Platform (__ludTest, engine host), Frontend (overlay DOM) and Engine (conversions).
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  NEEDS_INTEGRATION,
  expect,
  expectUncleState,
  hook,
  newJobEvents,
  recordedStates,
  test,
  waitForTerminalEvent
} from './support/app'
import { imageInfo, listNames, magic, makeBlocked, makeCorrupt, makeJpg, makePdf, makePng, makeWav, pdfPageCount, resolveFfmpeg, sha256 } from './support/fixtures'
import { armOverlay, convertViaDrop, expectNoNewJob, expectOverlayHidesItself, outputsOf } from './support/flows'
import { expectedOutputPath, firstStateDuration, isSubsequence } from './support/naming'

/** Friendly, short, no stack traces (PLAN: "short human message"). */
function expectFriendlyMessage(message: string | null): void {
  expect(message ?? '', 'error message must not be empty').not.toHaveLength(0)
  expect(message ?? '').not.toMatch(/\n\s+at\s/) // no stack trace
  expect((message ?? '').length, 'error message should be short').toBeLessThanOrEqual(200)
}

test.describe('conversion flows', () => {
  test('E2E-20 PNG → JPG: eat → chew → spit, output next to input and decodable', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = await makePng(join(lud.workDir, 'photo.png'), 64, 48)

    const { event, timeline, overlay } = await convertViaDrop(app, testInfo, 'png-to-jpg', [input], 'to-jpg')
    expect(event.type, JSON.stringify(event)).toBe('done')
    const outputs = outputsOf(event)
    expect(outputs).toEqual([expectedOutputPath(input, 'jpg')])
    expect(dirname(outputs[0]!)).toBe(lud.workDir)
    const info = await imageInfo(outputs[0]!)
    expect(info).toEqual({ format: 'jpeg', width: 64, height: 48 })

    const states = timeline.map((s) => s.state)
    expect(isSubsequence(['eat', 'chew', 'spit'], states), `states seen: ${states.join(' → ')}`).toBe(true)
    // PLAN §6: chew lasts at least 700 ms unless Hungry Mode (default off). 50 ms tolerance for timer granularity.
    const chewMs = firstStateDuration(timeline, 'chew')
    expect(chewMs, 'chew never ended').not.toBeNull()
    expect(chewMs!).toBeGreaterThanOrEqual(650)

    await expectUncleState(overlay, 'spit')
    const card = overlay.getByTestId('output-card')
    await expect(card).toBeVisible()
    await expect(card).toContainText('photo.jpg')

    // Never stuck visible: leaves ~2.5 s after spit.
    await expectOverlayHidesItself(app)
    // Input untouched.
    expect(listNames(lud.workDir)).toEqual(['photo.jpg', 'photo.png'])
  })

  test('E2E-21 drop on the mouth → feedMe → click an option → done; no-op option hidden', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = await makePng(join(lud.workDir, 'mouth.png'))
    const armed = await armOverlay(app, testInfo, 'feedme')
    try {
      await hook(app, 'dropFiles', [input], null)
      await expectUncleState(armed.overlay, 'feedMe')
      // Options for a PNG: no "to PNG" (no-op hiding, PLAN §5 / catalog.optionsFor).
      await expect(armed.overlay.getByTestId('option-to-jpg')).toBeVisible()
      await expect(armed.overlay.getByTestId('option-to-png')).toHaveCount(0)
      await armed.overlay.getByTestId('option-to-jpg').click()
      const event = await waitForTerminalEvent(app, armed.eventsBefore)
      expect(event.type, JSON.stringify(event)).toBe('done')
      expect(outputsOf(event)).toEqual([expectedOutputPath(input, 'jpg')])
      await expectUncleState(armed.overlay, 'spit')
      const states = await recordedStates(armed.overlay)
      expect(isSubsequence(['feedMe', 'eat', 'chew', 'spit'], states), states.join(' → ')).toBe(true)
    } finally {
      await armed.stopScreens()
    }
    await expectOverlayHidesItself(app)
  })

  test('E2E-22 blocked .exe → refuse, no job, nothing written', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = makeBlocked(join(lud.workDir, 'setup.exe'))
    const armed = await armOverlay(app, testInfo, 'blocked')
    try {
      await hook(app, 'dropFiles', [input], null)
      await expectUncleState(armed.overlay, 'refuse')
      await expect(armed.overlay.getByTestId('overlay-root')).toContainText(/nope/i)
      await expectNoNewJob(app, armed.eventsBefore)
    } finally {
      await armed.stopScreens()
    }
    await expectOverlayHidesItself(app)
    expect(listNames(lud.workDir)).toEqual(['setup.exe'])
  })

  test('E2E-23 blocked .exe dropped directly on an option is still refused', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    // Defence in depth: even if a caller names an option (here ZIP), blocked inputs never start a job.
    const app = await lud.launchReady()
    const input = makeBlocked(join(lud.workDir, 'tool.bat'))
    const armed = await armOverlay(app, testInfo, 'blocked-option')
    try {
      await hook(app, 'dropFiles', [input], 'zip')
      await expectUncleState(armed.overlay, 'refuse')
      await expectNoNewJob(app, armed.eventsBefore)
    } finally {
      await armed.stopScreens()
    }
    expect(listNames(lud.workDir)).toEqual(['tool.bat'])
  })

  test('E2E-24 corrupt image → choke with a friendly error, no output', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = makeCorrupt(join(lud.workDir, 'broken.png'))
    const { event, overlay } = await convertViaDrop(app, testInfo, 'corrupt', [input], 'to-jpg')
    expect(event.type, JSON.stringify(event)).toBe('error')
    if (event.type === 'error') {
      // TPM D6: undecodable input → INPUT_INVALID (TOOL_FAILED only for unexpected tool failures).
      expect(event.error.code).toBe('INPUT_INVALID')
      expectFriendlyMessage(event.error.message)
    }
    await expectUncleState(overlay, 'choke')
    const msg = overlay.getByTestId('error-message')
    await expect(msg).toBeVisible()
    expectFriendlyMessage(await msg.textContent())
    await expectOverlayHidesItself(app)
    expect(listNames(lud.workDir), 'no partial output may be left behind').toEqual(['broken.png'])
  })

  test('E2E-25 collision: never overwrite, use "name (1).ext" then "name (2).ext"', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = await makePng(join(lud.workDir, 'photo.png'))
    const existing = await makeJpg(join(lud.workDir, 'photo.jpg'))
    const existingHash = sha256(existing)

    const first = await convertViaDrop(app, testInfo, 'collision-1', [input], 'to-jpg')
    expect(outputsOf(first.event)).toEqual([join(lud.workDir, 'photo (1).jpg')])
    await expectOverlayHidesItself(app)

    const second = await convertViaDrop(app, testInfo, 'collision-2', [input], 'to-jpg')
    expect(outputsOf(second.event)).toEqual([join(lud.workDir, 'photo (2).jpg')])

    expect(sha256(existing), 'pre-existing photo.jpg must be untouched').toBe(existingHash)
    expect(listNames(lud.workDir)).toEqual(['photo (1).jpg', 'photo (2).jpg', 'photo.jpg', 'photo.png'])
    expect((await imageInfo(join(lud.workDir, 'photo (2).jpg'))).format).toBe('jpeg')
  })

  test('E2E-26 unicode + spaces in folder and file names', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const dir = join(lud.workDir, 'Dossier été 写真 (copy)')
    mkdirSync(dir)
    const input = await makePng(join(dir, 'mon fichier ñ 😀.png'))
    const { event } = await convertViaDrop(app, testInfo, 'unicode', [input], 'to-webp')
    expect(event.type, JSON.stringify(event)).toBe('done')
    const out = outputsOf(event)
    expect(out).toEqual([join(dir, 'mon fichier ñ 😀.webp')])
    expect((await imageInfo(out[0]!)).format).toBe('webp')
  })

  test('E2E-27 batch "each": 3 PNG → JPG gives 3 outputs next to their inputs', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const inputs = await Promise.all(['a.png', 'b.png', 'c.png'].map((n) => makePng(join(lud.workDir, n))))
    const { event } = await convertViaDrop(app, testInfo, 'batch-each', inputs, 'to-jpg')
    expect(event.type, JSON.stringify(event)).toBe('done')
    expect([...outputsOf(event)].sort()).toEqual(inputs.map((i) => expectedOutputPath(i, 'jpg')).sort())
    for (const o of outputsOf(event)) expect((await imageInfo(o)).format).toBe('jpeg')
  })

  test('E2E-28 batch "merge": 3 PNG → one PDF with 3 pages', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const inputs = await Promise.all(['p1.png', 'p2.png', 'p3.png'].map((n) => makePng(join(lud.workDir, n))))
    const { event } = await convertViaDrop(app, testInfo, 'batch-merge-pdf', inputs, 'to-pdf')
    expect(event.type, JSON.stringify(event)).toBe('done')
    const out = outputsOf(event)
    expect(out).toHaveLength(1)
    // Merged outputs are named after the first input: "<first> (merged).pdf" (src/engine/output.ts mergedName).
    expect(out).toEqual([join(lud.workDir, 'p1 (merged).pdf')])
    expect(magic.pdf(out[0]!)).toBe(true)
    expect(await pdfPageCount(out[0]!)).toBe(3)
  })

  test('E2E-29 PDF merge: 1-page + 2-page PDFs → one 3-page PDF', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const a = await makePdf(join(lud.workDir, 'first.pdf'), 1)
    const b = await makePdf(join(lud.workDir, 'second.pdf'), 2)
    const { event } = await convertViaDrop(app, testInfo, 'pdf-merge', [a, b], 'pdf-merge')
    expect(event.type, JSON.stringify(event)).toBe('done')
    const out = outputsOf(event)
    expect(out).toHaveLength(1)
    expect(dirname(out[0]!)).toBe(lud.workDir)
    expect(await pdfPageCount(out[0]!)).toBe(3)
    expect(listNames(lud.workDir)).toContain('first.pdf')
    expect(listNames(lud.workDir)).toContain('second.pdf')
  })

  test('E2E-30 mixed batch (PNG + PDF) → feedMe offers only ZIP → zip written', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const png = await makePng(join(lud.workDir, 'pic.png'))
    const pdf = await makePdf(join(lud.workDir, 'doc.pdf'))
    const armed = await armOverlay(app, testInfo, 'mixed-zip')
    try {
      await hook(app, 'dropFiles', [png, pdf], null)
      await expectUncleState(armed.overlay, 'feedMe')
      const optionIds = await armed.overlay
        .locator('[data-testid^="option-"]')
        .evaluateAll((els) => els.map((e) => (e as unknown as { getAttribute(n: string): string | null }).getAttribute('data-testid')))
      expect(optionIds).toEqual(['option-zip'])
      await armed.overlay.getByTestId('option-zip').click()
      const event = await waitForTerminalEvent(app, armed.eventsBefore)
      expect(event.type, JSON.stringify(event)).toBe('done')
      const out = outputsOf(event)
      expect(out).toHaveLength(1)
      expect(dirname(out[0]!)).toBe(lud.workDir)
      expect(magic.zip(out[0]!)).toBe(true)
    } finally {
      await armed.stopScreens()
    }
  })

  test('E2E-31 audio WAV → MP3 via ffmpeg', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    const ffmpeg = resolveFfmpeg()
    test.skip(ffmpeg === null, 'ffmpeg not available (set LUD_FFMPEG_PATH or put ffmpeg on PATH)')
    const app = await lud.launchReady()
    const input = makeWav(ffmpeg!, join(lud.workDir, 'beep.wav'))
    const { event } = await convertViaDrop(app, testInfo, 'wav-to-mp3', [input], 'to-mp3')
    expect(event.type, JSON.stringify(event)).toBe('done')
    const out = outputsOf(event)
    expect(out).toEqual([expectedOutputPath(input, 'mp3')])
    expect(magic.mp3(out[0]!)).toBe(true)
  })

  test('E2E-32 input deleted after drag start → choke with a friendly error', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const ghost = join(lud.workDir, 'vanished.png')
    expect(existsSync(ghost)).toBe(false)
    const armed = await armOverlay(app, testInfo, 'missing-input')
    try {
      await hook(app, 'dropFiles', [ghost], 'to-jpg')
      // ASSUMPTION: the renderer still shows choke (not refuse) for a vanished file; INPUT_NOT_FOUND if a job ran.
      await expectUncleState(armed.overlay, 'choke')
      expectFriendlyMessage(await armed.overlay.getByTestId('error-message').textContent())
      const events = await newJobEvents(app, armed.eventsBefore)
      const err = events.find((e) => e.type === 'error')
      if (err && err.type === 'error') expect(err.error.code).toBe('INPUT_NOT_FOUND')
    } finally {
      await armed.stopScreens()
    }
    expect(listNames(lud.workDir)).toEqual([])
  })

  test('E2E-33 unwritable folder → choke with OUTPUT_NOT_WRITABLE', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    test.skip(process.platform === 'win32', 'POSIX permissions only')
    test.skip(typeof process.getuid === 'function' && process.getuid() === 0, 'root ignores directory permissions')
    const app = await lud.launchReady()
    const dir = join(lud.workDir, 'locked')
    mkdirSync(dir)
    const input = await makePng(join(dir, 'locked.png'))
    chmodSync(dir, 0o555)
    try {
      const { event, overlay } = await convertViaDrop(app, testInfo, 'unwritable', [input], 'to-jpg')
      expect(event.type, JSON.stringify(event)).toBe('error')
      if (event.type === 'error') {
        expect(event.error.code).toBe('OUTPUT_NOT_WRITABLE')
        expectFriendlyMessage(event.error.message)
      }
      await expectUncleState(overlay, 'choke')
    } finally {
      chmodSync(dir, 0o755)
    }
    expect(listNames(dir)).toEqual([basename(input)])
  })

  test('E2E-34 zero-byte file with an image extension → choke, no crash', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = join(lud.workDir, 'empty.png')
    writeFileSync(input, Buffer.alloc(0))
    const { event, overlay } = await convertViaDrop(app, testInfo, 'empty-file', [input], 'to-jpg')
    expect(event.type, JSON.stringify(event)).toBe('error')
    await expectUncleState(overlay, 'choke')
    // App still alive and usable afterwards.
    await expectOverlayHidesItself(app)
    const ok = await makePng(join(lud.workDir, 'ok.png'))
    const again = await convertViaDrop(app, testInfo, 'after-empty', [ok], 'to-webp')
    expect(again.event.type).toBe('done')
  })
})
