// QA phase 3b: cancel at every stage, Esc reachability, Remove-BG first-use download, settings
// persistence, Feed Window conversions.
import type { ElectronApplication, TestInfo } from '@playwright/test'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { JobEvent, Settings } from '../../../src/shared/types'
import { T, expect, expectUncleState, getSettingsFrom, hook, newJobEvents, test, waitForPage, waitForTerminalEvent, windowInfo } from '../../e2e/support/app'
import { armOverlay, expectOverlayHidesItself } from '../../e2e/support/flows'
import { makePng } from '../../e2e/support/fixtures'
import { changeSettings, hookP2, processesMentioning } from '../../e2e/support/p2'
import { convert, makeVideo, record } from './support'
import { alphaStats } from './validate'

function describe(ev: JobEvent | undefined): string {
  if (!ev) return 'no terminal event'
  if (ev.type === 'done') return `done → ${ev.outputPaths.map((p) => basename(p)).join(', ')}`
  if (ev.type === 'error') return `error ${ev.error.code}: "${ev.error.message}"`
  return ev.type
}

async function cancelAt(
  app: ElectronApplication,
  testInfo: TestInfo,
  workDir: string,
  id: string,
  what: string,
  input: string,
  wait: (overlay: import('@playwright/test').Page, before: number) => Promise<string>,
  how: 'hook' | 'button' = 'hook'
): Promise<void> {
  const armed = await armOverlay(app, testInfo, id)
  await hook(app, 'dropFiles', [input], 'to-webm')
  const at = await wait(armed.overlay, armed.eventsBefore)
  const t0 = Date.now()
  if (how === 'button') await armed.overlay.getByTestId('cancel-job').click()
  else await hookP2(app, 'cancelActive')
  let ev: JobEvent | undefined
  try {
    ev = await waitForTerminalEvent(app, armed.eventsBefore)
  } catch {
    ev = undefined
  }
  const ms = Date.now() - t0
  const bubble = await armed.overlay.getByTestId('speech-bubble').textContent({ timeout: 2_000 }).catch(() => null)
  await armed.stopScreens()
  const hid = await expectOverlayHidesItself(app).then(() => true, () => false)
  await new Promise((r) => setTimeout(r, 1_500))
  const files = readdirSync(workDir).filter((n) => n !== basename(input) && !n.endsWith('.mp4') && !n.endsWith('.png') && !n.endsWith('.jpg'))
  const procs = processesMentioning(workDir)
  const pass = ev?.type === 'error' && ev.error.code === 'CANCELLED' && files.length === 0 && procs.length === 0 && hid
  record({
    id,
    what,
    result: pass ? 'PASS' : 'FAIL',
    evidence: `cancelled at ${at}; ${describe(ev)} after ${ms} ms; bubble "${bubble ?? ''}"; leftovers [${files.join(', ')}]; ffmpeg procs ${procs.length}; overlay hid: ${hid}`
  })
}

test.describe.configure({ mode: 'serial' })

test('QA-FLOW cancel at eat / early chew / late chew; Esc reachability', async ({ lud }, testInfo) => {
  test.setTimeout(15 * 60_000)
  const app = await lud.launchReady()
  const d = (n: string): string => join(lud.workDir, n)
  const long = makeVideo(d('long.mp4'), 30)

  await cancelAt(app, testInfo, lud.workDir, 'FLOW-CANCEL-EAT', 'cancel during "eat" (right after the drop)', long, async (overlay) => {
    await expectUncleState(overlay, ['eat', 'chew'])
    return (await overlay.getByTestId('overlay-root').getAttribute('data-uncle-state')) ?? '?'
  })
  await cancelAt(app, testInfo, lud.workDir, 'FLOW-CANCEL-EARLY', 'cancel early in chew (first progress event)', long, async (overlay, before) => {
    await expectUncleState(overlay, 'chew')
    await expect.poll(async () => (await newJobEvents(app, before)).some((e) => e.type === 'progress'), { timeout: T.job }).toBe(true)
    const p = (await newJobEvents(app, before)).filter((e) => e.type === 'progress').pop()
    return `chew, progress ${p?.type === 'progress' ? p.progress.toFixed(2) : '?'}`
  }, 'button')
  await cancelAt(app, testInfo, lud.workDir, 'FLOW-CANCEL-LATE', 'cancel late in chew (progress ≥ 0.8)', long, async (_overlay, before) => {
    let last = 0
    await expect
      .poll(async () => {
        const p = (await newJobEvents(app, before)).filter((e) => e.type === 'progress').pop()
        last = p?.type === 'progress' ? p.progress : 0
        return last >= 0.8
      }, { timeout: 5 * 60_000, intervals: [100] })
      .toBe(true)
    return `chew, progress ${last.toFixed(2)}`
  })

  // Esc: can the key reach the overlay while chewing? In real use the overlay is shown inactive and
  // made non-focusable while a job runs (focus stays in Finder/Explorer).
  const armed = await armOverlay(app, testInfo, 'esc')
  await hook(app, 'dropFiles', [long], 'to-webm')
  await expectUncleState(armed.overlay, 'chew')
  const info = await windowInfo(app, 'overlay')
  const focusable = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => /\/overlay\/index\.html/.test(x.webContents.getURL()))
    return w ? w.isFocusable() : null
  })
  await armed.overlay.keyboard.press('Escape')
  const ev = await waitForTerminalEvent(app, armed.eventsBefore)
  await armed.stopScreens()
  await expectOverlayHidesItself(app)
  record({
    id: 'FLOW-ESC',
    what: 'Esc during chew (overlay drop on an option, not the held-files flow)',
    result: info.focused || focusable ? 'PASS' : 'FAIL',
    evidence: `overlay focused=${info.focused}, focusable=${String(focusable)} while chewing → a real Esc key press goes to the app under the cursor, not to the Uncle. Synthetic Esc delivered to the page: ${describe(ev)}`
  })
  // After all the cancels the engine still works.
  const p = await makePng(d('after.png'))
  const r = await convert(app, testInfo, 'after-cancel', [p], 'to-jpg')
  record({ id: 'FLOW-CANCEL-AFTER', what: 'conversion right after 4 cancels', result: r.event.type === 'done' ? 'PASS' : 'FAIL', evidence: describe(r.event) })
})

test('QA-FLOW Remove BG first use: real download from upstream, cancel during download, cache reuse', async ({ lud }, testInfo) => {
  test.setTimeout(30 * 60_000)
  const photos = (process.env['QA_PHOTOS'] ?? '').split(',').filter(Boolean)
  test.skip(photos.length === 0 || process.env['QA_DOWNLOAD'] !== '1', 'set QA_PHOTOS and QA_DOWNLOAD=1 (downloads 179 MB)')
  const app = await lud.launchReady({ env: { LUD_MODEL_PATH: '' } })
  const d = (n: string): string => join(lud.workDir, n)
  const photo = d(basename(photos[0]!))
  writeFileSync(photo, readFileSync(photos[0]!))
  const modelsDir = join(lud.userDataDir, 'models')

  // 1) start, observe the stage text, cancel during the download.
  {
    const armed = await armOverlay(app, testInfo, 'rmbg-dl-cancel')
    await hook(app, 'dropFiles', [photo], 'remove-bg')
    await expect
      .poll(async () => (await newJobEvents(app, armed.eventsBefore)).some((e) => e.type === 'progress' && e.progress > 0.02), { timeout: 120_000 })
      .toBe(true)
    const stages = [...new Set((await newJobEvents(app, armed.eventsBefore)).flatMap((e) => (e.type === 'progress' && e.stage ? [e.stage] : [])))]
    const bubble = await armed.overlay.getByTestId('speech-bubble').textContent().catch(() => null)
    const ringText = await armed.overlay.getByTestId('progress-ring').textContent().catch(() => null)
    await hookP2(app, 'cancelActive')
    const ev = await waitForTerminalEvent(app, armed.eventsBefore)
    await armed.stopScreens()
    await expectOverlayHidesItself(app)
    await new Promise((r) => setTimeout(r, 1_000))
    const left = existsSync(modelsDir) ? readdirSync(modelsDir) : []
    const outs = readdirSync(lud.workDir).filter((n) => n.includes('-nobg'))
    record({
      id: 'FLOW-RMBG-DL-CANCEL',
      what: 'Remove BG first use: cancel during the 179 MB download',
      result: ev.type === 'error' && ev.error.code === 'CANCELLED' && outs.length === 0 ? 'PASS' : 'FAIL',
      evidence: `stages ${JSON.stringify(stages)}; bubble "${bubble}"; ring "${ringText}"; ${describe(ev)}; models dir after: [${left.join(', ')}]`
    })
  }
  // 2) full download + conversion.
  {
    const t0 = Date.now()
    const armed = await armOverlay(app, testInfo, 'rmbg-dl')
    await hook(app, 'dropFiles', [photo], 'remove-bg')
    let ev: JobEvent | undefined
    await expect
      .poll(async () => {
        ev = (await newJobEvents(app, armed.eventsBefore)).find((e) => e.type === 'done' || e.type === 'error')
        return ev !== undefined
      }, { timeout: 20 * 60_000, intervals: [500] })
      .toBe(true)
    await armed.stopScreens()
    await expectOverlayHidesItself(app)
    const s = ev?.type === 'done' ? await alphaStats(ev.outputPaths[0]!) : null
    record({
      id: 'FLOW-RMBG-DL',
      what: 'Remove BG first use: download + verify + cut-out',
      result: ev?.type === 'done' && s !== null && s.transparent > 0.1 ? 'PASS' : 'FAIL',
      evidence: `${describe(ev)} after ${Math.round((Date.now() - t0) / 1000)} s; ${s ? `${Math.round(s.transparent * 100)} % transparent` : ''}; models dir: [${readdirSync(modelsDir).join(', ')}]`
    })
  }
  // 3) cached: second use is quick.
  {
    const r = await convert(app, testInfo, 'rmbg-cached', [photo], 'remove-bg')
    record({ id: 'FLOW-RMBG-CACHED', what: 'Remove BG second use (cached model)', result: r.event.type === 'done' ? 'PASS' : 'FAIL', evidence: `${describe(r.event)} in ${r.ms} ms` })
  }
})

test('QA-FLOW settings persistence + Feed Window conversions', async ({ lud }) => {
  test.setTimeout(10 * 60_000)
  let app = await lud.launchReady()
  const wanted: Partial<Settings> = { triggerKey: 'alt', sounds: false, hungryMode: true, plainMode: true }
  await changeSettings(app, wanted)
  await lud.close(app)
  const file = readdirSync(lud.userDataDir).filter((n) => n.endsWith('.json'))
  app = await lud.launchReady()
  await hook(app, 'openSettingsWindow')
  const settingsPage = await waitForPage(app, 'settings')
  const got = await getSettingsFrom(settingsPage)
  const ok = Object.entries(wanted).every(([k, v]) => got[k as keyof Settings] === v)
  // The settings UI shows the restored values (not just the store).
  const ui = await settingsPage.evaluate(() => {
    const q = (id: string): string => {
      const el = (globalThis as unknown as { document: { querySelector(s: string): { checked?: boolean; value?: string; getAttribute(n: string): string | null } | null } }).document.querySelector(`[data-testid="setting-${id}"]`)
      if (!el) return 'missing'
      return el.checked !== undefined && el.getAttribute('type') === 'checkbox' ? String(el.checked) : String(el.value ?? el.getAttribute('aria-checked') ?? el.getAttribute('data-value'))
    }
    return { triggerKey: q('triggerKey'), sounds: q('sounds'), hungryMode: q('hungryMode'), plainMode: q('plainMode'), launchAtLogin: q('launchAtLogin') }
  })
  record({ id: 'FLOW-SETTINGS', what: 'trigger key, sounds, hungry, plain persist across a restart', result: ok ? 'PASS' : 'FAIL', evidence: `store ${JSON.stringify(got)}; UI ${JSON.stringify(ui)}; files ${file.join(', ')}` })

  // Feed Window: drop → option, then mouth → pick, in Plain+Hungry mode.
  const d = (n: string): string => join(lud.workDir, n)
  const png = await makePng(d('feed me.png'))
  // Open the Feed Window first: dropFilesOnFeed on a window it has to open itself never resolves
  // (see docs/qa/QA_REPORT.md, test-hook finding).
  await hook(app, 'openFeedWindow')
  await waitForPage(app, 'feed')
  await new Promise((r) => setTimeout(r, 1_000))
  const before = (await hook(app, 'jobEvents')).length
  await hook(app, 'dropFilesOnFeed', [png], 'to-webp')
  const ev = await waitForTerminalEvent(app, before)
  const feed = await waitForPage(app, 'feed')
  record({ id: 'FLOW-FEED-1', what: 'Feed Window drop on WEBP (Plain + Hungry on)', result: ev.type === 'done' ? 'PASS' : 'FAIL', evidence: describe(ev) })
  await changeSettings(app, { plainMode: false, hungryMode: false })
  await expect.poll(async () => feed.getByTestId('feed-root').getAttribute('data-uncle-state'), { timeout: 15_000 }).toBe('idle')
  const before2 = (await hook(app, 'jobEvents')).length
  await hook(app, 'dropFilesOnFeed', [png], null)
  await feed.getByTestId('option-to-avif').click({ timeout: 10_000 })
  const ev2 = await waitForTerminalEvent(app, before2)
  const info = await windowInfo(app, 'feed')
  record({ id: 'FLOW-FEED-2', what: 'Feed Window drop on the Uncle → pick AVIF', result: ev2.type === 'done' && info.visible ? 'PASS' : 'FAIL', evidence: `${describe(ev2)}; window still open: ${info.visible}` })
  await lud.close(app)
})
