// QA phase 3b visual check: the REAL overlay renderer (dev harness, mocked window.lud) at the real
// overlay window size (560x560, src/main/windows/overlay-geometry.ts) over a white and a near-black
// desktop, hovering every option (labels + hints), plus feedMe, spit, choke with the longest
// engine message and Plain Mode. Writes PNGs + one contact sheet per background.
//
//   LUD_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node tests/qa/visual-contrast.mjs <outDir>
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { serverUrl, startRendererServer } from '../../src/renderer/dev/vite-dev.mjs'

const outDir = resolve(process.argv[2] ?? 'test-results/qa-visual')
mkdirSync(outDir, { recursive: true })
const SIZE = 560
const BGS = { white: '#ffffff', black: '#111111', mid: '#7f7f7f' }
const FILES = {
  image: { name: 'holiday-photo.png', type: 'image/png' },
  video: { name: 'birthday.mp4', type: 'video/mp4' },
  audio: { name: 'voice-memo.wav', type: 'audio/wav' },
  pdf: { name: 'contract.pdf', type: 'application/pdf' },
  data: { name: 'people.csv', type: 'text/csv' }
}
const LONG_ERR = 'quarterly-results-final-v7 (approved by finance) copy.png is larger than 1 GB, which is more than I can chew for this kind of file. Nothing was saved, try a smaller one?'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const server = await startRendererServer({ port: 0 })
const base = `${serverUrl(server)}/dev/harness.html`
const exe = process.env.LUD_CHROMIUM_PATH
const browser = await chromium.launch(exe && existsSync(exe) ? { executablePath: exe } : {})
const shots = { white: [], black: [], mid: [] }

async function open(bg, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.goto(`${base}?${new URLSearchParams({ view: 'overlay', bg: 'flat', jobs: 'manual', ...extra })}`)
  await page.waitForFunction(() => !!window.__harness && !!document.querySelector('[data-uncle-state]'))
  await page.addStyleTag({ content: `html.harness-flat, html.harness-flat body { background: ${BGS[bg]} !important; }` })
  await sleep(300)
  return { page, ctx }
}
const H = (page, fn, arg) => page.evaluate(fn, arg)
async function shot(page, bg, name) {
  const file = join(outDir, `${bg}-${name}.png`)
  await page.screenshot({ path: file })
  shots[bg].push({ file, name })
}

for (const bg of Object.keys(BGS)) {
  for (const [cat, file] of Object.entries(FILES)) {
    const { page, ctx } = await open(bg)
    const c = await H(page, () => window.__harness.center())
    await H(page, ([x, y, f]) => { window.__harness.drag('dragenter', x, y, [f]); window.__harness.drag('dragover', x, y, [f]) }, [c.x, c.y + 40, file])
    await sleep(600)
    await shot(page, bg, `${cat}-appear`)
    const ids = await page.$$eval('[data-testid^="option-"]', (els) => els.map((e) => e.getAttribute('data-testid').slice('option-'.length)))
    for (const id of ids) {
      const p = await H(page, (id) => window.__harness.optionPoint(id), id)
      await H(page, ([x, y, f]) => window.__harness.drag('dragover', x, y, [f]), [p.x, p.y, file])
      await sleep(450)
      await shot(page, bg, `${cat}-hover-${id}`)
    }
    await ctx.close()
  }
  // feedMe, spit, choke (long message), plain
  {
    const { page, ctx } = await open(bg)
    const c = await H(page, () => window.__harness.center())
    await H(page, ([x, y]) => { window.__harness.drag('dragenter', x, y, [{ name: 'notes.md', type: '' }]); window.__harness.drag('dragover', x, y, [{ name: 'notes.md', type: '' }]) }, [c.x, c.y])
    await sleep(600)
    await shot(page, bg, 'feedme')
    await H(page, ([x, y]) => window.__harness.drag('drop', x, y, [{ name: 'notes.md', type: '' }]), [c.x, c.y])
    await sleep(700)
    await shot(page, bg, 'feedme-held')
    await ctx.close()
  }
  for (const outcome of ['spit', 'choke']) {
    const { page, ctx } = await open(bg)
    const c = await H(page, () => window.__harness.center())
    const f = FILES.image
    await H(page, ([x, y, f]) => { window.__harness.drag('dragenter', x, y, [f]); window.__harness.drag('dragover', x, y, [f]) }, [c.x, c.y, f])
    await sleep(500)
    const p = await H(page, () => window.__harness.optionPoint('to-jpg'))
    await H(page, ([x, y, f]) => { window.__harness.drag('dragover', x, y, [f]); window.__harness.drag('drop', x, y, [f]) }, [p.x, p.y, f])
    await sleep(1200)
    await H(page, ([outcome, msg]) => {
      const id = window.__harness.lastJobId()
      if (outcome === 'spit') window.__harness.emitJobEvent({ type: 'done', jobId: id, outputPaths: ['/Users/me/Desktop/LUD test/a-very-long-file-name-for-the-holiday-photo-2026 (3).jpg'] })
      else window.__harness.emitJobEvent({ type: 'error', jobId: id, error: { code: 'INPUT_INVALID', message: msg } })
    }, [outcome, LONG_ERR])
    await sleep(900)
    await shot(page, bg, `${outcome}-long`)
    await ctx.close()
  }
  {
    const { page, ctx } = await open(bg, { plain: '1' })
    const c = await H(page, () => window.__harness.center())
    await H(page, ([x, y, f]) => { window.__harness.drag('dragenter', x, y, [f]); window.__harness.drag('dragover', x, y, [f]) }, [c.x, c.y, FILES.image])
    await sleep(500)
    const p = await H(page, () => window.__harness.optionPoint('remove-bg'))
    await H(page, ([x, y, f]) => window.__harness.drag('dragover', x, y, [f]), [p.x, p.y, FILES.image])
    await sleep(500)
    await shot(page, bg, 'plain-hover-remove-bg')
    await ctx.close()
  }
}

// Contact sheets (4 columns, 280 px thumbnails).
for (const [bg, list] of Object.entries(shots)) {
  const cols = 4
  const t = 280
  const rows = Math.ceil(list.length / cols)
  const composites = await Promise.all(
    list.map(async (s, i) => ({ input: await sharp(s.file).resize(t, t).toBuffer(), left: (i % cols) * t, top: Math.floor(i / cols) * t }))
  )
  await sharp({ create: { width: cols * t, height: rows * t, channels: 3, background: '#ff00ff' } })
    .composite(composites)
    .png()
    .toFile(join(outDir, `sheet-${bg}.png`))
}
await browser.close()
await server.close?.()
console.log(`wrote ${Object.values(shots).flat().length} screenshots + sheets to ${outDir}`)
process.exit(0)
