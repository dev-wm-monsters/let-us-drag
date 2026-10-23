// Visual QA: drives the real renderer UI (mocked window.lud) in plain Chromium via Playwright and
// saves screenshots of every Uncle state to docs/art/screens/, plus an eat→chew→spit GIF.
//
//   node src/renderer/dev/capture.mjs                # all scenarios + GIF
//   node src/renderer/dev/capture.mjs hover feed     # only scenarios whose name contains a filter
//   LUD_SCREENS_DIR=/tmp/x node src/renderer/dev/capture.mjs   # screenshots AND GIFs go to /tmp/x
//
// GIF paths: LUD_HERO_PATH / LUD_GIF_PATH when set, else next to the screenshots when LUD_SCREENS_DIR
// is set (docs/art is never touched then, QA3-12), else docs/art/hero.gif + uncle-eat-chew-spit.gif.
//
// Chromium: LUD_CHROMIUM_PATH, else the newest chromium-*/chrome-linux/chrome under
// PLAYWRIGHT_BROWSERS_PATH, else Playwright's default. GIF needs ffmpeg (LUD_FFMPEG_PATH or PATH).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { CHARACTERS } from '../../shared/characters.ts'
import { artOutputPaths } from './art-paths.mjs'
import { repoRoot, serverUrl, startRendererServer } from './vite-dev.mjs'

const { outDir, heroGif, loopGif } = artOutputPaths(process.env, repoRoot)
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
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`)
  })
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${m.text()} [${m.location().url}]`)
  })
  await page.goto(`${base}?${new URLSearchParams(params)}`)
  await page.waitForFunction(() => !!window.__harness && !!document.querySelector('[data-uncle-state], [data-testid="settings-root"]'))
  await sleep(300)
  return { page, ctx, errors }
}

/** Screenshot → palette PNG (keeps docs/art small; visually lossless for flat cartoon art). */
async function save(buf, name) {
  const file = join(outDir, `${name}.png`)
  await sharp(buf).png({ palette: true, quality: 92, effort: 8 }).toFile(file)
  written.push(file)
}
async function shot(page, name) {
  await save(await page.screenshot(), name)
}

/** Contact sheet: one labelled column per character, one row per pose (tiles = saved screenshots). */
async function contactSheet(name, ids, poses, tile = 220) {
  const label = (text, w, h) =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="${w / 2}" y="${h - 9}" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="15" fill="#2b1a14">${text}</text></svg>`
    )
  const head = 28
  const side = 70
  const parts = []
  for (const [col, id] of ids.entries()) {
    parts.push({ input: label(id, tile, head), left: side + col * tile, top: 0 })
    for (const [row, pose] of poses.entries()) {
      const input = await sharp(join(outDir, `character-${id}-${pose}.png`)).resize(tile, tile).toBuffer()
      parts.push({ input, left: side + col * tile, top: head + row * tile })
    }
  }
  for (const [row, pose] of poses.entries()) parts.push({ input: label(pose, side, tile / 2 + 8), left: 0, top: head + row * tile })
  const file = join(outDir, `${name}.png`)
  await sharp({ create: { width: side + ids.length * tile, height: head + poses.length * tile, channels: 3, background: '#fbf3e6' } })
    .composite(parts)
    .png()
    .toFile(file)
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
    await page.waitForFunction(() => window.__harness.state() === 'leave', null, { polling: 'raf', timeout: 5000 })
    await sleep(110)
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
    await emit(page, { type: 'progress', progress: -1, stage: 'Chewing' })
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
  async 'overlay-21-download'() {
    // D15/QA3-02: first Remove BG: the one-time model download is named, with its percentage.
    const { page, ctx } = await open({ view: 'overlay' })
    const c = await center(page)
    await enterAt(page, c.x, c.y, [PNG])
    await sleep(450)
    const p = await optionPoint(page, 'remove-bg')
    await dropAt(page, p.x, p.y, [PNG])
    await sleep(1200)
    await emit(page, { type: 'progress', progress: 0.4 * 0.42, stage: 'One-time download of my scissors (179 MB AI model)' })
    await sleep(400)
    await expectState(page, 'chew')
    await shot(page, 'overlay-21-download')
    await ctx.close()
  },
  async 'overlay-22-choke-long'() {
    // QA3-04: the longest engine message (200 chars) wraps and the card stays inside the window.
    const { page, ctx } = await open({ view: 'overlay' }, { width: 560, height: 560 })
    const c = await center(page)
    await enterAt(page, c.x, c.y, [PNG])
    await sleep(450)
    const p = await optionPoint(page, 'to-jpg')
    await dropAt(page, p.x, p.y, [PNG])
    await sleep(1300)
    const message =
      'quarterly-results-final-v7 (approved by finance) copy.png is larger than 1 GB, which is more than I can chew for this kind of file. Nothing was saved next to the original, so try a smaller one?'
    await emit(page, { type: 'error', error: { code: 'INPUT_INVALID', message } })
    await sleep(800)
    await expectState(page, 'choke')
    await shot(page, 'overlay-22-choke-long')
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
  async 'overlay-18-cancel'() {
    // D3: "Spit it out" on the progress ring while chewing → spit-back + "Fine, keep it." → leave.
    const { page, ctx } = await open({ view: 'overlay' })
    const c = await center(page)
    await enterAt(page, c.x, c.y, [MP4])
    await sleep(450)
    const p = await optionPoint(page, 'to-gif')
    await dropAt(page, p.x, p.y, [MP4])
    await sleep(900)
    await emit(page, { type: 'progress', progress: 0.35 })
    await sleep(400)
    await expectState(page, 'chew')
    const btn = page.locator('[data-testid="cancel-job"]')
    await btn.hover()
    await sleep(350)
    await shot(page, 'overlay-18-cancel-button')
    await btn.click()
    // Grab raw frames first (palette encoding is slow and would eat into the 1.4 s spit-back).
    await sleep(240)
    await expectState(page, 'cancel')
    const spit = await page.screenshot()
    await sleep(420)
    await expectState(page, 'cancel')
    const fine = await page.screenshot()
    await save(spit, 'overlay-19-cancel-spit-back')
    await save(fine, 'overlay-20-cancel-fine-keep-it')
    const cancelled = await H(page, () => window.__harness.calls.filter((c) => c.name === 'cancelJob').length)
    if (cancelled !== 1) throw new Error(`expected 1 cancelJob call, got ${cancelled}`)
    await page.waitForFunction(() => window.__harness.state() === 'hidden', null, { timeout: 4000 })
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
  async characters() {
    // Every character in the overlay: appear (mouth closed, looking at the cursor), eat (mouth open),
    // chew (mid-chew frame, progress ring + cancel button), spit (output card).
    const ids = CHARACTERS.map((c) => c.id)
    for (const id of ids) {
      const { page, ctx, errors } = await open({ view: 'overlay', character: id })
      const c = await center(page)
      await enterAt(page, c.x + 120, c.y - 150, [PNG])
      await sleep(650)
      await expectState(page, 'appear')
      const got = await page.getAttribute('[data-testid="overlay-root"]', 'data-character')
      if (got !== id) throw new Error(`data-character=${got}, expected ${id}`)
      await shot(page, `character-${id}-appear`)
      const p = await optionPoint(page, 'to-jpg')
      await overAt(page, p.x, p.y, [PNG])
      await sleep(200)
      await dropAt(page, p.x, p.y, [PNG])
      await sleep(260)
      await expectState(page, 'eat')
      await shot(page, `character-${id}-eat`)
      await sleep(650)
      await emit(page, { type: 'progress', progress: 0.45 })
      await sleep(400)
      await expectState(page, 'chew')
      await shot(page, `character-${id}-chew`)
      await emit(page, { type: 'done', outputPaths: ['/Users/demo/Desktop/holiday-photo.jpg'] })
      await sleep(800)
      await expectState(page, 'spit')
      await shot(page, `character-${id}-spit`)
      const real = errors.filter((e) => !e.includes('favicon.ico'))
      if (real.length) throw new Error(`${id}: page errors: ${real.join(' | ')}`)
      await ctx.close()
    }
    await contactSheet('characters-sheet', ids, ['appear', 'eat'])
    await contactSheet('characters-sheet-chew-spit', ids, ['chew', 'spit'])
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
      await save(await page.screenshot({ fullPage: true }), name)
      await ctx.close()
    }
  },
  async 'hero'() {
    // README hero: drag → appear → head follows the file → eat → chew → spit (~5–6 s, flat bg, ≤ 480 px).
    const ffmpeg = process.env.LUD_FFMPEG_PATH ?? 'ffmpeg'
    if (spawnSync(ffmpeg, ['-version'], { shell: false }).status !== 0) {
      console.warn('ffmpeg not found; skipping hero GIF')
      return
    }
    const { page, ctx } = await open({ view: 'overlay', jobs: 'manual', bg: 'flat' }, { width: 540, height: 540 })
    await installFakeCursor(page, 'PNG')
    const c = await center(page)
    const jpg = await (async () => {
      await enterAt(page, -50, -50, [PNG]) // probe the layout once (off-screen), then reset
      await sleep(600) // let the bubbles finish fanning out
      const p = await optionPoint(page, 'to-jpg')
      await H(page, () => window.__harness.key('Escape'))
      await page.waitForFunction(() => window.__harness.state() === 'hidden', null, { timeout: 3000 })
      return p
    })()
    const { cdp, shots } = await screencast(ctx, page)
    await moveFake(page, 40, 500)
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
    await sleep(60)
    let at = await glide(page, { x: 40, y: 500 }, { x: c.x - 60, y: c.y + 110 }, 330, null)
    await enterAt(page, at.x, at.y, [PNG])
    // Between the bubbles: he follows the file left, up, right…
    at = await glide(page, at, { x: c.x - 250, y: c.y - 10 }, 480, [PNG])
    at = await glide(page, at, { x: c.x - 40, y: c.y - 255 }, 450, [PNG])
    at = await glide(page, at, { x: c.x + 250, y: c.y + 20 }, 480, [PNG])
    at = await glide(page, at, jpg, 380, [PNG]) // …and turns his whole face to JPG
    await sleep(450)
    await expectState(page, 'hover')
    await dropAt(page, jpg.x, jpg.y, [PNG])
    await moveFake(page, jpg.x, jpg.y, false)
    await sleep(650)
    for (const v of [0.35, 0.7, 0.95]) {
      await emit(page, { type: 'progress', progress: v })
      await sleep(300)
    }
    await emit(page, { type: 'done', outputPaths: ['/Users/demo/Desktop/holiday-photo.jpg'] })
    await glide(page, jpg, { x: c.x + 170, y: c.y + 215 }, 450, null, false)
    await sleep(950)
    await expectState(page, 'spit')
    await cdp.send('Page.stopScreencast')
    await ctx.close()
    encodeGif(ffmpeg, shots, {
      fps: 15,
      width: 400,
      colors: 96,
      out: heroGif
    })
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
    const { cdp, shots } = await screencast(ctx, page)
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
    encodeGif(ffmpeg, shots, {
      fps: 20,
      width: 360,
      colors: 96,
      out: loopGif
    })
  }
}

async function screencast(ctx, page) {
  const cdp = await ctx.newCDPSession(page)
  const shots = []
  cdp.on('Page.screencastFrame', async (f) => {
    shots.push({ data: f.data, t: f.metadata.timestamp })
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined)
  })
  return { cdp, shots }
}

/** Re-time screencast frames at a constant fps (by timestamp) and encode a looping GIF with ffmpeg. */
function encodeGif(ffmpeg, shots, { fps, width, colors, out }) {
  if (shots.length < 5) {
    console.warn('too few screencast frames; skipping GIF')
    return
  }
  const frames = mkdtempSync(join(tmpdir(), 'lud-frames-'))
  const t0 = shots[0].t
  const total = Math.floor((shots[shots.length - 1].t - t0) * fps)
  let j = 0
  for (let k = 0; k <= total; k++) {
    const t = t0 + k / fps
    while (j + 1 < shots.length && shots[j + 1].t <= t) j++
    writeFileSync(join(frames, `f${String(k).padStart(4, '0')}.png`), Buffer.from(shots[j].data, 'base64'))
  }
  mkdirSync(dirname(out), { recursive: true })
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
      `scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      '-loop',
      '0',
      out
    ],
    { shell: false, stdio: 'inherit' }
  )
  rmSync(frames, { recursive: true, force: true })
  if (r.status === 0) written.push(out)
  else console.warn('ffmpeg failed to write the GIF')
}

/** A fake OS drag image (arrow cursor + file card) for the README GIF; pointer-events: none. */
async function installFakeCursor(page, ext) {
  await page.evaluate((ext) => {
    const el = document.createElement('div')
    el.id = 'fake-drag'
    el.style.cssText =
      'position:fixed;left:0;top:0;z-index:9999;pointer-events:none;will-change:transform;transform:translate(-100px,-100px)'
    el.innerHTML = `
      <div class="fd-file" style="position:absolute;left:10px;top:14px;width:34px;height:42px;background:#fff;border:3px solid #2b1a14;border-radius:3px 11px 3px 3px;box-shadow:2px 3px 0 #2b1a14;display:grid;place-items:end center;padding-bottom:5px;transform:rotate(-8deg);opacity:.95">
        <span style="font:900 9px system-ui,sans-serif;color:#fff;background:#f08a3c;border-radius:3px;padding:1px 3px">${ext}</span>
      </div>
      <svg width="22" height="30" viewBox="0 0 22 30" style="position:absolute;left:-2px;top:-2px"><path d="M2 2 L2 24 L8 18.5 L12.5 28 L16.5 26 L12 16.8 L20 16.4 Z" fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>`
    document.body.appendChild(el)
  }, ext)
}
const moveFake = (page, x, y, withFile = true) =>
  page.evaluate(
    ([x, y, withFile]) => {
      const el = document.getElementById('fake-drag')
      if (!el) return
      el.style.transform = `translate(${x}px, ${y}px)`
      el.querySelector('.fd-file').style.display = withFile ? '' : 'none'
    },
    [x, y, withFile]
  )

/**
 * Move the fake cursor (and the drag, when `files` is given) along a straight line in `ms` of wall
 * time (time-based, so slow evaluate round-trips do not stretch the GIF).
 */
async function glide(page, from, to, ms, files, withFile = true) {
  const t0 = Date.now()
  for (;;) {
    const k = Math.min(1, (Date.now() - t0) / ms)
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2 // ease in-out
    const x = from.x + (to.x - from.x) * e
    const y = from.y + (to.y - from.y) * e
    await moveFake(page, x, y, withFile)
    if (files) await overAt(page, x, y, files)
    if (k >= 1) return to
    await sleep(16)
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
