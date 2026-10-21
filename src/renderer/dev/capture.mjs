// Visual QA: drives the real renderer UI (mocked window.lud) in plain Chromium via Playwright and
// saves screenshots of every Uncle state to docs/art/screens/, plus an eat→chew→spit GIF.
//
//   node src/renderer/dev/capture.mjs                # all scenarios + GIF
//   node src/renderer/dev/capture.mjs hover feed     # only scenarios whose name contains a filter
//   LUD_SCREENS_DIR=/tmp/x node src/renderer/dev/capture.mjs
//
// Chromium: LUD_CHROMIUM_PATH, else the newest chromium-*/chrome-linux/chrome under
// PLAYWRIGHT_BROWSERS_PATH, else Playwright's default. GIF needs ffmpeg (LUD_FFMPEG_PATH or PATH).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { repoRoot, serverUrl, startRendererServer } from './vite-dev.mjs'

const outDir = resolve(process.env.LUD_SCREENS_DIR ?? join(repoRoot, 'docs/art/screens'))
const filters = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

function findChromium() {
  if (process.env.LUD_CHROMIUM_PATH) return process.env.LUD_CHROMIUM_PATH
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!base || !existsSync(base)) return undefined
  const dirs = readdirSync(base)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const d of dirs) {
    const p = join(base, d, 'chrome-linux', 'chrome')
    if (existsSync(p)) return p
  }
  return undefined
}

const PNG = { name: 'holiday-photo.png', type: 'image/png' }
const MP4 = { name: 'birthday.mp4', type: 'video/mp4' }
const HUGE = { name: 'huge-concert.mov', type: 'video/quicktime' }
const MYSTERY = { name: 'notes.md', type: '' }
const EXE = { name: 'setup.exe', type: 'application/x-msdownload' }
const WAV = { name: 'voice-memo.wav', type: 'audio/wav' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const server = await startRendererServer({ port: 0 })
const base = `${serverUrl(server)}/dev/harness.html`
const browser = await chromium.launch({ executablePath: findChromium() })
const written = []

async function open(params, { width = 600, height = 600, reducedMotion = 'no-preference' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto(`${base}?${new URLSearchParams(params)}`)
  await page.waitForFunction(() => !!window.__harness && !!document.querySelector('[data-uncle-state], [data-testid="settings-root"]'))
  await sleep(300)
  return { page, ctx, errors }
}

async function shot(page, name) {
  const file = join(outDir, `${name}.png`)
  await page.screenshot({ path: file })
  written.push(file)
}

const H = (page, fn, ...args) => page.evaluate(fn, ...args)
const enterAt = (page, x, y, files) =>
  H(page, ([x, y, files]) => {
    window.__harness.drag('dragenter', x, y, files)
    window.__harness.drag('dragover', x, y, files)
  }, [x, y, files])
const overAt = (page, x, y, files) => H(page, ([x, y, files]) => window.__harness.drag('dragover', x, y, files), [x, y, files])
const dropAt = (page, x, y, files) => H(page, ([x, y, files]) => window.__harness.drag('drop', x, y, files), [x, y, files])
const optionPoint = (page, id) => H(page, (id) => window.__harness.optionPoint(id), id)
const center = (page) => H(page, () => window.__harness.center())
const state = (page) => H(page, () => window.__harness.state())
const emit = (page, ev) =>
  H(page, (ev) => {
    const id = window.__harness.lastJobId()
    window.__harness.emitJobEvent({ ...ev, jobId: id })
  }, ev)

async function expectState(page, want) {
  const got = await state(page)
  if (got !== want) throw new Error(`expected data-uncle-state=${want}, got ${got}`)
}

const scenarios = {
  async 'overlay-01-appear'() {
    const { page, ctx } = await open({ view: 'overlay' })
    const c = await center(page)
    await enterAt(page, c.x, c.y + 40, [PNG])
    await sleep(650)
    await expectState(page, 'appear')
    await shot(page, 'overlay-01-appear')
    await ctx.close()
  },
  async 'overlay-02-hover'() {
    const { page, ctx } = await open({ view: 'overlay' })
    const c = await center(page)
    await enterAt(page, c.x, c.y + 40, [PNG])
    await sleep(450)
    const p = await optionPoint(page, 'to-webp')
    await overAt(page, p.x + 6, p.y + 4, [PNG])
    await sleep(700)
    await expectState(page, 'hover')
    await shot(page, 'overlay-02-hover-webp')
    const q = await optionPoint(page, 'remove-bg')
    await overAt(page, q.x, q.y, [PNG])
    await sleep(700)
    await shot(page, 'overlay-03-hover-remove-bg')
    await ctx.close()
  },
  async 'overlay-04-look'() {
    // Cursor in four directions (between bubbles) to prove head + eye tracking.
    const { page, ctx } = await open({ view: 'overlay' })
    const c = await center(page)
    await enterAt(page, c.x, c.y, [MP4])
    await sleep(450)
    const spots = {
      'top-left': -135,
      'top-right': -45,
      'bottom-left': 135,
      'bottom-right': 45
    }
    for (const [name, deg] of Object.entries(spots)) {
      const a = (deg * Math.PI) / 180
      await overAt(page, c.x + Math.cos(a) * 270, c.y + Math.sin(a) * 270, [MP4])
      await sleep(650)
      await shot(page, `overlay-04-look-${name}`)
    }
    // Cursor outside the window (main's 'cursor' channel).
    await H(page, () => window.__harness.cursor({ x: -400, y: 120 }))
    await sleep(650)
    await shot(page, 'overlay-04-look-outside-left')
    await ctx.close()
  },
  async 'overlay-05-feedme'() {
    const { page, ctx } = await open({ view: 'overlay' })
    const c = await center(page)
    await enterAt(page, c.x + 60, c.y + 120, [MYSTERY])
    await sleep(600)
    await expectState(page, 'feedMe')
    await shot(page, 'overlay-05-feedme')
    await dropAt(page, c.x, c.y + 30, [MYSTERY])
    await sleep(600)
    await expectState(page, 'feedMe')
    const p = await optionPoint(page, 'to-pdf')
    await page.mouse.move(p.x, p.y)
    await sleep(500)
    await shot(page, 'overlay-06-feedme-held')
    await ctx.close()
  },
  async 'overlay-07-eat-chew-spit'() {
    const { page, ctx } = await open({ view: 'overlay' })
    const c = await center(page)
    await enterAt(page, c.x, c.y, [PNG])
    await sleep(450)
    const p = await optionPoint(page, 'to-jpg')
    await overAt(page, p.x, p.y, [PNG])
    await sleep(200)
    await dropAt(page, p.x, p.y, [PNG])
    await sleep(170)
    await expectState(page, 'eat')
    await shot(page, 'overlay-07-eat')
    await sleep(700)
    await emit(page, { type: 'progress', progress: 0.45 })
    await sleep(350)
    await expectState(page, 'chew')
    await shot(page, 'overlay-08-chew')
    await emit(page, { type: 'done', outputPaths: ['/Users/demo/Desktop/holiday-photo.jpg'] })
    await sleep(800)
    await expectState(page, 'spit')
    await shot(page, 'overlay-09-spit')
    await sleep(2400)
    await shot(page, 'overlay-10-leave')
    await ctx.close()
  },
  async 'overlay-11-hamster'() {
    const { page, ctx } = await open({ view: 'overlay' })
    const c = await center(page)
    const files = [PNG, { name: 'cat.png', type: 'image/png' }, { name: 'dog.png', type: 'image/png' }]
    await enterAt(page, c.x, c.y, files)
    await sleep(450)
    const p = await optionPoint(page, 'to-pdf')
    await dropAt(page, p.x, p.y, files)
    await sleep(1200)
    await emit(page, { type: 'progress', progress: 0.3 })
    await sleep(300)
    await expectState(page, 'chew')
    await shot(page, 'overlay-11-hamster')
    await ctx.close()
  },
  async 'overlay-12-struggle'() {
    const { page, ctx } = await open({ view: 'overlay' })
    const c = await center(page)
    await enterAt(page, c.x, c.y, [HUGE])
    await sleep(450)
    const p = await optionPoint(page, 'compress')
    await dropAt(page, p.x, p.y, [HUGE])
    await sleep(1200)
    await emit(page, { type: 'progress', progress: -1, stage: 'thinking' })
    await sleep(500)
    await expectState(page, 'chew')
    await shot(page, 'overlay-12-struggle')
    await ctx.close()
  },
  async 'overlay-13-choke'() {
    const { page, ctx } = await open({ view: 'overlay' })
    const c = await center(page)
    await enterAt(page, c.x, c.y, [WAV])
    await sleep(450)
    const p = await optionPoint(page, 'to-mp3')
    await dropAt(page, p.x, p.y, [WAV])
    await sleep(1300)
    await emit(page, { type: 'error', error: { code: 'TOOL_FAILED', message: '' } })
    await sleep(700)
    await expectState(page, 'choke')
    await shot(page, 'overlay-13-choke')
    await ctx.close()
  },
  async 'overlay-14-refuse'() {
    const { page, ctx } = await open({ view: 'overlay' })
    const c = await center(page)
    await enterAt(page, c.x + 30, c.y + 60, [EXE])
    await sleep(900)
    await expectState(page, 'refuse')
    await shot(page, 'overlay-14-refuse')
    await ctx.close()
  },
  async 'overlay-15-plain'() {
    const { page, ctx } = await open({ view: 'overlay', plain: '1' })
    const c = await center(page)
    await enterAt(page, c.x, c.y, [PNG])
    await sleep(450)
    const p = await optionPoint(page, 'to-avif')
    await overAt(page, p.x, p.y, [PNG])
    await sleep(400)
    await shot(page, 'overlay-15-plain-hover')
    await dropAt(page, p.x, p.y, [PNG])
    await sleep(900)
    await emit(page, { type: 'progress', progress: 0.6 })
    await sleep(300)
    await shot(page, 'overlay-16-plain-chew')
    await ctx.close()
  },
  async 'overlay-17-reduced-motion'() {
    const { page, ctx } = await open({ view: 'overlay' }, { reducedMotion: 'reduce' })
    const c = await center(page)
    await enterAt(page, c.x, c.y, [PNG])
    await sleep(300)
    const p = await optionPoint(page, 'to-png')
    if (p) await overAt(page, p.x, p.y, [PNG])
    await sleep(500)
    await shot(page, 'overlay-17-reduced-motion')
    await ctx.close()
  },
  async 'feed-01'() {
    const { page, ctx } = await open({ view: 'feed', jobs: 'manual' }, { width: 440, height: 600 })
    await sleep(500)
    await shot(page, 'feed-01-idle')
    const c = await center(page)
    await enterAt(page, c.x, c.y, [MYSTERY])
    await dropAt(page, c.x, c.y, [MYSTERY])
    await sleep(700)
    await shot(page, 'feed-02-held')
    const p = await optionPoint(page, 'to-docx')
    await page.mouse.click(p.x, p.y)
    await sleep(1300)
    await emit(page, { type: 'progress', progress: 0.7 })
    await sleep(300)
    await shot(page, 'feed-03-chew')
    await emit(page, { type: 'done', outputPaths: ['/Users/demo/Desktop/notes.docx'] })
    await sleep(900)
    await shot(page, 'feed-04-spit')
    await ctx.close()
  },
  async 'settings'() {
    for (const [name, params] of [
      ['settings-01-mac-onboarding', { view: 'settings', platform: 'darwin', reason: 'mac-permission', firstRun: '1' }],
      ['settings-02-linux-wayland', { view: 'settings', platform: 'linux', reason: 'wayland' }],
      ['settings-03-windows-ready', { view: 'settings', platform: 'win32', sounds: '1' }]
    ]) {
      const { page, ctx } = await open(params, { width: 560, height: 900 })
      await page.waitForSelector('[data-testid="settings-root"][data-loaded="true"]')
      await sleep(400)
      await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true })
      written.push(join(outDir, `${name}.png`))
      await ctx.close()
    }
  },
  async 'gif'() {
    // Eat → chew → spit loop recorded with the CDP screencast (real-time frames), encoded with ffmpeg.
    const ffmpeg = process.env.LUD_FFMPEG_PATH ?? 'ffmpeg'
    const probe = spawnSync(ffmpeg, ['-version'], { shell: false })
    if (probe.status !== 0) {
      console.warn('ffmpeg not found; skipping GIF')
      return
    }
    const { page, ctx } = await open({ view: 'overlay', jobs: 'manual' }, { width: 520, height: 520 })
    const frames = mkdtempSync(join(tmpdir(), 'lud-frames-'))
    const cdp = await ctx.newCDPSession(page)
    const shots = []
    cdp.on('Page.screencastFrame', async (f) => {
      shots.push({ data: f.data, t: f.metadata.timestamp })
      await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined)
    })
    const c = await center(page)
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
    await enterAt(page, c.x, c.y + 30, [PNG])
    await sleep(500)
    const p = await optionPoint(page, 'to-jpg')
    for (let i = 1; i <= 10; i++) {
      await overAt(page, c.x + ((p.x - c.x) * i) / 10, c.y + 30 + ((p.y - c.y - 30) * i) / 10, [PNG])
      await sleep(45)
    }
    await sleep(500)
    await dropAt(page, p.x, p.y, [PNG])
    await sleep(900)
    for (const v of [0.3, 0.6, 0.9]) {
      await emit(page, { type: 'progress', progress: v })
      await sleep(400)
    }
    await emit(page, { type: 'done', outputPaths: ['/Users/demo/Desktop/holiday-photo.jpg'] })
    await sleep(1800)
    await cdp.send('Page.stopScreencast')
    await ctx.close()
    // Re-time frames at a constant 20 fps using their timestamps.
    if (shots.length < 5) {
      console.warn('too few screencast frames; skipping GIF')
      rmSync(frames, { recursive: true, force: true })
      return
    }
    const t0 = shots[0].t
    const fps = 20
    const total = Math.floor((shots[shots.length - 1].t - t0) * fps)
    let j = 0
    for (let k = 0; k <= total; k++) {
      const t = t0 + k / fps
      while (j + 1 < shots.length && shots[j + 1].t <= t) j++
      writeFileSync(join(frames, `f${String(k).padStart(4, '0')}.png`), Buffer.from(shots[j].data, 'base64'))
    }
    const gif = resolve(process.env.LUD_GIF_PATH ?? join(repoRoot, 'docs/art/uncle-eat-chew-spit.gif'))
    mkdirSync(dirname(gif), { recursive: true })
    const r = spawnSync(
      ffmpeg,
      [
        '-y',
        '-loglevel',
        'error',
        '-framerate',
        String(fps),
        '-i',
        join(frames, 'f%04d.png'),
        '-vf',
        'scale=360:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
        '-loop',
        '0',
        gif
      ],
      { shell: false, stdio: 'inherit' }
    )
    rmSync(frames, { recursive: true, force: true })
    if (r.status === 0) written.push(gif)
    else console.warn('ffmpeg failed to write the GIF')
  }
}

let failed = 0
try {
  for (const [name, run] of Object.entries(scenarios)) {
    if (filters.length && !filters.some((f) => name.includes(f))) continue
    try {
      await run()
      console.log(`ok   ${name}`)
    } catch (e) {
      failed++
      console.error(`FAIL ${name}: ${e instanceof Error ? e.message : e}`)
    }
  }
} finally {
  await browser.close()
  await server.close()
}
console.log(`\n${written.length} files written to ${outDir}${failed ? `, ${failed} scenario(s) failed` : ''}`)
process.exitCode = failed ? 1 : 0
