// QA phase 3b: nasty-but-legit inputs through the overlay flow of the real app.
import { chmodSync, closeSync, existsSync, ftruncateSync, mkdirSync, openSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { JobEvent, OptionId } from '../../../src/shared/types'
import { T, expect, expectUncleState, hook, newJobEvents, test, waitForTerminalEvent } from '../../e2e/support/app'
import { armOverlay, expectOverlayHidesItself } from '../../e2e/support/flows'
import { makePng } from '../../e2e/support/fixtures'
import { attr, changeSettings } from '../../e2e/support/p2'
import { noisyPng, pdfFile } from '../../helpers/fixtures'
import { convert, makeVideo, record, short } from './support'
import { imageMeta, pdfPages } from './validate'

function describe(ev: JobEvent): string {
  if (ev.type === 'done') return `done → ${ev.outputPaths.map((p) => basename(p)).join(', ')}`
  if (ev.type === 'error') return `error ${ev.error.code}: "${ev.error.message}"`
  return ev.type
}

test.describe.configure({ mode: 'serial' })

test('QA-NASTY names, paths and permissions', async ({ lud }, testInfo) => {
  test.setTimeout(15 * 60_000)
  const app = await lud.launchReady()
  const d = (n: string): string => join(lud.workDir, n)
  const run = async (id: string, what: string, input: string, option: OptionId, expectOk = true): Promise<JobEvent> => {
    try {
      const r = await convert(app, testInfo, id, [input], option)
      const ok = (r.event.type === 'done') === expectOk
      record({ id, what, result: ok ? 'PASS' : 'FAIL', evidence: `${describe(r.event)}; states ${r.states.join('→')}` })
      return r.event
    } catch (err) {
      record({ id, what, result: 'FAIL', evidence: short((err as Error).message.split('\n')[0] ?? '', 300) })
      throw err
    }
  }

  // Very long names: 250-byte name; outputs that add a suffix exceed NAME_MAX (255 bytes on
  // Linux/macOS APFS; 255 UTF-16 units on NTFS).
  const long = d(`${'L'.repeat(246)}.png`)
  await makePng(long)
  await run('NASTY-LONG-1', '250-char file name → WEBP (same length)', long, 'to-webp')
  await run('NASTY-LONG-2', '250-char file name → Compress (adds "-compressed", 261 chars)', long, 'compress')
  await run('NASTY-LONG-3', '250-char file name → PDF pages (folder " (pages)")', await pdfFile(d(`${'P'.repeat(246)}.pdf`), 1), 'pdf-to-png')

  // Emoji, RTL, quotes and URL-ish characters.
  const weird = d(`Ünïcødé 😀🎉 שלום עולם "quoted" 'single' #1 %20 & more; $HOME ~ (copy) [x] {y}.png`)
  await makePng(weird)
  const ev = await run('NASTY-NAME-1', 'emoji + RTL + quotes + #%&$ in the name → JPG', weird, 'to-jpg')
  if (ev.type === 'done') expect(existsSync(ev.outputPaths[0]!)).toBe(true)
  const dash = d('-y -i evil.png')
  await makePng(dash)
  await run('NASTY-NAME-2', 'name that looks like ffmpeg flags ("-y -i evil.png") → ICO (ffmpeg path)', dash, 'to-ico')
  const nfd = d('Café décomposé.png') // macOS-style NFD name
  await makePng(nfd)
  await run('NASTY-NAME-3', 'NFD (decomposed) unicode name → AVIF', nfd, 'to-avif')
  const noExt = d('README')
  writeFileSync(noExt, 'no extension')
  const ne = await run('NASTY-NAME-4', 'file without extension → ZIP (only option)', noExt, 'zip')
  expect(ne.type).toBe('done')
  const dotted = d('.hidden.png')
  await makePng(dotted)
  await run('NASTY-NAME-5', 'dotfile ".hidden.png" → JPG', dotted, 'to-jpg')
  const upper = d('SCREAMING.PNG')
  await makePng(upper)
  await run('NASTY-NAME-6', 'upper-case extension .PNG → WEBP', upper, 'to-webp')
  const fake = d('actually-a-png.jpg')
  await makePng(fake)
  await run('NASTY-NAME-7', 'PNG content with a .jpg extension → WEBP', fake, 'to-webp')

  // Deeply nested folder (path ~ 700 chars).
  let deep = lud.workDir
  for (let i = 0; i < 25; i++) deep = join(deep, `nested folder ${i} ü`)
  mkdirSync(deep, { recursive: true })
  const deepPng = join(deep, 'deep photo.png')
  await makePng(deepPng)
  await run('NASTY-DEEP-1', `deeply nested input (path ${deepPng.length} chars) → JPG`, deepPng, 'to-jpg')

  // Read-only input file (and read-only folder: root ignores modes, so only the file case is meaningful here).
  const ro = d('readonly.png')
  await makePng(ro)
  chmodSync(ro, 0o444)
  await run('NASTY-RO-1', 'read-only input file (0444) → JPG', ro, 'to-jpg')

  // Zero-byte files of several categories.
  for (const [name, option, ok] of [
    ['empty.png', 'to-jpg', false],
    ['empty.mp4', 'to-gif', false],
    ['empty.pdf', 'pdf-to-png', false],
    ['empty.docx', 'to-pdf', false],
    ['empty.csv', 'to-json', null],
    ['empty.md', 'to-pdf', null],
    ['empty.zip', 'unzip', false],
    ['empty.mp3', 'to-wav', false]
  ] as const) {
    writeFileSync(d(name), '')
    const r = await convert(app, testInfo, `zero-${name}`, [d(name)], option)
    const msg = r.event.type === 'error' ? r.event.error.message : ''
    const friendly = r.event.type === 'done' || (msg.length > 0 && msg.length <= 200 && !/Error:|\bat \w+ \(|ENOENT|undefined/.test(msg))
    const pass = friendly && (ok === null || (r.event.type === 'done') === ok)
    record({ id: `NASTY-ZERO-${name}`, what: `0-byte ${name} → ${option}`, result: pass ? 'PASS' : 'FAIL', evidence: `${describe(r.event)}; states ${r.states.join('→')}` })
  }
  const left = readdirSync(lud.workDir).filter((n) => n.startsWith('.lud') || n.includes('.tmp') || n.endsWith('.part'))
  record({ id: 'NASTY-TEMP', what: 'no temp files left in the work folder after all of the above', result: left.length === 0 ? 'PASS' : 'FAIL', evidence: left.join(', ') || 'none' })
})

test('QA-NASTY 1 GB sparse video (struggle), 20-file batch, double drop, back-to-back', async ({ lud }, testInfo) => {
  test.setTimeout(20 * 60_000)
  const app = await lud.launchReady()
  const d = (n: string): string => join(lud.workDir, n)

  // 1) 1 GB of zeros named .mp4 (not decodable) → struggle while chewing, then a friendly choke.
  const sparse = d('huge.mp4')
  const fd = openSync(sparse, 'w')
  ftruncateSync(fd, 1024 * 1024 * 1024)
  closeSync(fd)
  {
    const armed = await armOverlay(app, testInfo, 'sparse-1g')
    const t0 = Date.now()
    await hook(app, 'dropFiles', [sparse], 'compress')
    const moods = new Set<string>()
    const poll = setInterval(() => void attr(armed.overlay, 'overlay-root', 'data-uncle-mood').then((m) => m && moods.add(m)).catch(() => undefined), 50)
    const ev = await waitForTerminalEvent(app, armed.eventsBefore)
    clearInterval(poll)
    await armed.stopScreens()
    await expectOverlayHidesItself(app)
    record({
      id: 'NASTY-1GB-1',
      what: '1 GB sparse "huge.mp4" (zeros) → Compress',
      result: moods.has('struggle') && ev.type === 'error' && ev.error.code !== 'INTERNAL' ? 'PASS' : 'FAIL',
      evidence: `moods seen ${[...moods].join(',')}; ${describe(ev)} after ${Date.now() - t0} ms`
    })
  }

  // 2) A real clip followed by a 1 GB sparse tail: decodable, > 200 MB → struggle then done (+ burp).
  const realBig = makeVideo(d('real big.mp4'), 4, ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart'])
  const fd2 = openSync(realBig, 'r+')
  ftruncateSync(fd2, 1024 * 1024 * 1024)
  closeSync(fd2)
  {
    const armed = await armOverlay(app, testInfo, 'real-1g')
    const t0 = Date.now()
    await hook(app, 'dropFiles', [realBig], 'to-gif')
    const moods = new Set<string>()
    const poll = setInterval(() => void attr(armed.overlay, 'overlay-root', 'data-uncle-mood').then((m) => m && moods.add(m)).catch(() => undefined), 50)
    const ev = await waitForTerminalEvent(app, armed.eventsBefore)
    clearInterval(poll)
    await armed.stopScreens()
    await expectOverlayHidesItself(app)
    record({
      id: 'NASTY-1GB-2',
      what: '4 s H.264 clip padded to 1 GB (sparse tail) → GIF',
      result: moods.has('struggle') && ev.type === 'done' ? 'PASS' : 'FAIL',
      evidence: `moods seen ${[...moods].join(',')}; ${describe(ev)} after ${Date.now() - t0} ms`
    })
  }

  // 3) 20-file batch: each (JPG) and merge (PDF).
  const twenty: string[] = []
  for (let i = 1; i <= 20; i++) twenty.push(await noisyPng(d(`batch ${String(i).padStart(2, '0')}.png`), 400, 300))
  {
    const r = await convert(app, testInfo, 'batch20-jpg', twenty, 'to-jpg')
    const n = r.event.type === 'done' ? r.event.outputPaths.length : 0
    record({ id: 'NASTY-BATCH-1', what: '20 PNGs → JPG (each)', result: n === 20 ? 'PASS' : 'FAIL', evidence: `${n} outputs in ${r.ms} ms; states ${r.states.join('→')}` })
    const r2 = await convert(app, testInfo, 'batch20-pdf', twenty, 'to-pdf')
    const pages = r2.event.type === 'done' ? pdfPages(r2.event.outputPaths[0]!) : 0
    record({ id: 'NASTY-BATCH-2', what: '20 PNGs → one PDF (merge)', result: pages === 20 ? 'PASS' : 'FAIL', evidence: `${describe(r2.event)}, ${pages} pages, ${r2.ms} ms` })
  }

  // 4) Same file dropped twice quickly (second drop while the first is being eaten).
  {
    const p = await makePng(d('twice.png'), 1200, 900)
    const armed = await armOverlay(app, testInfo, 'twice')
    await hook(app, 'dropFiles', [p], 'to-webp')
    await hook(app, 'dropFiles', [p], 'to-webp')
    await waitForTerminalEvent(app, armed.eventsBefore)
    await new Promise((r) => setTimeout(r, 3_000))
    const evs = await newJobEvents(app, armed.eventsBefore)
    await armed.stopScreens()
    await expectOverlayHidesItself(app)
    const jobs = new Set(evs.map((e) => e.jobId))
    const outs = readdirSync(lud.workDir).filter((n) => n.startsWith('twice') && n.endsWith('.webp'))
    record({
      id: 'NASTY-TWICE',
      what: 'same file dropped twice within a few ms',
      result: jobs.size === 1 && outs.length === 1 ? 'PASS' : 'NOTE',
      evidence: `${jobs.size} job(s), outputs ${outs.join(', ')}`
    })
  }

  // 5) Two jobs back-to-back: a second gesture while the first result card is still shown.
  {
    const a = await makePng(d('first.png'))
    const b = await makePng(d('second.png'))
    const armed = await armOverlay(app, testInfo, 'b2b-1')
    await hook(app, 'dropFiles', [a], 'to-jpg')
    const ev1 = await waitForTerminalEvent(app, armed.eventsBefore)
    await expectUncleState(armed.overlay, 'spit')
    await armed.stopScreens()
    // User immediately drags the next file (card still visible).
    const before2 = (await hook(app, 'jobEvents')).length
    await hook(app, 'arm')
    await hook(app, 'dropFiles', [b], 'to-jpg')
    let ev2: JobEvent | undefined
    try {
      ev2 = await waitForTerminalEvent(app, before2)
    } catch {
      ev2 = undefined
    }
    await expectOverlayHidesItself(app).catch(() => undefined)
    record({
      id: 'NASTY-B2B',
      what: 'second drag+drop while the first result card is still visible (spit)',
      result: ev1.type === 'done' && ev2?.type === 'done' ? 'PASS' : 'FAIL',
      evidence: `first ${describe(ev1)}; second ${ev2 ? describe(ev2) : 'NO JOB STARTED (drop ignored)'}; overlay visible now: ${String(await hook(app, 'overlayVisible'))}`
    })
  }

  // 6) Hungry/Plain switched mid-session (while a job is chewing).
  {
    const vid = makeVideo(d('mid.mp4'), 8)
    const armed = await armOverlay(app, testInfo, 'mid-switch')
    await hook(app, 'dropFiles', [vid], 'to-webm')
    await expectUncleState(armed.overlay, 'chew', T.job)
    await changeSettings(app, { plainMode: true, hungryMode: true })
    const plainNow = await attr(armed.overlay, 'overlay-root', 'data-plain')
    const ev = await waitForTerminalEvent(app, armed.eventsBefore)
    await armed.stopScreens()
    await expectOverlayHidesItself(app)
    const p = await makePng(d('after switch.png'))
    const armed2 = await armOverlay(app, testInfo, 'mid-switch-2')
    await hook(app, 'dropFiles', [p], 'to-jpg')
    const ev2 = await waitForTerminalEvent(app, armed2.eventsBefore)
    const plain2 = await attr(armed2.overlay, 'overlay-root', 'data-plain')
    await armed2.stopScreens()
    await expectOverlayHidesItself(app)
    await changeSettings(app, { plainMode: false, hungryMode: false })
    record({
      id: 'NASTY-MODES',
      what: 'Plain + Hungry switched on while the Uncle chews; next gesture uses Plain',
      result: ev.type === 'done' && ev2.type === 'done' && plain2 === 'true' ? 'PASS' : 'FAIL',
      evidence: `running job ${describe(ev)}; data-plain during that chew right after the switch=${plainNow}; next job ${describe(ev2)} data-plain=${plain2}`
    })
  }
})

test('QA-NASTY corrupt-but-named inputs give friendly errors', async ({ lud }, testInfo) => {
  test.setTimeout(10 * 60_000)
  const app = await lud.launchReady()
  const d = (n: string): string => join(lud.workDir, n)
  const truncated = d('truncated.mp4')
  makeVideo(truncated, 4)
  const { truncateSync, statSync } = await import('node:fs')
  truncateSync(truncated, Math.floor(statSync(truncated).size / 3))
  const r = await convert(app, testInfo, 'truncated', [truncated], 'to-mp3')
  record({ id: 'NASTY-TRUNC-MP4', what: 'MP4 cut to 1/3 (no moov atom at end) → MP3', result: r.event.type === 'error' && r.event.error.code === 'INPUT_INVALID' ? 'PASS' : 'NOTE', evidence: describe(r.event) })
  const pdf = await pdfFile(d('encrypted-ish.pdf'), 2)
  const { readFileSync } = await import('node:fs')
  writeFileSync(pdf, readFileSync(pdf).subarray(0, 400))
  const r2 = await convert(app, testInfo, 'cutpdf', [pdf], 'pdf-to-png')
  record({ id: 'NASTY-TRUNC-PDF', what: 'PDF cut to 400 bytes → PNG pages', result: r2.event.type === 'error' && r2.event.error.code === 'INPUT_INVALID' ? 'PASS' : 'FAIL', evidence: describe(r2.event) })
  const big = d('portrait.png')
  await makePng(big, 8000, 6000)
  const r3 = await convert(app, testInfo, 'big-png', [big], 'to-avif')
  const m = r3.event.type === 'done' ? await imageMeta(r3.event.outputPaths[0]!) : null
  record({ id: 'NASTY-48MP', what: '48 MP PNG (8000x6000) → AVIF', result: r3.event.type === 'done' ? 'PASS' : 'FAIL', evidence: `${describe(r3.event)} ${m ? `${m.width}x${m.height}` : ''} in ${r3.ms} ms` })
})
