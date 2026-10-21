// E2E-DOCS: conversions that need Chromium inside the running app (real host adapters, not the
// engine-test fakes): PDF → PNG/JPG pages through EngineAdapters.renderPdfPages, and
// HTML / Markdown / DOCX → PDF through the htmlToPdf adapter (printToPDF).
// Test plan IDs: E2E-35..E2E-39 (docs/qa/TEST_PLAN.md §15), CONV-PDF-01/02, CONV-DOC-01, CONV-TXT-01/03.
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import sharp from 'sharp'
import { docxFile } from '../helpers/fixtures'
import { expect, test } from './support/app'
import { magic, makePdf, pdfPageCount } from './support/fixtures'
import { convertViaDrop, outputsOf } from './support/flows'
import { expectedOutputPath } from './support/naming'
import { NEEDS_P2 } from './support/p2'
import { pdfPageTexts } from './support/pdf'

/** Assert a "<name> (pages)/" folder next to the input with `pages` decodable images, in order. */
async function expectPagesFolder(outputs: string[], input: string, pages: number, format: 'png' | 'jpeg'): Promise<void> {
  expect(outputs.length, `outputs: ${JSON.stringify(outputs)}`).toBeGreaterThanOrEqual(1)
  // PLAN §3.7: multi-output conversions write into a new folder "name (pages)/".
  const folder = outputs.length === 1 && statSync(outputs[0]!).isDirectory() ? outputs[0]! : dirname(outputs[0]!)
  expect(basename(folder)).toBe(`${basename(input, '.pdf')} (pages)`)
  expect(dirname(folder)).toBe(dirname(input))
  const files = readdirSync(folder).sort()
  expect(files, `files in ${folder}`).toHaveLength(pages)
  for (const f of files) {
    const img = sharp(join(folder, f))
    const meta = await img.metadata()
    expect(meta.format, f).toBe(format)
    // makePdf pages are 300×200 pt; the engine renders at scale 2 → about 600×400 px.
    expect(meta.width, f).toBeGreaterThanOrEqual(300)
    expect(Math.abs(meta.width! / meta.height! - 1.5), `${f} aspect`).toBeLessThan(0.05)
    // White page background (top-left pixel), not transparent/black.
    const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(info.channels).toBe(3)
    // JPEG may shift pure white by a level or two.
    for (const c of [data[0]!, data[1]!, data[2]!]) expect(c, `${f} background`).toBeGreaterThanOrEqual(248)
  }
}

test.describe('document conversions through the real Chromium adapters', () => {
  test('E2E-35 PDF → PNG pages via the renderPdfPages host adapter', { tag: NEEDS_P2 }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = await makePdf(join(lud.workDir, 'report.pdf'), 2)
    const { event } = await convertViaDrop(app, testInfo, 'pdf-to-png', [input], 'pdf-to-png')
    expect(event.type, JSON.stringify(event)).toBe('done')
    await expectPagesFolder(outputsOf(event), input, 2, 'png')
  })

  test('E2E-36 PDF → JPG pages via the renderPdfPages host adapter', { tag: NEEDS_P2 }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = await makePdf(join(lud.workDir, 'slides.pdf'), 3)
    const { event } = await convertViaDrop(app, testInfo, 'pdf-to-jpg', [input], 'pdf-to-jpg')
    expect(event.type, JSON.stringify(event)).toBe('done')
    await expectPagesFolder(outputsOf(event), input, 3, 'jpeg')
  })

  test('E2E-37 HTML → PDF: printToPDF honours page breaks and keeps the text', async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = join(lud.workDir, 'chapters.html')
    const sections = ['Alpha chapter LUDONE', 'Beta chapter LUDTWO', 'Gamma chapter LUDTHREE']
    const body = sections
      .map((s, i) => `<section${i < sections.length - 1 ? ' style="break-after: page; page-break-after: always"' : ''}><h1>${s}</h1><p>Text of ${s}.</p></section>`)
      .join('\n')
    writeFileSync(input, `<!doctype html><html><head><meta charset="utf-8"><title>Chapters</title></head><body>${body}</body></html>`)

    const { event } = await convertViaDrop(app, testInfo, 'html-to-pdf', [input], 'to-pdf')
    expect(event.type, JSON.stringify(event)).toBe('done')
    const out = outputsOf(event)
    expect(out).toEqual([expectedOutputPath(input, 'pdf')])
    expect(magic.pdf(out[0]!)).toBe(true)
    expect(await pdfPageCount(out[0]!)).toBe(3)
    const pages = await pdfPageTexts(out[0]!)
    expect(pages).toHaveLength(3)
    pages.forEach((text, i) => expect(text, `page ${i + 1}`).toContain(sections[i]!.split(' ').pop()!))
  })

  test('E2E-38 Markdown → PDF: one page with the heading, list and table text', async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = join(lud.workDir, 'notes.md')
    writeFileSync(input, '# Shopping LUDMD\n\n- apples\n- bananas\n\n| item | qty |\n|---|---|\n| pears | 7 |\n\nDone **bold** text.\n')
    const { event } = await convertViaDrop(app, testInfo, 'md-to-pdf', [input], 'to-pdf')
    expect(event.type, JSON.stringify(event)).toBe('done')
    const out = outputsOf(event)
    expect(out).toEqual([expectedOutputPath(input, 'pdf')])
    expect(await pdfPageCount(out[0]!)).toBe(1)
    const [text] = await pdfPageTexts(out[0]!)
    for (const s of ['Shopping LUDMD', 'apples', 'bananas', 'pears', '7', 'bold']) expect(text).toContain(s)
    expect(text, 'markdown syntax must be rendered, not printed').not.toContain('**')
  })

  test('E2E-39 DOCX → PDF via mammoth + printToPDF (no LibreOffice)', async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = await docxFile(join(lud.workDir, 'quarterly.docx'))
    const { event } = await convertViaDrop(app, testInfo, 'docx-to-pdf', [input], 'to-pdf')
    expect(event.type, JSON.stringify(event)).toBe('done')
    const out = outputsOf(event)
    expect(out).toEqual([expectedOutputPath(input, 'pdf')])
    expect(await pdfPageCount(out[0]!)).toBe(1)
    const [text] = await pdfPageTexts(out[0]!)
    for (const s of ['Quarterly Report', 'Revenue was', 'great', 'First point', 'Second point', 'Region', 'North', '42']) expect(text).toContain(s)
  })
})
