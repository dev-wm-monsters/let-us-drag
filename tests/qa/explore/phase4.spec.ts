// QA phase 4 regression: independent repros for every phase-4 fix (B-046..B-060), driven through the
// real app (Playwright _electron + __ludTest hooks) and checked with tools outside the app's code path.
// Results go to test-results/qa-explore/results.jsonl like the rest of the exploratory suite.
//
//   npm run build
//   LUD_FFMPEG_PATH=/usr/bin/ffmpeg QA_MODEL_PATH=<isnet-general-use.onnx> QA_PHOTOS=<a.jpg,b.jpg> \
//   [QA_DOWNLOAD=1] xvfb-run -a -s "-screen 0 1920x1080x24" npx playwright test -c tests/qa/playwright.qa.config.ts phase4
//
// QA_DOWNLOAD=1 runs the real first-use model download (179 MB from upstream) with a fresh userData.
import type { ElectronApplication, Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { marked } from 'marked'
import sharp from 'sharp'
import type { JobEvent, OptionId } from '../../../src/shared/types'
import { T, expect, expectUncleState, hook, newJobEvents, test, waitForPage, waitForTerminalEvent, windowInfo } from '../../e2e/support/app'
import { REPO_ROOT } from '../../e2e/support/paths'
import { armOverlay, expectOverlayHidesItself } from '../../e2e/support/flows'
import { makePng } from '../../e2e/support/fixtures'
import { hookP2 } from '../../e2e/support/p2'
import { SAMPLE_CSV, audioFile, docxFile, pdfFile, textFile, videoFile, zipFile } from '../../helpers/fixtures'
import { RESULTS_DIR, convert, makeVideo, record, short } from './support'
import { alphaStats } from './validate'

// Independent tests (no serial mode): one failure must not hide the other repros.

const XTEST = join(REPO_ROOT, 'tests', 'qa', 'probes', 'xtest.py')
const SHOTS = join(RESULTS_DIR, 'phase4')

function describeEv(ev: JobEvent | undefined): string {
  if (!ev) return 'no terminal event'
  if (ev.type === 'done') return `done → ${ev.outputPaths.map((p) => basename(p)).join(', ')}`
  if (ev.type === 'error') return `error ${ev.error.code}: "${ev.error.message}"`
  return ev.type
}

function captureLog(app: ElectronApplication): string[] {
  const log: string[] = []
  app.process().stdout?.on('data', (d: Buffer) => log.push(d.toString()))
  app.process().stderr?.on('data', (d: Buffer) => log.push(d.toString()))
  return log
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: join(SHOTS, `${name}.png`) }).catch(() => undefined)
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}
const inside = (b: Box, w: number, h: number): boolean => b.x >= 0 && b.y >= 0 && b.x + b.width <= w + 0.5 && b.y + b.height <= h + 0.5
const overlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
/** How far (px) the round bubble inscribed in `circle` reaches into the rectangle `r` (> 0 = they overlap). */
const circleIntrusion = (r: Box, circle: Box): number => {
  const cx = circle.x + circle.width / 2
  const cy = circle.y + circle.height / 2
  const nx = Math.max(r.x, Math.min(cx, r.x + r.width))
  const ny = Math.max(r.y, Math.min(cy, r.y + r.height))
  return circle.width / 2 - Math.hypot(cx - nx, cy - ny)
}

async function photosIn(dir: string): Promise<string[]> {
  const photos = (process.env['QA_PHOTOS'] ?? '').split(',').filter(Boolean)
  return photos.map((src) => {
    const p = join(dir, basename(src))
    writeFileSync(p, readFileSync(src))
    return p
  })
}

// ---------------------------------------------------------------------------------------------
// B-046 (D24): Remove BG many times in one app session, single and batch, mixed with other jobs.
// ---------------------------------------------------------------------------------------------
test('P4 B-046 Remove BG 5x in one session + a batch of 3 photos', async ({ lud }, testInfo) => {
  test.setTimeout(20 * 60_000)
  const model = process.env['QA_MODEL_PATH']
  test.skip(!model || (process.env['QA_PHOTOS'] ?? '') === '', 'set QA_MODEL_PATH and QA_PHOTOS')
  const app = await lud.launchReady({ env: { LUD_MODEL_PATH: model! } })
  const log = captureLog(app)
  const [a, b] = await photosIn(lud.workDir)
  const d = (n: string): string => join(lud.workDir, n)
  const c = d('third.png')
  await sharp(readFileSync(a!)).rotate(90).png().toFile(c)
  const sequence: [string, string[], OptionId][] = [
    ['RMBG-1', [a!], 'remove-bg'],
    ['RMBG-2', [b!], 'remove-bg'],
    ['RMBG-3 (same photo again)', [a!], 'remove-bg'],
    ['other job in between (to-webp)', [b!], 'to-webp'],
    ['RMBG-4', [c], 'remove-bg'],
    ['RMBG-5', [b!], 'remove-bg'],
    ['RMBG batch of 3', [a!, b!, c], 'remove-bg'],
    ['RMBG-after-batch', [a!], 'remove-bg']
  ]
  const lines: string[] = []
  let ok = true
  for (const [label, inputs, option] of sequence) {
    const r = await convert(app, testInfo, `p4-${label}`, inputs, option)
    let detail = describeEv(r.event)
    if (r.event.type === 'done' && option === 'remove-bg') {
      const stats = await Promise.all(r.event.outputPaths.map((o) => alphaStats(o)))
      const good = stats.length === inputs.length && stats.every((s) => s.hasAlpha && s.transparent > 0.05 && s.transparent < 0.97)
      if (!good) ok = false
      detail += ` [${stats.map((s) => `${Math.round(s.transparent * 100)}%`).join(', ')} transparent]`
    }
    if (r.event.type !== 'done') ok = false
    lines.push(`${label}: ${detail} (${r.ms} ms)`)
  }
  const died = /engine exited/.test(log.join(''))
  record({
    id: 'P4-RMBG-REPEAT',
    what: 'B-046: Remove BG ×5 + other job + batch of 3 + once more, one app session (real ISNet model)',
    result: ok && !died ? 'PASS' : 'FAIL',
    evidence: `${lines.join('; ')}; engine exited in log: ${died}`
  })
  expect(ok && !died, lines.join('\n')).toBe(true)
})

// ---------------------------------------------------------------------------------------------
// B-047 (D15): the one-time download stage text is visible (fresh userData, real download).
// ---------------------------------------------------------------------------------------------
test('P4 B-047 model download stage text visible during the real first-use download', async ({ lud }, testInfo) => {
  test.setTimeout(30 * 60_000)
  test.skip(process.env['QA_DOWNLOAD'] !== '1' || (process.env['QA_PHOTOS'] ?? '') === '', 'set QA_DOWNLOAD=1 and QA_PHOTOS (downloads 179 MB)')
  const app = await lud.launchReady({ env: { LUD_MODEL_PATH: '' } })
  const [photo] = await photosIn(lud.workDir)
  const armed = await armOverlay(app, testInfo, 'p4-dl')
  const size = await armed.overlay.evaluate(() => { const g = globalThis as unknown as { innerWidth: number; innerHeight: number }; return { w: g.innerWidth, h: g.innerHeight } })
  await hook(app, 'dropFiles', [photo!], 'remove-bg')
  const samples: { t: number; text: string; box: Box | null }[] = []
  const t0 = Date.now()
  let ev: JobEvent | undefined
  let shotTaken = false
  while (!ev && Date.now() - t0 < 25 * 60_000) {
    const loc = armed.overlay.getByTestId('stage-text')
    const text = (await loc.textContent({ timeout: 200 }).catch(() => null)) ?? ''
    const box = text ? await loc.boundingBox().catch(() => null) : null
    if (text && (samples.length === 0 || samples[samples.length - 1]!.text !== text)) samples.push({ t: Date.now() - t0, text, box })
    if (!shotTaken && /One-time download/.test(text) && /[1-9]\d?%/.test(text)) {
      await shot(armed.overlay, 'B-047-download-stage')
      shotTaken = true
    }
    ev = (await newJobEvents(app, armed.eventsBefore)).find((e) => e.type === 'done' || e.type === 'error')
    await new Promise((r) => setTimeout(r, 150))
  }
  await armed.stopScreens()
  await expectOverlayHidesItself(app).catch(() => undefined)
  const dl = samples.filter((s) => /One-time download of my scissors \(179 MB AI model\)/.test(s.text))
  const pcts = dl.map((s) => Number(/(\d+)%/.exec(s.text)?.[1] ?? -1)).filter((n) => n >= 0)
  const allInside = samples.every((s) => s.box !== null && inside(s.box, size.w, size.h))
  const stages = [...new Set(samples.map((s) => s.text.replace(/\d+%/, 'N%')))]
  const pass = ev?.type === 'done' && dl.length > 0 && pcts.length > 1 && allInside
  record({
    id: 'P4-DL-STAGE',
    what: 'B-047: fresh userData, no LUD_MODEL_PATH → the download stage text is on screen with a rising percentage',
    result: pass ? 'PASS' : 'FAIL',
    evidence: `${describeEv(ev)} after ${Math.round((Date.now() - t0) / 1000)} s; distinct captions ${JSON.stringify(stages)}; download % seen ${pcts.length} values from ${Math.min(...pcts)} to ${Math.max(...pcts)}; first caption at ${samples[0]?.t ?? '?'} ms; all inside the ${size.w}x${size.h} window: ${allInside}`
  })
  expect(pass).toBe(true)
})

// ---------------------------------------------------------------------------------------------
// B-048: option hints stay inside the window and do not cover another bubble (every category).
// ---------------------------------------------------------------------------------------------
test('P4 B-048 hover hints inside the overlay for every category (real app)', async ({ lud }, testInfo) => {
  test.setTimeout(15 * 60_000)
  const app = await lud.launchReady()
  const d = (n: string): string => join(lud.workDir, n)
  mkdirSync(d('folder'), { recursive: true })
  writeFileSync(d('folder/x.txt'), 'x')
  const inputs: Record<string, string[]> = {
    image: [await makePng(d('photo.png'))],
    video: [await videoFile(d('clip.mp4'), { seconds: 1 })],
    audio: [await audioFile(d('voice.wav'), 1)],
    pdf: [await pdfFile(d('doc.pdf'), 1)],
    docx: [await docxFile(d('report.docx'))],
    text: [await textFile(d('notes.md'), '# hi\n')],
    data: [await textFile(d('people.csv'), SAMPLE_CSV)],
    archive: [await zipFile(d('pack.zip'), { 'a.txt': 'a' })],
    folder: [d('folder')],
    multi: [await makePng(d('one.png')), await makePng(d('two.png'))]
  }
  const problems: string[] = []
  const seen: string[] = []
  const blocked: string[] = []
  for (const [cat, paths] of Object.entries(inputs)) {
    const armed = await armOverlay(app, testInfo, `p4-hints-${cat}`)
    await hook(app, 'dropFiles', paths, null)
    await expectUncleState(armed.overlay, 'feedMe')
    await new Promise((r) => setTimeout(r, 1_200)) // bubbles' entry animation
    const page = armed.overlay
    const size = await page.evaluate(() => { const g = globalThis as unknown as { innerWidth: number; innerHeight: number }; return { w: g.innerWidth, h: g.innerHeight } })
    const ids = await page.$$eval('[data-testid^="option-"]', (els) => els.map((e) => e.getAttribute('data-testid')!.slice(7)))
    for (const id of ids) {
      // Is the bubble's centre reachable by the mouse while files are held (nothing on top of it)?
      const blocker = await page.getByTestId(`option-${id}`).evaluate((b) => {
        const r = b.getBoundingClientRect()
        const doc = (globalThis as unknown as { document: { elementFromPoint(x: number, y: number): { getAttribute(n: string): string | null } | null } }).document
        const e = doc.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) as unknown
        return b.contains(e as typeof b) ? null : ((e as { getAttribute(n: string): string | null } | null)?.getAttribute('data-testid') ?? 'other element')
      })
      if (blocker) blocked.push(`${cat}/${id} (by ${blocker})`)
      // A covered bubble cannot be hovered at its centre: show its hint through keyboard focus instead.
      if (blocker) await page.getByTestId(`option-${id}`).focus()
      else await page.getByTestId(`option-${id}`).hover()
      const hint = page.getByTestId('hover-hint')
      await expect(hint).toBeVisible({ timeout: 3_000 })
      await expect.poll(async () => hint.evaluate((e) => (globalThis as unknown as { getComputedStyle(x: unknown): { visibility: string } }).getComputedStyle(e).visibility)).toBe('visible')
      await new Promise((r) => setTimeout(r, 250)) // entry animation
      const box = (await hint.boundingBox())!
      const text = (await hint.textContent()) ?? ''
      const bubbles = await page.$$eval('[data-testid^="option-"] .lud-option-bubble', (els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect()
          return { id: e.parentElement!.getAttribute('data-testid')!.slice(7), x: r.x, y: r.y, width: r.width, height: r.height }
        })
      )
      // Another (round) bubble reaching more than 3 px into the hint pill = the hint covers it.
      const covered = bubbles.filter((b) => b.id !== id && overlap(box, b) > 0 && circleIntrusion(box, b) > 3)
      // the text is fully shown: no overflow inside the pill
      const clipped = await hint.evaluate((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)
      if (!inside(box, size.w, size.h)) problems.push(`${cat}/${id}: hint ${JSON.stringify(box)} leaves the ${size.w}x${size.h} window`)
      if (covered.length > 0) problems.push(`${cat}/${id}: hint covers ${covered.map((b) => b.id).join(',')}`)
      if (clipped) problems.push(`${cat}/${id}: hint text overflows its pill`)
      if (id === 'remove-bg') {
        await shot(page, 'B-048-hint-remove-bg')
        seen.push(`remove-bg hint "${text}" at x=${Math.round(box.x)}..${Math.round(box.x + box.width)}`)
      }
    }
    seen.push(`${cat}: ${ids.length} hints`)
    await page.mouse.move(size.w / 2, size.h / 2)
    await page.keyboard.press('Escape')
    await armed.stopScreens()
    await expectOverlayHidesItself(app)
  }
  record({
    id: 'P4-HINTS',
    what: 'B-048: every option hint of every category (incl. Remove BG, folder, multi-file) inside the window, no bubble covered, text not clipped',
    result: problems.length === 0 ? 'PASS' : 'FAIL',
    evidence: problems.length ? short(problems.join('; '), 600) : seen.join('; ')
  })
  // Found in phase 4 (not a phase-4 change): the "held files" card covers the bottom bubbles.
  record({
    id: 'P4-HELD-COVER',
    what: 'feedMe with held files (drop on the mouth): every option bubble centre is reachable by the mouse',
    result: blocked.length === 0 ? 'PASS' : 'FAIL',
    evidence: blocked.length ? `covered: ${blocked.join('; ')}` : 'all bubbles reachable'
  })
  expect(problems, problems.join('\n')).toEqual([])
})

// ---------------------------------------------------------------------------------------------
// B-049: long error cards fit (real 140-char engine message; 200-char message injected).
// ---------------------------------------------------------------------------------------------
async function cardFits(page: Page): Promise<{ fits: boolean; box: Box | null; size: { w: number; h: number }; clipped: boolean; text: string }> {
  const size = await page.evaluate(() => { const g = globalThis as unknown as { innerWidth: number; innerHeight: number }; return { w: g.innerWidth, h: g.innerHeight } })
  const card = page.getByTestId('error-message')
  await expect(card).toBeVisible({ timeout: T.state })
  await new Promise((r) => setTimeout(r, 600)) // entry animation
  const box = await card.boundingBox()
  const clipped = await card.evaluate((e) => {
    const m = e.querySelector('.lud-card-message') ?? e
    return m.scrollHeight > m.clientHeight + 1 || m.scrollWidth > m.clientWidth + 1
  })
  const text = (await card.textContent()) ?? ''
  return { fits: box !== null && inside(box, size.w, size.h) && !clipped, box, size, clipped, text }
}

test('P4 B-049 140-char and 200-char error cards fit inside the overlay', async ({ lud }, testInfo) => {
  test.setTimeout(10 * 60_000)
  const app = await lud.launchReady()
  const d = (n: string): string => join(lud.workDir, n)
  // Real engine message: batch of two JSON files → CSV, the second is not a list of records.
  // "<name>: To make a table I need ... This file has a different shape." with a 22-char name = 140 chars.
  const good = await textFile(d('good.json'), '[{"a":1}]')
  const bad = await textFile(d('people-export-v2a.json'), '42')
  const armed = await armOverlay(app, testInfo, 'p4-err-140')
  await hook(app, 'dropFiles', [good, bad], 'to-csv')
  const ev = await waitForTerminalEvent(app, armed.eventsBefore)
  await expectUncleState(armed.overlay, 'choke')
  const r140 = await cardFits(armed.overlay)
  await shot(armed.overlay, 'B-049-error-140')
  await armed.stopScreens()
  await expectOverlayHidesItself(app)
  const len140 = ev.type === 'error' ? ev.error.message.length : -1

  // 200 chars (the engine's cap): injected as the running job's error event, so only the renderer is under test.
  const long = makeVideo(d('long.mp4'), 20)
  const msg200 = `quarterly-results-final-v7 (approved by finance) copy.json: To make a table I need a list of records, like [{"name": "Ann", "age": 31}, ...]. This file has a different shape, so nothing was saved here.`.slice(0, 200)
  const armed2 = await armOverlay(app, testInfo, 'p4-err-200')
  await hook(app, 'dropFiles', [long], 'to-webm')
  await expectUncleState(armed2.overlay, 'chew', T.job)
  let jobId = ''
  await expect.poll(async () => {
    const p = (await newJobEvents(app, armed2.eventsBefore)).find((e) => 'jobId' in e)
    jobId = p && 'jobId' in p ? String(p.jobId) : ''
    return jobId
  }, { timeout: T.job }).not.toBe('')
  await app.evaluate(({ BrowserWindow }, a: { jobId: string; message: string }) => {
    const w = BrowserWindow.getAllWindows().find((x) => /\/overlay\/index\.html/.test(x.webContents.getURL()))
    w?.webContents.send('lud:job-event', { type: 'error', jobId: a.jobId, error: { code: 'INPUT_INVALID', message: a.message } })
  }, { jobId, message: msg200 })
  await expectUncleState(armed2.overlay, 'choke')
  const r200 = await cardFits(armed2.overlay)
  await shot(armed2.overlay, 'B-049-error-200')
  await hookP2(app, 'cancelActive').catch(() => undefined)
  await armed2.stopScreens()
  await waitForTerminalEvent(app, armed2.eventsBefore).catch(() => undefined)
  await expectOverlayHidesItself(app).catch(() => undefined)
  const shows200 = r200.text.includes(msg200.slice(-30))
  record({
    id: 'P4-ERR-CARDS',
    what: 'B-049: error card with a real 140-char engine message and an injected 200-char message stays inside the window, text not clipped',
    result: r140.fits && r200.fits && len140 >= 130 && shows200 ? 'PASS' : 'FAIL',
    evidence: `real message ${len140} chars (${describeEv(ev)}): card ${JSON.stringify(r140.box)} in ${r140.size.w}x${r140.size.h}, clipped ${r140.clipped}; 200-char: card ${JSON.stringify(r200.box)}, clipped ${r200.clipped}, full text shown ${shows200}`
  })
  expect(r140.fits && r200.fits).toBe(true)
})

// ---------------------------------------------------------------------------------------------
// B-051/B-052 (D20): click-through + no focus. Linux ignores click-through by design; here we check
// (1) the renderer asks for it at the right times, (2) on Linux the overlay stays clickable and the
// cancel button works with a REAL X11 click while another window has focus, (3) the overlay never
// takes focus outside feedMe, and (4) an emulation of macOS/Windows: the test applies the renderer's
// requests to the real window (setIgnoreMouseEvents) and clicks next to the Uncle (must reach the
// window behind) and then on the cancel button (must cancel).
// ---------------------------------------------------------------------------------------------
function xtest(...args: string[]): string {
  const r = spawnSync('python3', ['-I', XTEST, ...args], { encoding: 'utf8', timeout: 10_000 })
  if (r.status !== 0) throw new Error(`xtest ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

async function installClickThroughSpy(app: ElectronApplication, emulate: boolean): Promise<void> {
  await app.evaluate(({ BrowserWindow, ipcMain }, emu: boolean) => {
    const g = globalThis as unknown as { __qaCT?: { req: { t: number; v: boolean; state: string }[]; native: { t: number; args: unknown[] }[]; focus: { t: number; who: string }[] } }
    g.__qaCT = { req: [], native: [], focus: [] }
    const ct = g.__qaCT
    const win = BrowserWindow.getAllWindows().find((x) => /\/overlay\/index\.html/.test(x.webContents.getURL()))!
    const origNative = win.setIgnoreMouseEvents.bind(win)
    win.setIgnoreMouseEvents = (...args: Parameters<typeof win.setIgnoreMouseEvents>) => {
      ct.native.push({ t: Date.now(), args })
      return origNative(...args)
    }
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers
    const ch = 'lud:overlay-click-through'
    const orig = handlers.get(ch)!
    handlers.set(ch, async (e: unknown, ...a: unknown[]) => {
      ct.req.push({ t: Date.now(), v: a[0] === true, state: '' })
      const res = await orig(e, ...a)
      // macOS/Windows emulation: what OverlayController.setClickThrough does there (minus `forward`,
      // which X11 lacks; the renderer's cursor polling covers that).
      if (emu && win.isVisible()) origNative(a[0] === true)
      return res
    })
    win.on('focus', () => ct.focus.push({ t: Date.now(), who: 'overlay' }))
  }, emulate)
}

async function spyData(app: ElectronApplication): Promise<{ req: { v: boolean }[]; native: { args: unknown[] }[]; focus: unknown[] }> {
  return app.evaluate(() => (globalThis as unknown as { __qaCT: { req: { v: boolean }[]; native: { args: unknown[] }[]; focus: unknown[] } }).__qaCT)
}

/** A big "desktop app" window behind the overlay that counts real clicks (the Settings window). */
async function backgroundWindow(app: ElectronApplication): Promise<Page> {
  await hook(app, 'openSettingsWindow')
  const page = await waitForPage(app, 'settings')
  await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => /\/settings\/index\.html/.test(x.webContents.getURL()))!
    w.setBounds(screen.getPrimaryDisplay().workArea)
    w.focus()
  })
  await page.evaluate(() => {
    const g = globalThis as unknown as { __clicks: { x: number; y: number }[] }
    g.__clicks = []
    const doc = (globalThis as unknown as { document: { addEventListener(t: string, f: (e: { screenX: number; screenY: number }) => void, c: boolean): void } }).document
    doc.addEventListener('mousedown', (e) => g.__clicks.push({ x: e.screenX, y: e.screenY }), true)
  })
  return page
}

async function focusedKind(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ BrowserWindow }) => {
    const f = BrowserWindow.getFocusedWindow()
    if (!f) return 'none'
    const u = f.webContents.getURL()
    return /overlay/.test(u) ? 'overlay' : /settings/.test(u) ? 'settings' : /feed/.test(u) ? 'feed' : u
  })
}

for (const emulate of [false, true]) {
  test(`P4 B-051/B-052 click-through + focus, ${emulate ? 'macOS/Windows emulation' : 'Linux as shipped'} (real X11 clicks)`, async ({ lud }, testInfo) => {
    test.setTimeout(10 * 60_000)
    const app = await lud.launchReady()
    const d = (n: string): string => join(lud.workDir, n)
    const long = makeVideo(d('long.mp4'), 30)
    const bg = await backgroundWindow(app)
    await installClickThroughSpy(app, emulate)
    const focusLog: string[] = []
    const watchFocus = setInterval(() => {
      void focusedKind(app).then((k) => focusLog.push(k), () => undefined)
    }, 100)

    const armed = await armOverlay(app, testInfo, `p4-ct-${emulate ? 'emu' : 'linux'}`)
    await hook(app, 'dropFiles', [long], 'to-webm')
    await expectUncleState(armed.overlay, 'chew', T.job)
    // Test environment only: Xvfb has no window manager, so "always on top" is not enforced and the
    // overlay (created at boot, before the background window) would stay BELOW it. Raise it like a WM would.
    const xid = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => /\/overlay\/index\.html/.test(x.webContents.getURL()))!
      const h = w.getNativeWindowHandle()
      return h.length >= 8 ? Number(h.readBigUInt64LE(0)) : h.readUInt32LE(0)
    })
    xtest('raise', String(xid))
    await new Promise((r) => setTimeout(r, 500))
    const ov = (await windowInfo(app, 'overlay')).bounds!
    const cancel = (await armed.overlay.getByTestId('cancel-job').boundingBox())!
    const cancelPt = { x: Math.round(ov.x + cancel.x + cancel.width / 2), y: Math.round(ov.y + cancel.y + cancel.height / 2) }
    // A spot inside the overlay window but away from the Uncle, the ring and the button (bottom-left corner).
    const emptyPt = { x: ov.x + 12, y: ov.y + ov.height - 12 }

    // 1) click next to the Uncle while chewing.
    xtest('move', String(emptyPt.x), String(emptyPt.y))
    await new Promise((r) => setTimeout(r, 400))
    xtest('click', String(emptyPt.x), String(emptyPt.y))
    await new Promise((r) => setTimeout(r, 400))
    const clicksBehind = await bg.evaluate(() => (globalThis as unknown as { __clicks: unknown[] }).__clicks.length)
    const stateAfterEmptyClick = await armed.overlay.getByTestId('overlay-root').getAttribute('data-uncle-state')

    // 2) move onto the cancel button (renderer must turn click-through off), then a real click.
    xtest('move', String(cancelPt.x), String(cancelPt.y))
    await new Promise((r) => setTimeout(r, 400))
    const reqBeforeCancel = (await spyData(app)).req.map((r) => r.v)
    xtest('click', String(cancelPt.x), String(cancelPt.y))
    let ev: JobEvent | undefined
    try {
      ev = await waitForTerminalEvent(app, armed.eventsBefore)
    } catch {
      ev = undefined
    }
    await armed.stopScreens()
    await expectOverlayHidesItself(app).catch(() => undefined)
    xtest('move', '5', '5')

    // 3) a normal conversion: spit card, focus must stay on the "desktop app" the whole time.
    focusLog.length = 0
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => /\/settings\/index\.html/.test(x.webContents.getURL()))?.focus())
    const p = await makePng(d('shot.png'))
    const r = await convert(app, testInfo, `p4-ct-focus-${emulate ? 'emu' : 'linux'}`, [p], 'to-jpg')
    clearInterval(watchFocus)
    const spy = await spyData(app)
    const overlayFocused = focusLog.filter((k) => k === 'overlay').length
    const reqs = spy.req.map((x) => (x.v ? 'T' : 'F')).join('')
    const nativeOnLinux = spy.native.filter((n) => n.args[0] === true).length
    const cancelled = ev?.type === 'error' && ev.error.code === 'CANCELLED'
    const pass = emulate
      ? clicksBehind === 1 && cancelled && reqs.includes('T') && reqBeforeCancel[reqBeforeCancel.length - 1] === false && overlayFocused === 0 && r.event.type === 'done'
      : clicksBehind === 0 && cancelled && reqs.includes('T') && nativeOnLinux === 0 && overlayFocused === 0 && r.event.type === 'done'
    record({
      id: emulate ? 'P4-CLICKTHROUGH-EMU' : 'P4-CLICKTHROUGH-LINUX',
      what: emulate
        ? 'B-051 emulated macOS/Windows: renderer requests applied to the real window; real X11 click next to the chewing Uncle reaches the window behind; real click on "Spit it out" cancels; overlay never focused'
        : 'B-051/B-052 Linux as shipped: renderer requests click-through after the drop (main ignores it on Linux), cancel button works with a real X11 click while another window has focus; overlay never focused',
      result: pass ? 'PASS' : 'FAIL',
      evidence: `click next to Uncle → window behind got ${clicksBehind} click(s), Uncle state after it ${stateAfterEmptyClick}; renderer requests ${reqs} (last before the cancel click: ${String(reqBeforeCancel[reqBeforeCancel.length - 1])}); native setIgnoreMouseEvents(true) by main: ${nativeOnLinux}; real click on cancel → ${describeEv(ev)}; later conversion ${describeEv(r.event)}; focus samples: overlay ${overlayFocused}/${focusLog.length} (others: ${[...new Set(focusLog)].join(',')})`
    })
    expect(pass).toBe(true)
  })
}

// ---------------------------------------------------------------------------------------------
// B-053 (D23): over-long output names are shortened (ASCII, 2-byte and 4-byte UTF-8, collisions).
// ---------------------------------------------------------------------------------------------
test('P4 B-053 output names over 255 bytes are shortened, never fail', async ({ lud }, testInfo) => {
  test.setTimeout(10 * 60_000)
  const app = await lud.launchReady()
  const d = (n: string): string => join(lud.workDir, n)
  const cases: [string, string, OptionId][] = [
    ['246 x "L" → Compress (+"-compressed")', `${'L'.repeat(246)}.png`, 'compress'],
    ['250 x "W" → WEBP (fits) then again (" (1)")', `${'W'.repeat(250)}.png`, 'to-webp'],
    ['250 x "W" → WEBP second time', `${'W'.repeat(250)}.png`, 'to-webp'],
    ['125 x "é" (250 bytes) → Compress', `${'é'.repeat(125)}.png`, 'compress'],
    ['61 x "😀" (244 bytes) → Compress', `${'😀'.repeat(61)}.png`, 'compress'],
    ['246 x "M" → JPG (same length, 250 chars)', `${'M'.repeat(246)}.png`, 'to-jpg'],
    ['246 x "P" PDF → PNG pages folder', `${'P'.repeat(246)}.pdf`, 'pdf-to-png']
  ]
  const lines: string[] = []
  let ok = true
  for (const [what, name, option] of cases) {
    const input = d(name)
    if (!existsSync(input)) {
      if (name.endsWith('.pdf')) await pdfFile(input, 1)
      else await makePng(input)
    }
    const r = await convert(app, testInfo, `p4-name-${option}`, [input], option)
    if (r.event.type !== 'done') {
      ok = false
      lines.push(`${what}: ${describeEv(r.event)}`)
      continue
    }
    for (const out of r.event.outputPaths) {
      const nm = basename(out)
      const bytes = Buffer.byteLength(nm, 'utf8')
      const valid = Buffer.from(nm, 'utf8').toString('utf8') === nm && !nm.includes('�') && !/[\uD800-\uDFFF]/.test(nm.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''))
      const exists = existsSync(out)
      if (bytes > 255 || !valid || !exists) ok = false
      const cps = Array.from(nm)
      lines.push(`${what}: ${bytes} B "${cps.length > 40 ? `${cps.slice(0, 6).join("")}…${cps.slice(-22).join("")}` : nm}" exists ${exists} valid-utf8 ${valid}`)
    }
  }
  record({ id: 'P4-LONG-NAMES', what: 'B-053: 246-250-char / multibyte names with suffixes and collisions', result: ok ? 'PASS' : 'FAIL', evidence: lines.join('; ') })
  expect(ok, lines.join('\n')).toBe(true)
})

// ---------------------------------------------------------------------------------------------
// B-054: DOCX → Markdown keeps the space between bold and italic runs (and other run mixes).
// ---------------------------------------------------------------------------------------------
test('P4 B-054 DOCX → Markdown bold+italic spacing', async ({ lud }, testInfo) => {
  test.setTimeout(5 * 60_000)
  const app = await lud.launchReady()
  const d = (n: string): string => join(lud.workDir, n)
  const docx = await import('docx')
  const run = (text: string, o: { bold?: boolean; italics?: boolean } = {}) => new docx.TextRun({ text, ...o })
  const paragraphs: [string, InstanceType<typeof docx.TextRun>[]][] = [
    ['Revenue was great this time.', [run('Revenue was '), run('great', { bold: true }), run(' this time.', { italics: true })]],
    ['Revenue was great this time.', [run('Revenue was '), run('great ', { bold: true }), run('this time.', { italics: true })]],
    ['A both and plain end.', [run('A '), run('both', { bold: true, italics: true }), run(' and plain end.')]],
    ['Mixed boldItalic word.', [run('Mixed '), run('bold', { bold: true }), run('Italic', { italics: true }), run(' word.')]],
    ['Stars * and _under_ score.', [run('Stars * and _under_ '), run('score', { bold: true }), run('.')]]
  ]
  const file = d('emphasis.docx')
  writeFileSync(file, await docx.Packer.toBuffer(new docx.Document({ sections: [{ children: paragraphs.map(([, runs]) => new docx.Paragraph({ children: runs })) }] })))
  const r = await convert(app, testInfo, 'p4-md', [file], 'to-md')
  const md = r.event.type === 'done' ? readFileSync(r.event.outputPaths[0]!, 'utf8') : ''
  // Render with marked (CommonMark/GFM) and compare the VISIBLE text of each paragraph.
  const html = marked.parse(md, { async: false })
  const visible = html
    .split(/<\/p>/)
    .map((p) => p.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim())
    .filter(Boolean)
  const want = paragraphs.map(([t]) => t)
  const okText = JSON.stringify(visible) === JSON.stringify(want)
  const firstOk = md.includes('**great** *this time.*')
  record({
    id: 'P4-MD-EMPHASIS',
    what: 'B-054: DOCX with bold/italic/bold+italic runs → Markdown renders back to the same words and spaces',
    result: okText && firstOk ? 'PASS' : 'FAIL',
    evidence: `md ${JSON.stringify(md.trim())}; rendered ${JSON.stringify(visible)}`
  })
  expect(visible).toEqual(want)
})

// ---------------------------------------------------------------------------------------------
// B-055: dropFilesOnFeed without opening the Feed Window first.
// ---------------------------------------------------------------------------------------------
test('P4 B-055 dropFilesOnFeed opens the Feed Window itself', async ({ lud }) => {
  test.setTimeout(3 * 60_000)
  const results: string[] = []
  let ok = true
  for (const [label, option] of [['option to-webp right after launch', 'to-webp'], ['null (held) right after launch', null]] as const) {
    const app = await lud.launchReady()
    const png = await makePng(join(lud.workDir, `feed-${option ?? 'held'}.png`))
    const t0 = Date.now()
    const before = (await hook(app, 'jobEvents')).length
    const resolved = await Promise.race([
      hook(app, 'dropFilesOnFeed', [png], option).then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 20_000))
    ])
    const ms = Date.now() - t0
    let detail = `${label}: resolved ${resolved} in ${ms} ms`
    if (option) {
      const ev = await waitForTerminalEvent(app, before).catch(() => undefined)
      detail += `, ${describeEv(ev)}`
      if (ev?.type !== 'done') ok = false
    } else {
      const feed = await waitForPage(app, 'feed')
      const held = await feed.getByTestId('held-files').isVisible({ timeout: 5_000 }).catch(() => false)
      const state = await feed.getByTestId('feed-root').getAttribute('data-uncle-state')
      detail += `, feed state ${state}, held-files visible ${held}`
      if (!held) ok = false
    }
    if (!resolved) ok = false
    results.push(detail)
    await lud.close(app)
  }
  record({ id: 'P4-FEED-FIRST', what: 'B-055: dropFilesOnFeed right after launch (Feed Window not open)', result: ok ? 'PASS' : 'FAIL', evidence: results.join('; ') })
  expect(ok, results.join('\n')).toBe(true)
})

// ---------------------------------------------------------------------------------------------
// B-056 (D21): a new arm while a result card is shown starts the new gesture.
// ---------------------------------------------------------------------------------------------
test('P4 B-056 new gesture over a spit card / choke card / leave animation', async ({ lud }, testInfo) => {
  test.setTimeout(10 * 60_000)
  const app = await lud.launchReady()
  const d = (n: string): string => join(lud.workDir, n)
  const lines: string[] = []
  let ok = true
  const variants: [string, () => Promise<string>, 'spit' | 'choke' | 'leave'][] = [
    ['spit card', async () => makePng(d('first.png')), 'spit'],
    ['choke card', async () => textFile(d('broken.json'), '{not json'), 'choke'],
    ['leave animation', async () => makePng(d('first-b.png')), 'leave']
  ]
  for (const [label, make, at] of variants) {
    const input = await make()
    const option: OptionId = input.endsWith('.json') ? 'to-csv' : 'to-jpg'
    const armed = await armOverlay(app, testInfo, `p4-rearm-${at}`)
    await hook(app, 'dropFiles', [input], option)
    const ev1 = await waitForTerminalEvent(app, armed.eventsBefore)
    await expectUncleState(armed.overlay, at === 'leave' ? 'leave' : at, at === 'leave' ? 8_000 : T.state)
    await armed.stopScreens()
    const next = await makePng(d(`next-${at}.png`))
    const before2 = (await hook(app, 'jobEvents')).length
    const t0 = Date.now()
    await hook(app, 'arm')
    const visibleAfterArm = await hook(app, 'overlayVisible')
    const stateAfterArm = await armed.overlay.getByTestId('overlay-root').getAttribute('data-uncle-state')
    const cardGone = !(await armed.overlay.getByTestId('output-card').isVisible().catch(() => false)) && !(await armed.overlay.getByTestId('error-message').isVisible().catch(() => false))
    await hook(app, 'dropFiles', [next], 'to-webp')
    const ev2 = await waitForTerminalEvent(app, before2).catch(() => undefined)
    await expectOverlayHidesItself(app).catch(() => undefined)
    const good = ev2?.type === 'done' && cardGone
    if (!good) ok = false
    lines.push(`${label}: first ${describeEv(ev1)}; arm → overlay visible ${visibleAfterArm}, state ${stateAfterArm}, card gone ${cardGone}; second ${describeEv(ev2)} after ${Date.now() - t0} ms`)
    await new Promise((r) => setTimeout(r, 500))
  }
  // Stale overlayDone race (ba36ffa): arm right as the previous leave ends, repeat a few times.
  let raceOk = 0
  for (let i = 0; i < 5; i++) {
    const a = await makePng(d(`race-${i}.png`))
    const armed = await armOverlay(app, testInfo, `p4-race-${i}`)
    await hook(app, 'dropFiles', [a], 'to-jpg')
    await waitForTerminalEvent(app, armed.eventsBefore)
    await expectUncleState(armed.overlay, 'leave', 8_000).catch(() => undefined)
    await new Promise((r) => setTimeout(r, 120 + i * 60))
    await armed.stopScreens()
    const b = await makePng(d(`race-b-${i}.png`))
    const before = (await hook(app, 'jobEvents')).length
    await hook(app, 'arm')
    await new Promise((r) => setTimeout(r, 300))
    const vis = await hook(app, 'overlayVisible')
    await hook(app, 'dropFiles', [b], 'to-webp')
    const ev = await waitForTerminalEvent(app, before).catch(() => undefined)
    if (vis && ev?.type === 'done') raceOk++
    await expectOverlayHidesItself(app).catch(() => undefined)
  }
  lines.push(`arm right after leave, 5 timings: ${raceOk}/5 OK`)
  if (raceOk !== 5) ok = false
  record({ id: 'P4-REARM', what: 'B-056: new arm while a spit card / choke card / leave animation is shown → new gesture works', result: ok ? 'PASS' : 'FAIL', evidence: lines.join('; ') })
  expect(ok, lines.join('\n')).toBe(true)
})

// ---------------------------------------------------------------------------------------------
// B-060: svg/math mutation-XSS payloads removed from Markdown → HTML; rendered WITHOUT the CSP in a
// throw-away window so a surviving handler would actually run.
// ---------------------------------------------------------------------------------------------
const MXSS = [
  `<svg><style><img src=x onerror="document.title='PWNED-1'"></style></svg>`,
  `<math><mtext><table><mglyph><style><img src=x onerror="document.title='PWNED-2'">`,
  `<form><math><mtext></form><form><mglyph><style></math><img src onerror="document.title='PWNED-3'">`,
  `<svg></p><style><a id="</style><img src=1 onerror=document.title='PWNED-4'>">`,
  `<math><mi><mglyph><svg><mtext><textarea><path id="</textarea><img onerror=document.title='PWNED-5' src=1>">`,
  `<noscript><p title="</noscript><img src=x onerror=document.title='PWNED-6'>">`,
  `<style><img src=x onerror="document.title='PWNED-7'"></style>`,
  `<template><img src=x onerror="document.title='PWNED-8'"></template>`,
  `<svg><foreignObject><img src=x onerror="document.title='PWNED-9'"></foreignObject></svg>`,
  `<math><annotation-xml encoding="text/html"><style><img src=x onerror="document.title='PWNED-10'"></style></annotation-xml></math>`,
  `<svg><a xlink:href="javascript:document.title='PWNED-11'"><text x=20 y=20>click</text></a></svg>`,
  `<a href="jav&#x09;ascript:document.title='PWNED-12'">x</a>`,
  `<iframe srcdoc="<script>parent.document.title='PWNED-13'</script>"></iframe>`,
  `<img src=x onerror="document.title='PWNED-14'">`,
  `<details open ontoggle="document.title='PWNED-15'">`,
  `<xmp><img src=x onerror="document.title='PWNED-16'"></xmp>`,
  `<select><style></select><img src=x onerror="document.title='PWNED-17'"></style>`
]

test('P4 B-060 mutation-XSS payloads removed from Markdown → HTML', async ({ lud }, testInfo) => {
  test.setTimeout(5 * 60_000)
  const app = await lud.launchReady()
  // One file per payload (an unclosed payload would otherwise hide the ones after it, QA-P4-01).
  const inputs: string[] = []
  for (const [i, p] of MXSS.entries()) inputs.push(await textFile(join(lud.workDir, `case-${String(i + 1).padStart(2, '0')}.md`), `# Case ${i + 1}\n\n${p}\n\nEnd of file.\n`))
  const r = await convert(app, testInfo, 'p4-mxss', inputs, 'to-html')
  expect(r.event.type).toBe('done')
  const outs = r.event.type === 'done' ? r.event.outputPaths : []
  const unsafe: string[] = []
  const truncated: string[] = []
  let withCsp = 0
  for (const out of outs) {
    const html = readFileSync(out, 'utf8')
    if (/http-equiv=["']?Content-Security-Policy/i.test(html)) withCsp++
    if (!html.includes('End of file.')) truncated.push(basename(out))
    const noCsp = html.replace(/<meta[^>]+Content-Security-Policy[^>]*>/gi, '')
    // Render in a separate session/partition WITHOUT the CSP and check what survived parsing + mutation.
    const v = await app.evaluate(async ({ BrowserWindow }, page: string) => {
      const w = new BrowserWindow({ show: false, webPreferences: { partition: 'qa-mxss', sandbox: true, javascript: true } })
      await w.loadURL(`data:text/html;base64,${Buffer.from(page).toString('base64')}`)
      await new Promise((r) => setTimeout(r, 800))
      const res = (await w.webContents.executeJavaScript(`(() => {
        const scan = (doc) => {
          const all = [...doc.querySelectorAll('*')]
          const bad = all.filter((e) => ['svg','math','script','iframe','object','embed','template','noscript','base','link','foreignobject','annotation-xml','mglyph','frame','portal'].includes(e.localName) || (e.localName === 'meta' && !/charset|viewport/i.test(e.outerHTML))).map((e) => e.localName)
          const on = all.flatMap((e) => [...e.attributes].filter((a) => /^on/i.test(a.name)).map((a) => e.localName + '[' + a.name + ']'))
          const js = all.flatMap((e) => [...e.attributes].filter((a) => /^javascript:/i.test(a.value.replace(/[\\u0000-\\u0020]/g, ''))).map((a) => e.localName + '[' + a.name + ']'))
          return [...bad, ...on, ...js]
        }
        // round trip: serialise and re-parse (mXSS needs a second parse)
        const again = new DOMParser().parseFromString(document.documentElement.outerHTML, 'text/html')
        return { title: document.title, first: scan(document), second: scan(again) }
      })()`)) as { title: string; first: string[]; second: string[] }
      w.destroy()
      return res
    }, noCsp)
    if (v.title.includes('PWNED') || v.first.length > 0 || v.second.length > 0) unsafe.push(`${basename(out)}: title "${v.title}" ${[...v.first, ...v.second].join(',')}`)
  }
  record({
    id: 'P4-MXSS',
    what: `B-060: ${MXSS.length} svg/math/style/noscript mutation-XSS payloads (one Markdown file each) → HTML, each output rendered WITHOUT its CSP and re-parsed`,
    result: outs.length === MXSS.length && unsafe.length === 0 && withCsp === outs.length ? 'PASS' : 'FAIL',
    evidence: `${outs.length} outputs; script ran / dangerous markup: ${unsafe.length ? unsafe.join('; ') : 'none'}; CSP meta in ${withCsp}/${outs.length}`
  })
  record({
    id: 'P4-SANITIZER-TRUNCATION',
    what: 'QA-P4-01: text after an unclosed svg/math/noscript/template payload is kept in the HTML output',
    result: truncated.length === 0 ? 'PASS' : 'FAIL',
    evidence: truncated.length ? `"End of file." missing in ${truncated.join(', ')}` : 'all outputs complete'
  })
  expect(unsafe, unsafe.join('\n')).toEqual([])
})
