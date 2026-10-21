// Smoke check of the renderer side of the E2E hooks and QA attributes in the visual harness
// (plain Chromium + mocked window.lud). Not shipped; complements tests/e2e (QA) which run in Electron.
//
//   node src/renderer/dev/verify-hooks.mjs
//
// Checks: dropFilesOnFeed (onTestFeedDrop) with/without an option, cancelActive (onTestCancel),
// the "Spit it out" button and Esc during chew (one cancelJob each, spit-back state, leave),
// and data-uncle-mood = hamster|struggle|none.
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

async function open(params) {
  const ctx = await browser.newContext({ viewport: { width: 600, height: 600 } })
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
} finally {
  await browser.close()
  await server.close()
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exitCode = failures ? 1 : 0
