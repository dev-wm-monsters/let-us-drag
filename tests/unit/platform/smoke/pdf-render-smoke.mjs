// Platform smoke test for the Chromium PDF adapters against the BUILT app and the REAL engine
// (not part of `npm test`; QA owns the E2E). Usage (Linux):
//   npm run build && LUD_FFMPEG_PATH=/usr/bin/ffmpeg xvfb-run -a node tests/unit/platform/smoke/pdf-render-smoke.mjs
// Checks:
//   renderPdfPages (P1): PDF → PNG pages (count, PNG magic, size at scale 2), a huge page is
//   scaled down to the caps, a PDF with a JavaScript OpenAction / URI link causes no request,
//   a corrupt PDF fails cleanly and the next job still works, the helper window is hardened.
//   htmlToPdf (SEC-82): remote <img>, <iframe src=file://>, <script> and meta refresh in the HTML
//   have no effect (no beacon hit, no file content, no script effect).
import { _electron as electron } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { hostname, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')
const work = await mkdtemp(join(tmpdir(), 'lud-pdf-smoke-'))

// Beacon server: any hit is a failure.
const hits = []
const server = createServer((req, res) => {
  hits.push(req.url)
  res.end('x')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const beacon = `http://127.0.0.1:${port}`

async function makePdf(path, pages, size = [300, 200], extra) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica) // standard font: needs pdf.js standard_fonts data
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage(size)
    page.drawText(`Hello page ${i}`, { x: 30, y: size[1] / 2, size: 18, font, color: rgb(0, 0, 0) })
  }
  if (extra) extra(doc)
  await writeFile(path, await doc.save())
  return path
}

const plain = await makePdf(join(work, 'plain.pdf'), 3)
const huge = await makePdf(join(work, 'huge.pdf'), 1, [14_400, 14_400])
const hostile = await makePdf(join(work, 'hostile.pdf'), 1, [300, 200], (doc) => {
  // OpenAction with JavaScript that would hit the beacon, plus a URI link annotation.
  const js = doc.context.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of(`app.launchURL("${beacon}/js", true); this.submitForm("${beacon}/form");`) })
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.register(js))
  const page = doc.getPage(0)
  const uri = doc.context.obj({ Type: 'Action', S: 'URI', URI: PDFString.of(`${beacon}/uri`) })
  const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 300, 200], Border: [0, 0, 0], A: uri })
  page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]))
})
const corrupt = join(work, 'corrupt.pdf')
await writeFile(corrupt, '%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF garbage')
const html = join(work, 'evil.html')
await writeFile(
  html,
  `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=${beacon}/refresh"><title>t</title></head><body>
<h1>Printed body</h1>
<img src="${beacon}/img.png">
<iframe src="file:///etc/hostname"></iframe>
<link rel="stylesheet" href="${beacon}/style.css">
<script>document.body.innerHTML = 'SCRIPT RAN'; fetch('${beacon}/script')</script>
</body></html>`
)

/** Multi-page outputs are written into a new folder "name (pages)/" (PLAN §3.7). */
async function pageFiles(outputPaths) {
  const files = []
  for (const p of outputPaths) {
    if ((await stat(p)).isDirectory()) for (const f of (await readdir(p)).sort()) files.push(join(p, f))
    else files.push(p)
  }
  return files
}

function pngSize(buf) {
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG magic')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

const stderr = []
const app = await electron.launch({
  args: [repo, '--no-sandbox', '--disable-gpu', `--user-data-dir=${join(work, 'userData')}`],
  cwd: repo,
  env: { ...process.env, LUD_E2E: '1', LUD_DEBUG: '1' }
})
app.process().stderr?.on('data', (d) => stderr.push(String(d)))
const step = (name) => process.stdout.write(`- ${name}\n`)
const waitFor = async (fn, what, ms = 60_000) => {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

try {
  await waitFor(() => app.evaluate(() => typeof globalThis.__ludTest === 'object'), '__ludTest')
  await app.evaluate(() => globalThis.__ludTest.openFeedWindow())
  const feed = await waitFor(async () => app.windows().find((p) => p.url().includes('/feed/')), 'feed page')
  await feed.waitForLoadState('domcontentloaded')

  let n = 0
  const runJob = async (optionId, inputPaths) => {
    const id = `pdf-smoke-${++n}`
    await feed.evaluate((req) => window.lud.startJob(req), { id, optionId, inputPaths })
    return waitFor(
      () => app.evaluate((_e, jobId) => globalThis.__ludTest.jobEvents().find((e) => e.jobId === jobId && (e.type === 'done' || e.type === 'error')), id),
      `job ${id}`,
      120_000
    )
  }

  const t0 = Date.now()
  const ev1 = await runJob('pdf-to-png', [plain])
  assert.equal(ev1.type, 'done', JSON.stringify(ev1))
  const pages1 = await pageFiles(ev1.outputPaths)
  console.log('  outputs:', JSON.stringify(ev1.outputPaths), pages1.length, 'files')
  assert.equal(pages1.length, 3)
  for (const p of pages1) {
    const buf = await readFile(p)
    assert.deepEqual(pngSize(buf), { width: 600, height: 400 })
    // White background, and the (non-embedded Helvetica) text was drawn: dark pixels exist.
    const { channels } = await sharp(buf).stats()
    assert.equal(channels[0].max, 255)
    assert.ok(channels[0].min < 80, `text drawn on ${p} (min ${channels[0].min})`)
  }
  step(`pdf-to-png: 3 pages, 600x400 PNGs at scale 2 (${Date.now() - t0} ms)`)

  // While the helper window exists: it is hardened and has no preload.
  const helper = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => w.webContents.getURL().startsWith('lud-sandbox://'))
      .map((w) => {
        const p = w.webContents.getLastWebPreferences()
        return { url: w.webContents.getURL(), visible: w.isVisible(), sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, preload: p.preload ?? null }
      })
  )
  console.log('  helper windows:', JSON.stringify(helper))
  assert.equal(helper.length, 1)
  assert.deepEqual(helper[0], { url: 'lud-sandbox://pdf/index.html', visible: false, sandbox: true, contextIsolation: true, nodeIntegration: false, preload: null })
  step('render window: hidden, sandboxed, isolated, no preload')

  const ev2 = await runJob('pdf-to-png', [huge])
  assert.equal(ev2.type, 'done', JSON.stringify(ev2))
  const hugeSize = pngSize(await readFile((await pageFiles(ev2.outputPaths))[0]))
  assert.ok(hugeSize.width <= 16_384 && hugeSize.height <= 16_384 && hugeSize.width * hugeSize.height <= 50_000_000, JSON.stringify(hugeSize))
  assert.ok(hugeSize.width > 6_000, 'scaled down to the cap, not to nothing')
  step(`huge 14400pt page rendered within the caps (${hugeSize.width}x${hugeSize.height})`)

  const ev2b = await runJob('pdf-to-jpg', [plain])
  assert.equal(ev2b.type, 'done', JSON.stringify(ev2b))
  const jpg = await readFile((await pageFiles(ev2b.outputPaths))[0])
  assert.equal(jpg.subarray(0, 2).toString('hex'), 'ffd8')
  step('pdf-to-jpg works through the same adapter')

  const ev3 = await runJob('pdf-to-png', [hostile])
  assert.equal(ev3.type, 'done', JSON.stringify(ev3))
  step('PDF with JavaScript OpenAction + URI link rendered')

  const ev4 = await runJob('pdf-to-png', [corrupt])
  assert.equal(ev4.type, 'error')
  console.log('  corrupt PDF error:', JSON.stringify(ev4.error))
  const ev5 = await runJob('pdf-to-png', [plain])
  assert.equal(ev5.type, 'done', 'the next PDF job works after a failure')
  step('corrupt PDF fails cleanly; the next job works')

  const ev6 = await runJob('to-pdf', [html])
  assert.equal(ev6.type, 'done', JSON.stringify(ev6))
  const ev7 = await runJob('to-txt', [ev6.outputPaths[0]])
  assert.equal(ev7.type, 'done', JSON.stringify(ev7))
  const text = await readFile(ev7.outputPaths[0], 'utf8')
  console.log('  printed text:', JSON.stringify(text.slice(0, 200)))
  assert.match(text, /Printed body/)
  assert.doesNotMatch(text, /SCRIPT RAN/)
  const host = hostname().trim()
  if (host.length >= 4) assert.ok(!text.includes(host), 'file:///etc/hostname must not be embedded')
  step('htmlToPdf: script did not run, local file not embedded')

  await new Promise((r) => setTimeout(r, 1_000))
  assert.deepEqual(hits, [], 'no request may reach the beacon server')
  step('no request reached the beacon server')

  const log = stderr.join('').split('\n').filter((l) => l.startsWith('[lud]'))
  console.log('  app log:\n    ' + log.join('\n    '))
  console.log('\nPDF SMOKE OK')
} catch (err) {
  console.error('\nPDF SMOKE FAILED:', err)
  console.error('--- app stderr ---\n' + stderr.join(''))
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
  server.close()
  await rm(work, { recursive: true, force: true })
}
