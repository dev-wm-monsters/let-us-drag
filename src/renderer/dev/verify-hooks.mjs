// Smoke check of the renderer side of the E2E hooks and QA attributes in the visual harness
// (plain Chromium + mocked window.lud). Not shipped; complements tests/e2e (QA) which run in Electron.
//
//   node src/renderer/dev/verify-hooks.mjs
//
// Checks: dropFilesOnFeed (onTestFeedDrop) with/without an option, cancelActive (onTestCancel),
// the "Spit it out" button and Esc during chew (one cancelJob each, spit-back state, leave),
// data-uncle-mood = hamster|struggle|none, and (phase 4) at the real 560x560 overlay size:
// D20 click-through toggling (QA3-06/07), D21 arm over a result card (QA3-11), the chew stage
// caption (QA3-02), option hints inside the window and off other bubbles (QA3-03), long error
// cards inside the window (QA3-04).
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { serverUrl, startRendererServer } from './vite-dev.mjs'

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

const TIMING_RESULT_MS = 2500
const server = await startRendererServer({ port: 0 })
const browser = await chromium.launch({ executablePath: findChromium() })
const base = `${serverUrl(server)}/dev/harness.html`
let failures = 0

function check(name, ok, detail = '') {
  if (ok) console.log(`ok   ${name}`)
  else {
    failures++
    console.error(`FAIL ${name} ${detail}`)
  }
}

async function open(params, size = 600) {
  const ctx = await browser.newContext({ viewport: { width: size, height: size } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${base}?${new URLSearchParams(params)}`)
  await page.waitForFunction(() => !!window.__harness && !!document.querySelector('[data-uncle-state]'))
  return { page, ctx, errors }
}

const state = (page) => page.evaluate(() => window.__harness.state())
const mood = (page) => page.evaluate(() => document.querySelector('[data-uncle-state]').getAttribute('data-uncle-mood'))
const waitState = (page, s, timeout = 3000) =>
  page.waitForFunction((s) => window.__harness.state() === s, s, { timeout }).then(
    () => true,
    () => false
  )
const cancelCalls = (page) => page.evaluate(() => window.__harness.calls.filter((c) => c.name === 'cancelJob').length)
const progress = (page) =>
  page.evaluate(() => window.__harness.emitJobEvent({ type: 'progress', jobId: window.__harness.lastJobId(), progress: 0.4 }))

try {
  // Feed: dropFilesOnFeed with an option → eat → chew; cancelActive → cancel → idle.
  {
    const { page, ctx, errors } = await open({ view: 'feed' })
    await page.evaluate(() => window.__harness.testFeedDrop({ paths: ['/tmp/a.png'], optionId: 'to-jpg' }))
    check('feed drop on option eats', await waitState(page, 'eat', 1500))
    check('feed drop starts the job', (await page.evaluate(() => window.__harness.jobs.length)) === 1)
    check('feed chews', await waitState(page, 'chew'))
    check('cancel button visible while chewing', (await page.locator('[data-testid="cancel-job"]').count()) === 1)
    await page.evaluate(() => window.__harness.testCancel())
    check('cancelActive → spit-back', (await state(page)) === 'cancel')
    check('speech says "Fine, keep it."', (await page.locator('[data-testid="speech-bubble"]').textContent()) === 'Fine, keep it.')
    await page.waitForTimeout(50)
    check('cancelActive → exactly one cancelJob', (await cancelCalls(page)) === 1)
    check('cancel → back to idle', await waitState(page, 'idle', 4000))
    // Overlay-only channel must not drive the feed (and vice versa below).
    await page.evaluate(() => window.__harness.testFeedDrop({ paths: ['/tmp/notes.md'], optionId: null }))
    check('feed drop without option → feedMe with held files', await waitState(page, 'feedMe'))
    check('held files shown', (await page.locator('[data-testid="held-files"]').count()) === 1)
    check('no page errors (feed)', errors.length === 0, errors.join('\n'))
    await ctx.close()
  }
  // Overlay: ignores feed drops; button click and Esc cancel; data-uncle-mood.
  {
    const { page, ctx, errors } = await open({ view: 'overlay' })
    await page.evaluate(() => window.__harness.testFeedDrop({ paths: ['/tmp/a.png'], optionId: 'to-jpg' }))
    await page.waitForTimeout(200)
    check('overlay ignores feed drops', (await state(page)) === 'hidden')
    check('data-uncle-mood none at rest', (await mood(page)) === 'none')
    await page.evaluate(() =>
      window.__harness.testDrop({ paths: ['/tmp/a.png', '/tmp/b.png', '/tmp/c.png'], optionId: 'to-pdf' })
    )
    check('overlay test drop eats', await waitState(page, 'eat', 1500))
    check('data-uncle-mood hamster', (await mood(page)) === 'hamster')
    await waitState(page, 'chew')
    await progress(page)
    await page.locator('[data-testid="cancel-job"]').click()
    check('button → spit-back', (await state(page)) === 'cancel')
    await page.waitForTimeout(50)
    check('button → exactly one cancelJob', (await cancelCalls(page)) === 1)
    check('overlay leaves to hidden', await waitState(page, 'hidden', 4000))
    check('overlayDone sent', (await page.evaluate(() => window.__harness.calls.some((c) => c.name === 'overlayDone'))) === true)

    await page.evaluate(() => window.__harness.testDrop({ paths: ['/tmp/huge-film.mov'], optionId: 'to-mp4' }))
    await waitState(page, 'chew')
    check('data-uncle-mood struggle', (await mood(page)) === 'struggle')
    await page.evaluate(() => window.__harness.key('Escape'))
    check('Esc while chewing → spit-back', (await state(page)) === 'cancel')
    await page.waitForTimeout(50)
    check('Esc → one more cancelJob', (await cancelCalls(page)) === 2)
    check('no page errors (overlay)', errors.length === 0, errors.join('\n'))
    await ctx.close()
  }
  await phase4Checks()
} finally {
  await browser.close()
  await server.close()
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exitCode = failures ? 1 : 0

async function phase4Checks() {
  const SIZE = 560
  const calls = (page, name) => page.evaluate((n) => window.__harness.calls.filter((c) => c.name === n).map((c) => c.args[0]), name)
  const clickThrough = (page) => page.evaluate(() => window.__harness.clickThrough())
  const emit = (page, ev) => page.evaluate((ev) => window.__harness.emitJobEvent({ ...ev, jobId: window.__harness.lastJobId() }), ev)
  const rectOf = (page, sel) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, r: r.right, b: r.bottom }
    }, sel)
  const inside = (r, m = 0) => !!r && r.x >= m && r.y >= m && r.r <= SIZE - m && r.b <= SIZE - m

  // D20 + D21 on the overlay.
  {
    const { page, ctx, errors } = await open({ view: 'overlay' }, SIZE)
    await page.evaluate(() => window.__harness.arm())
    check('D20 not click-through at arm', (await clickThrough(page)) === false)
    await page.evaluate(() => window.__harness.testDrop({ paths: ['/tmp/a.png'], optionId: 'to-jpg' }))
    await waitState(page, 'eat', 1500)
    await page.waitForTimeout(50)
    check('D20 click-through after the drop (eat)', (await clickThrough(page)) === true)
    await waitState(page, 'chew')
    check('D20 still click-through while chewing', (await clickThrough(page)) === true)
    // Download stage caption (QA3-02).
    await emit(page, { type: 'progress', progress: 0.1, stage: 'One-time download of my scissors (179 MB AI model)' })
    await page.waitForTimeout(80)
    const cap = await page.locator('[data-testid="stage-text"]').textContent().catch(() => null)
    check('QA3-02 download stage shown with percentage', cap === 'One-time download of my scissors (179 MB AI model) · 25%', String(cap))
    check('QA3-02 caption inside the window', inside(await rectOf(page, '[data-testid="stage-text"]'), 4))
    // Pointer over the cancel button (forwarded mouse moves on macOS/Windows) → clickable.
    await page.locator('[data-testid="cancel-job"]').hover()
    await page.waitForTimeout(50)
    check('D20 cancel button hover turns click-through off', (await clickThrough(page)) === false)
    await page.mouse.move(5, 5)
    await page.waitForTimeout(50)
    check('D20 leaving the button turns it back on', (await clickThrough(page)) === true)
    // Linux path: main's cursor polling, no DOM pointer events.
    const btn = await rectOf(page, '[data-testid="cancel-job"]')
    await page.evaluate((p) => window.__harness.cursor(p), { x: (btn.x + btn.r) / 2, y: (btn.y + btn.b) / 2 })
    await page.waitForTimeout(50)
    check('D20 cursor over the button (main polling) turns click-through off', (await clickThrough(page)) === false)
    await page.evaluate(() => window.__harness.cursor({ x: 3, y: 3 }))
    await page.waitForTimeout(50)
    check('D20 cursor away (main polling) turns it back on', (await clickThrough(page)) === true)
    await emit(page, { type: 'done', outputPaths: ['/tmp/a.jpg'] })
    await waitState(page, 'spit')
    await page.waitForTimeout(80)
    check('D20 click-through in spit', (await clickThrough(page)) === true)
    check('QA3-07 no setOverlayInteractive(true) for the result card', !(await calls(page, 'setOverlayInteractive')).includes(true))
    const card = page.locator('[data-testid="output-card"]')
    await card.hover()
    await page.waitForTimeout(50)
    check('D20 card hover turns click-through off', (await clickThrough(page)) === false)
    await card.click()
    check('card click reveals without focus', (await calls(page, 'revealPath')).includes('/tmp/a.jpg'))
    // D21: a new gesture while the card is shown drops it at once and starts over.
    await page.evaluate(() => window.__harness.arm())
    await page.waitForTimeout(50)
    check('D21 arm during spit → card dropped', (await state(page)) === 'hidden' && (await page.locator('[data-testid="output-card"]').count()) === 0)
    check('D21 arm → not click-through', (await clickThrough(page)) === false)
    const before = (await calls(page, 'overlayDone')).length
    await page.waitForTimeout(TIMING_RESULT_MS + 600)
    check('D21 old card timers do not hide the new sensor', (await calls(page, 'overlayDone')).length === before)
    await page.evaluate(() => window.__harness.testDrop({ paths: ['/tmp/b.png'], optionId: 'to-webp' }))
    check('D21 the new gesture eats', await waitState(page, 'eat', 1500))
    await waitState(page, 'chew')
    await emit(page, { type: 'error', error: { code: 'INPUT_INVALID', message: 'Blegh!' } })
    await waitState(page, 'choke')
    await page.waitForTimeout(80)
    check('D20 click-through in choke', (await clickThrough(page)) === true)
    check('QA3-07 still no setOverlayInteractive(true)', !(await calls(page, 'setOverlayInteractive')).includes(true))
    await page.evaluate(() => window.__harness.arm())
    await page.waitForTimeout(50)
    check('D21 arm during choke → card dropped', (await state(page)) === 'hidden')
    check('no page errors (phase 4 overlay)', errors.length === 0, errors.join('\n'))
    await ctx.close()
  }

  // QA3-04: error cards with 140- and 200-char messages stay inside the window, text not clipped.
  for (const n of [140, 200]) {
    const { page, ctx } = await open({ view: 'overlay' }, SIZE)
    const words = 'quarterly-results-final copy.png is larger than I can chew for this kind of file, try a smaller one please. '
    const msg = words.repeat(4).slice(0, n - 1).trimEnd() + '.'
    await page.evaluate(() => window.__harness.testDrop({ paths: ['/tmp/a.png'], optionId: 'to-jpg' }))
    await waitState(page, 'chew')
    await emit(page, { type: 'error', error: { code: 'INPUT_INVALID', message: msg } })
    await waitState(page, 'choke')
    await page.waitForTimeout(800)
    const r = await rectOf(page, '[data-testid="error-message"]')
    check(`QA3-04 ${n}-char error card inside the window`, inside(r, 2), JSON.stringify(r))
    const text = await page.locator('[data-testid="error-message"] .lud-card-message').evaluate((el) => ({
      text: el.textContent,
      clipped: el.scrollHeight > el.clientHeight + 1,
      fontSize: parseFloat(getComputedStyle(el).fontSize)
    }))
    check(`QA3-04 ${n}-char message shown in full`, text.text === msg && !text.clipped, JSON.stringify(text))
    check(`QA3-04 readable font size`, text.fontSize >= 12)
    await ctx.close()
  }

  // QA3-03: every option hint inside the window and off the other bubbles (all five categories).
  const FILES = [
    { name: 'holiday-photo.png', type: 'image/png' },
    { name: 'birthday.mp4', type: 'video/mp4' },
    { name: 'voice-memo.wav', type: 'audio/wav' },
    { name: 'contract.pdf', type: 'application/pdf' },
    { name: 'people.csv', type: 'text/csv' }
  ]
  for (const plain of ['0', '1']) {
    for (const file of FILES) {
      const { page, ctx } = await open({ view: 'overlay', plain }, SIZE)
      const c = await page.evaluate(() => window.__harness.center())
      await page.evaluate(([x, y, f]) => {
        window.__harness.drag('dragenter', x, y, [f])
        window.__harness.drag('dragover', x, y, [f])
      }, [c.x, c.y + 40, file])
      await page.waitForTimeout(500)
      const ids = await page.$$eval('[data-option-id]', (els) => els.map((e) => e.getAttribute('data-option-id')))
      for (const id of ids) {
        const p = await page.evaluate((id) => window.__harness.optionPoint(id), id)
        await page.evaluate(([x, y, f]) => window.__harness.drag('dragover', x, y, [f]), [p.x, p.y, file])
        await page.waitForTimeout(60)
        const res = await page.evaluate((id) => {
          const hint = document.querySelector('[data-testid="hover-hint"]')
          if (!hint) return null
          const h = hint.getBoundingClientRect()
          const hits = []
          for (const b of document.querySelectorAll('[data-option-id] .lud-option-bubble')) {
            const btn = b.closest('[data-option-id]')
            if (!btn || btn.getAttribute('data-option-id') === id) continue
            const r = b.getBoundingClientRect()
            const cx = (r.left + r.right) / 2
            const cy = (r.top + r.bottom) / 2
            const rad = r.width / 2
            const nx = Math.max(h.left, Math.min(cx, h.right))
            const ny = Math.max(h.top, Math.min(cy, h.bottom))
            if (Math.hypot(cx - nx, cy - ny) < rad) hits.push(btn.getAttribute('data-option-id'))
          }
          return { r: { x: h.left, y: h.top, r: h.right, b: h.bottom }, hits, text: hint.textContent }
        }, id)
        const where = `${file.name}${plain === '1' ? ' (plain)' : ''} ${id}`
        check(`QA3-03 hint ${where} inside the window`, !!res && inside(res.r, 2), JSON.stringify(res))
        check(`QA3-03 hint ${where} covers no other bubble`, !!res && res.hits.length === 0, JSON.stringify(res))
      }
      await ctx.close()
    }
  }
}
