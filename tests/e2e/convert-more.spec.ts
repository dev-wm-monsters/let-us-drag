// E2E-D30: the conversions added in TPM decision D30 that need the real app (Chromium printToPDF
// for tables and vector SVG, and the overlay → engine path): XLSX → PDF, SVG → PNG, SVG → PDF
// (hostile references never fetched), PDF → Split.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Workbook } from 'exceljs'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { startBeacon } from '../helpers/beacon'
import { expect, test } from './support/app'
import { magic, makePdf, pdfPageCount } from './support/fixtures'
import { convertViaDrop, outputsOf } from './support/flows'
import { expectedOutputPath } from './support/naming'
import { pdfPageTexts } from './support/pdf'

test.describe('D30 conversions through the real app', () => {
  test('E2E-D30-01 XLSX → PDF: titled sheets, header repeated on every page, wide sheet in landscape', async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const wb = new Workbook()
    const long = wb.addWorksheet('Inventory LUDSHEET')
    long.addRow(['Item LUDHEAD', 'Qty', 'Price'])
    for (let i = 1; i <= 150; i++) long.addRow([`thing ${i}`, i, { formula: `B${i + 1}*2`, result: i * 2 }])
    long.addRow(['<b>not bold</b> & co', 1, 2])
    wb.addWorksheet('Nothing here')
    const wide = wb.addWorksheet('Wide LUDWIDE')
    wide.addRow(Array.from({ length: 12 }, (_, i) => `Column ${i + 1}`))
    wide.addRow(Array.from({ length: 12 }, (_, i) => i * 10))
    const input = join(lud.workDir, 'stock.xlsx')
    await wb.xlsx.writeFile(input)

    const { event } = await convertViaDrop(app, testInfo, 'xlsx-to-pdf', [input], 'to-pdf')
    expect(event.type, JSON.stringify(event)).toBe('done')
    const out = outputsOf(event)
    expect(out).toEqual([expectedOutputPath(input, 'pdf')])
    expect(magic.pdf(out[0]!)).toBe(true)

    const pages = await pdfPageTexts(out[0]!)
    expect(pages.length, 'the long sheet needs several pages').toBeGreaterThanOrEqual(3)
    expect(pages[0]).toContain('Inventory LUDSHEET')
    // thead { display: table-header-group }: the header row is printed again on later pages.
    const sheetPages = pages.slice(0, -1)
    for (const [i, text] of sheetPages.entries()) expect(text, `page ${i + 1}`).toContain('Item LUDHEAD')
    const all = pages.join(' ')
    expect(all).toContain('thing 150')
    expect(all).toContain('300') // cached formula result of the last row
    expect(all, 'cell text is escaped, not markup').toContain('<b>not bold</b> & co')
    expect(all).not.toContain('Nothing here')
    const last = pages[pages.length - 1]!
    expect(last).toContain('Wide LUDWIDE')
    expect(last).toContain('Column 12')

    const doc = await PDFDocument.load(readFileSync(out[0]!))
    const first = doc.getPage(0).getSize()
    const lastSize = doc.getPage(doc.getPageCount() - 1).getSize()
    expect(first.height, 'narrow sheet: portrait').toBeGreaterThan(first.width)
    expect(lastSize.width, 'wide sheet: landscape').toBeGreaterThan(lastSize.height)
  })

  test('E2E-D30-02 SVG → PNG: rasterized at its natural size (≥ 512 px), colours right', async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = join(lud.workDir, 'badge.svg')
    writeFileSync(
      input,
      '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" viewBox="0 0 64 32"><rect width="32" height="32" fill="#ff0000"/><rect x="32" width="32" height="32" fill="#0000ff"/><script>alert(1)</script></svg>'
    )
    const { event } = await convertViaDrop(app, testInfo, 'svg-to-png', [input], 'to-png')
    expect(event.type, JSON.stringify(event)).toBe('done')
    const out = outputsOf(event)
    expect(out).toEqual([expectedOutputPath(input, 'png')])
    const img = sharp(out[0]!)
    const meta = await img.metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 640, 320])
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
    const px = (x: number, y: number): number[] => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)]
    expect(px(100, 160)).toEqual([255, 0, 0])
    expect(px(540, 160)).toEqual([0, 0, 255])
  })

  test('E2E-D30-03 SVG → PDF: one vector page of the SVG size; hostile references are never fetched', async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const beacon = await startBeacon()
    try {
      const b = (tag: string): string => beacon.url(`/${tag}`)
      const input = join(lud.workDir, 'poster.svg')
      writeFileSync(
        input,
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="300">
  <style>@import url("${b('import')}"); text { font-family: sans-serif; }</style>
  <rect width="400" height="300" fill="#fde68a"/>
  <image href="${b('image')}" width="400" height="300"/>
  <image xlink:href="file:///etc/hostname" width="400" height="300"/>
  <rect width="10" height="10" fill="url(${b('fill')}#x)"/>
  <foreignObject width="400" height="300"><img xmlns="http://www.w3.org/1999/xhtml" src="${b('foreign')}"/></foreignObject>
  <script>fetch('${b('script')}')</script>
  <text x="20" y="150" font-size="40">Poster LUDSVG</text>
</svg>`
      )
      const { event } = await convertViaDrop(app, testInfo, 'svg-to-pdf', [input], 'to-pdf')
      expect(event.type, JSON.stringify(event)).toBe('done')
      const out = outputsOf(event)
      expect(out).toEqual([expectedOutputPath(input, 'pdf')])
      expect(await pdfPageCount(out[0]!)).toBe(1)
      const size = (await PDFDocument.load(readFileSync(out[0]!))).getPage(0).getSize()
      // 400×300 CSS px = 300×225 pt
      expect(Math.abs(size.width - 300)).toBeLessThan(2)
      expect(Math.abs(size.height - 225)).toBeLessThan(2)
      // Vector, not a screenshot: the text is real text and no raster image is embedded.
      expect((await pdfPageTexts(out[0]!))[0]).toContain('Poster LUDSVG')
      expect(readFileSync(out[0]!).toString('latin1')).not.toMatch(/\/Subtype\s*\/Image/)
      await new Promise((r) => setTimeout(r, 1_000))
      expect(beacon.hits, 'SVG → PDF must not touch the network').toEqual([])
    } finally {
      await beacon.close()
    }
  })

  test('E2E-D30-04 PDF → Split: "<name> (pages)/<name>-p001.pdf" … one page each', async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = await makePdf(join(lud.workDir, 'handout.pdf'), 3)
    const { event } = await convertViaDrop(app, testInfo, 'pdf-split', [input], 'pdf-split')
    expect(event.type, JSON.stringify(event)).toBe('done')
    const out = outputsOf(event)
    expect(out).toHaveLength(1)
    const folder = out[0]!
    expect(statSync(folder).isDirectory()).toBe(true)
    expect(basename(folder)).toBe('handout (pages)')
    expect(dirname(folder)).toBe(dirname(input))
    const files = readdirSync(folder).sort()
    expect(files).toEqual(['handout-p001.pdf', 'handout-p002.pdf', 'handout-p003.pdf'])
    for (const [i, f] of files.entries()) {
      expect(await pdfPageCount(join(folder, f))).toBe(1)
      expect((await pdfPageTexts(join(folder, f)))[0]).toContain(`page ${i + 1}`)
    }
  })
})
