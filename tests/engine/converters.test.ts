// D30 conversions: XLSX/CSV → PDF, SVG → PNG/JPG/PDF (with the SVG sanitizer), GIF → MP4,
// Half size, Video → 720p, Mute, PDF Split / Rotate. Real fixtures generated here; outputs are
// decoded and checked (dimensions, pixels, page counts, streams present / absent).
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { categoryForExt, categoryForMime, extForMime, optionsFor } from '../../src/shared/catalog'
import { parseProbeOutput } from '../../src/engine/tools/ffmpeg'
import { rasterizeSvgBuffer, safeSharp } from '../../src/engine/tools/sharp-safe'
import { expandedCost, naturalSize, parseXml, rasterSize, renderSvgMarkup, sanitizeSvg, sanitizeSvgCss, safeSvgHref } from '../../src/engine/tools/svg'
import { formatDate, formatNumber, isWideSheet, pdfCell } from '../../src/engine/tools/table-pdf'
import { MAX_PDF_TABLE_ROWS } from '../../src/engine/limits'
import { startBeacon, type Beacon } from '../helpers/beacon'
import { ffmpeg, ffmpegDecode, ffmpegInfo, makeTempDir, pdfFile, rotatedJpeg, sharpImage, textFile, videoFile } from '../helpers/fixtures'
import { convertOk, fakeHtmlToPdf, runOption } from '../helpers/engine'

let dir = ''
let cleanup: () => Promise<void> = async () => undefined
let beacon: Beacon
let n = 0
async function caseDir(): Promise<string> {
  const d = join(dir, `case-${++n}`)
  await (await import('node:fs/promises')).mkdir(d, { recursive: true })
  return d
}

beforeAll(async () => {
  ;({ dir, cleanup } = await makeTempDir('lud-d30-'))
  beacon = await startBeacon()
})
afterAll(async () => {
  await beacon.close()
  await cleanup()
})

/** Drop the namespace declarations we add ourselves (they contain "http:"). */
const withoutNs = (svg: string): string => svg.replace(/ xmlns(:xlink)?="[^"]*"/g, '')

const ids = (cats: Parameters<typeof categoryForExt>[0][], exts: string[], count = exts.length || 1): string[] =>
  optionsFor({ categories: cats.map((e) => categoryForExt(e)), exts, count, hasDirectory: false }).map((o) => o.id)

// ---------------------------------------------------------------------------------------------

describe('catalog (D30)', () => {
  it('SVG is its own "vector" category with PNG / JPG / PDF only', () => {
    expect(categoryForExt('svg')).toBe('vector')
    expect(categoryForMime('image/svg+xml')).toBe('vector')
    expect(ids(['svg'], ['svg'])).toEqual(['to-png', 'to-jpg', 'to-pdf', 'zip'])
    // mixing SVG with raster pictures → ZIP only (no half-working options)
    expect(ids(['svg', 'png'], ['svg', 'png'])).toEqual(['zip'])
  })

  it('GIF gets MP4; other pictures do not; every picture gets Half size', () => {
    expect(ids(['gif'], ['gif'])).toContain('to-mp4')
    expect(ids(['png'], ['png'])).not.toContain('to-mp4')
    expect(ids(['gif', 'png'], ['gif', 'png'])).not.toContain('to-mp4')
    expect(ids(['png'], ['png'])).toContain('half-size')
    // dragover (extensions unknown): source-limited options stay hidden
    expect(optionsFor({ categories: ['image'], exts: [], count: 1, hasDirectory: false }).map((o) => o.id)).not.toContain('to-mp4')
    expect(extForMime('image/gif')).toBe('gif')
    expect(extForMime('application/x-unknown')).toBe('')
  })

  it('image options keep the most common first and ZIP last', () => {
    expect(ids(['jpg'], ['jpg'])).toEqual(['to-png', 'to-webp', 'to-pdf', 'remove-bg', 'compress', 'half-size', 'to-avif', 'to-ico', 'zip'])
  })

  it('video: 720p and Mute; audio: no separate AAC (M4A already is AAC)', () => {
    expect(ids(['mov'], ['mov'])).toEqual(['to-mp4', 'to-gif', 'to-mp3', 'to-720p', 'mute', 'to-webm', 'to-wav', 'compress', 'zip'])
    expect(ids(['mp3'], ['mp3'])).not.toContain('to-aac')
  })

  it('data → PDF only for CSV / XLSX', () => {
    expect(ids(['csv'], ['csv'])).toContain('to-pdf')
    expect(ids(['xlsx'], ['xlsx'])).toContain('to-pdf')
    expect(ids(['json'], ['json'])).not.toContain('to-pdf')
    expect(ids(['csv', 'json'], ['csv', 'json'])).not.toContain('to-pdf')
  })

  it('PDF: Split and Rotate', () => {
    expect(ids(['pdf'], ['pdf'])).toEqual(['pdf-to-png', 'pdf-to-jpg', 'to-txt', 'pdf-split', 'pdf-rotate', 'zip'])
  })

  it('labels stay short', async () => {
    const { OPTIONS } = await import('../../src/shared/catalog')
    for (const o of Object.values(OPTIONS)) expect(o.label.length, o.id).toBeLessThanOrEqual(9)
  })
})

// ---------------------------------------------------------------------------------------------

describe('SVG sanitizer', () => {
  const clean = (svg: string): string => {
    const s = sanitizeSvg(svg)
    return renderSvgMarkup(s, 10, 10)
  }

  it('keeps drawing elements and drops scripts, handlers, foreignObject, animation and metadata', () => {
    const out = clean(`<?xml version="1.0"?><!-- c --><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="alert(1)">
      <script>alert(1)</script><script xlink:href="http://x/y.js"/>
      <rect width="10" height="10" fill="red" onclick="x()" ONMOUSEOVER="y()"/>
      <foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="http://x/"/></div></foreignObject>
      <set attributeName="href" to="http://x/"/><animate attributeName="fill" values="red;blue"/>
      <metadata><x/></metadata><sodipodi:namedview xmlns:sodipodi="s"/>
      <a href="javascript:alert(1)"><circle r="2"/></a>
      <text x="1" y="5">Hi &amp; &lt;bye&gt;<![CDATA[ <raw> ]]></text>
    </svg>`)
    expect(out).toContain('<rect width="10" height="10" fill="red"/>')
    expect(out).toContain('<g><circle r="2"/></g>')
    expect(out).toContain('Hi &amp; &lt;bye&gt; &lt;raw&gt; ')
    for (const bad of ['script', 'onload', 'onclick', 'ONMOUSEOVER', 'foreignObject', 'animate', '<set', 'metadata', 'sodipodi', 'javascript', 'http://x']) {
      expect(out, bad).not.toContain(bad)
    }
  })

  it('external references are removed: href, xlink:href, url(), @import, image-set', () => {
    const out = clean(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10">
      <style>@import url(http://x/a.css); @import "http://x/b.css"; rect { fill: url(http://x/c.svg#p); stroke: url(#grad); background: image-set("http://x/d.png" 1x) }</style>
      <image href="file:///etc/passwd" width="10" height="10"/>
      <image xlink:href="http://127.0.0.1/z.png" width="10" height="10"/>
      <image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" width="10" height="10"/>
      <image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/>
      <use href="other.svg#a"/><use xlink:href="#ok"/>
      <linearGradient id="grad"/><filter id="f"/><rect id="ok" width="1" height="1" fill="url('file:///x#y')" filter="url(#f)" style="fill: url(http://x/); stroke: blue"/>
      <rect width="1" height="1" fill="u\\72l(http://x/)"/>
      <feImage href="http://x/"/>
    </svg>`)
    expect(withoutNs(out)).not.toMatch(/http:|file:|@import|image-set\(|svg\+xml|other\.svg|\\/)
    expect(out).toContain('stroke: url(#grad)')
    expect(out).toContain('xlink:href="data:image/png;base64,iVBORw0KGgo="')
    expect(out).toContain('<use xlink:href="#ok"/>')
    expect(out).toContain('fill="none"')
    expect(out).toContain('filter="url(#f)"')
    expect(out.match(/<image /g)).toHaveLength(1)
    expect(out).not.toContain('feImage')
  })

  it('helpers: href and CSS allow-lists', () => {
    expect(safeSvgHref('use', '#a')).toBe('#a')
    expect(safeSvgHref('use', 'data:image/png;base64,AAAA')).toBeUndefined()
    expect(safeSvgHref('image', ' data:image/jpeg;base64,AA AA ')).toBe('data:image/jpeg;base64,AAAA')
    expect(safeSvgHref('image', 'data:image/gif,raw')).toBeUndefined()
    expect(safeSvgHref('image', 'https://x/')).toBeUndefined()
    expect(sanitizeSvgCss('a{b:url( "#x" )}')).toBe('a{b:url(#x)}')
    expect(sanitizeSvgCss('a{b:url(x.png)}')).toBe('a{b:none}')
    expect(sanitizeSvgCss('a{b:\\75rl(x)}')).toBeUndefined()
    expect(sanitizeSvgCss('a{b:url(x}')).toBeUndefined()
    expect(sanitizeSvgCss('@import "x"; a{}')).toBe(' a{}')
  })

  it('DOCTYPE: literal entities work; external, parameter and nested ("billion laughs") entities are refused', () => {
    const ok = clean(`<!DOCTYPE svg [ <!ENTITY red "#ff0000"> ]><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect fill="&red;" width="1" height="1"/></svg>`)
    expect(ok).toContain('fill="#ff0000"')
    expect(clean(`<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg width="1" height="1"/>`)).toContain('<svg')
    const refused = [
      `<!DOCTYPE svg [ <!ENTITY x SYSTEM "file:///etc/passwd"> ]><svg><text>&x;</text></svg>`,
      `<!DOCTYPE svg [ <!ENTITY % p SYSTEM "http://x/evil.dtd"> %p; ]><svg/>`,
      `<!DOCTYPE svg [ <!ENTITY a "lol"> <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"> ]><svg><text>&b;</text></svg>`,
      `<svg><text>&undefined;</text></svg>`
    ]
    for (const svg of refused) expect(() => sanitizeSvg(svg), svg).toThrowError(expect.objectContaining({ code: 'INPUT_INVALID' }))
    // Many references to a literal entity are capped in total.
    const big = 'x'.repeat(1000)
    const bomb = `<!DOCTYPE svg [ <!ENTITY a "${big}"> ]><svg><text>${'&a;'.repeat(5000)}</text></svg>`
    expect(() => sanitizeSvg(bomb)).toThrowError(expect.objectContaining({ code: 'INPUT_INVALID' }))
  })

  it('reference bombs, cycles, deep nesting and malformed XML are refused', () => {
    let defs = '<g id="l0"><rect width="1" height="1"/></g>'
    for (let i = 1; i <= 8; i++) defs += `<g id="l${i}">${Array.from({ length: 10 }, () => `<use href="#l${i - 1}"/>`).join('')}</g>`
    const bomb = `<svg xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs><use href="#l8"/></svg>`
    expect(() => sanitizeSvg(bomb)).toThrowError(expect.objectContaining({ code: 'INPUT_INVALID', message: expect.stringMatching(/repeats/) }))
    expect(() => sanitizeSvg('<svg><g id="a"><use href="#a"/></g></svg>')).toThrowError(expect.objectContaining({ message: expect.stringMatching(/loop/) }))
    const chain = Array.from({ length: 5000 }, (_, i) => (i === 0 ? '<rect id="c0"/>' : `<use id="c${i}" href="#c${i - 1}"/>`)).join('')
    expect(() => sanitizeSvg(`<svg>${chain}</svg>`)).toThrowError(expect.objectContaining({ code: 'INPUT_INVALID' }))
    expect(() => sanitizeSvg('<svg>' + '<g>'.repeat(300) + '</g>'.repeat(300) + '</svg>')).toThrowError(expect.objectContaining({ message: expect.stringMatching(/nested/) }))
    for (const bad of ['<svg><g></svg>', '<svg a=1/>', '<svg/><svg/>', '<html/>', 'hello', '<svg a="1" a="2"/>']) {
      expect(() => sanitizeSvg(bad), bad).toThrowError(expect.objectContaining({ code: 'INPUT_INVALID' }))
    }
    expect(expandedCost(parseXml('<svg><g id="a"><rect/></g><use href="#a"/><use href="#a"/></svg>'))).toBe(1 + 2 + 3 + 3)
  })

  it('size: natural size, viewBox aspect, unit conversion, raster clamps', () => {
    expect(naturalSize('100', '50', undefined)).toEqual({ width: 100, height: 50, sized: true })
    expect(naturalSize('1in', undefined, '0 0 2 1')).toEqual({ width: 96, height: 48, sized: true })
    expect(naturalSize('100%', '100%', '0 0 10 20')).toEqual({ width: 10, height: 20, sized: false })
    expect(naturalSize(undefined, undefined, undefined)).toEqual({ width: 300, height: 150, sized: false })
    expect(rasterSize({ width: 100, height: 50, sized: true })).toEqual({ width: 512, height: 256 })
    expect(rasterSize({ width: 1000, height: 800, sized: true })).toEqual({ width: 1000, height: 800 })
    expect(rasterSize({ width: 10000, height: 1000, sized: true })).toEqual({ width: 4096, height: 410 })
    expect(rasterSize({ width: 10, height: 20, sized: false })).toEqual({ width: 1024, height: 2048 })
  })
})

// ---------------------------------------------------------------------------------------------

describe('SVG → PNG / JPG / PDF', () => {
  async function greenPng(d: string): Promise<string> {
    const p = join(d, 'green.png')
    await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 255, b: 0 } } }).png().toFile(p)
    return p
  }
  async function pixel(file: string, x: number, y: number): Promise<number[]> {
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
    const i = (y * info.width + x) * info.channels
    return [...data.subarray(i, i + info.channels)]
  }

  it('PNG at the natural size (clamped to ≥ 512), transparent where nothing is drawn', async () => {
    const d = await caseDir()
    const input = await textFile(join(d, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="50" height="50" fill="#ff0000"/></svg>')
    const [out] = await convertOk('to-png', [input])
    expect(basename(out!)).toBe('logo.png')
    const meta = await sharp(out!).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 512, 256])
    expect(await pixel(out!, 10, 10)).toEqual([255, 0, 0, 255])
    expect((await pixel(out!, 500, 10))[3]).toBe(0)
  })

  it('JPG on white, 2048 px long side when the SVG has only a viewBox', async () => {
    const d = await caseDir()
    const input = await textFile(join(d, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><circle cx="5" cy="5" r="5" fill="blue"/></svg>')
    const [out] = await convertOk('to-jpg', [input])
    const meta = await sharp(out!).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 2048, 1024])
    const [r, g, b] = await pixel(out!, 2000, 20)
    expect(Math.min(r!, g!, b!)).toBeGreaterThanOrEqual(250)
  })

  it('hostile references are never fetched or embedded (file://, http://, relative), even when the sanitizer is bypassed', async () => {
    const d = await caseDir()
    const green = await greenPng(d)
    const hostile = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="600" height="600">
      <rect width="600" height="600" fill="#ff0000"/>
      <image href="file://${green}" width="600" height="600"/>
      <image xlink:href="${beacon.url('/svg-xlink')}" width="600" height="600"/>
      <image href="green.png" width="600" height="600"/>
      <rect width="600" height="600" fill="url(${beacon.url('/svg-fill')}#p)" opacity="0.01"/>
      <style>@import url(${beacon.url('/svg-import')});</style>
      <image href="file:///etc/passwd" width="600" height="600"/>
    </svg>`
    const input = await textFile(join(d, 'hostile.svg'), hostile)
    const before = beacon.hits.length
    const [png] = await convertOk('to-png', [input])
    expect(await pixel(png!, 300, 300)).toEqual([255, 0, 0, 255])
    const pdfAdapter = fakeHtmlToPdf()
    await convertOk('to-pdf', [input], { adapters: pdfAdapter })
    const html = pdfAdapter.calls[0]!
    const svgInHtml = Buffer.from(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/.exec(html)![1]!, 'base64').toString('utf8')
    expect(withoutNs(svgInHtml)).not.toMatch(/file:|http:|green\.png|@import|passwd/)
    // Defence in depth: librsvg itself (buffer input, no base URL) loads nothing either.
    const raw = join(d, 'raw.png')
    await rasterizeSvgBuffer(Buffer.from(hostile), 'png', raw)
    expect(await pixel(raw, 300, 300)).toEqual([255, 0, 0, 255])
    await new Promise((r) => setTimeout(r, 300))
    expect(beacon.hits.slice(before)).toEqual([])
  })

  it('PDF: one page per SVG through the sanitized htmlToPdf path; several SVGs merge', async () => {
    const d = await caseDir()
    const a = await textFile(join(d, 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="teal"/><script>x()</script></svg>')
    const b = await textFile(join(d, 'b.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>')
    const adapter = fakeHtmlToPdf()
    const [one] = await convertOk('to-pdf', [a], { adapters: adapter })
    expect(basename(one!)).toBe('a.pdf')
    expect(adapter.calls[0]).toContain('@page { size: 300px 200px; margin: 0; }')
    expect(adapter.calls[0]).toContain('Content-Security-Policy')
    const [merged] = await convertOk('to-pdf', [a, b], { adapters: adapter })
    expect(basename(merged!)).toBe('a (merged).pdf')
    const { PDFDocument } = await import('pdf-lib')
    expect((await PDFDocument.load(await readFile(merged!))).getPageCount()).toBe(2)
    expect(adapter.calls[2]).toContain('@page { size: 768px 768px; margin: 0; }')
  })

  it('broken, oversized or non-SVG input → INPUT_INVALID, nothing written', async () => {
    const d = await caseDir()
    const cases = [
      await textFile(join(d, 'broken.svg'), '<svg><g></svg>'),
      await textFile(join(d, 'html.svg'), '<html><body>hi</body></html>'),
      await sharpImage(join(d, 'png-in-disguise.svg').replace(/\.svg$/, '.png')).then(async (p) => {
        const q = join(d, 'raster.svg')
        await writeFile(q, await readFile(p))
        return q
      })
    ]
    for (const input of cases) {
      const res = await runOption('to-png', [input])
      expect(res.error?.code, input).toBe('INPUT_INVALID')
    }
    const files = await readdir(d)
    expect(files.filter((f) => f.endsWith('.png') && f !== 'png-in-disguise.png')).toEqual([])
  })

  it('safeSharp still refuses SVG buffers (only the sanitized path reaches librsvg)', () => {
    expect(() => safeSharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'))).toThrowError(expect.objectContaining({ code: 'INPUT_INVALID' }))
  })
})

// ---------------------------------------------------------------------------------------------

describe('XLSX / CSV → PDF', () => {
  it('cell formatting helpers', () => {
    expect(formatDate(new Date(Date.UTC(2026, 10, 7)))).toBe('2026-11-07')
    expect(formatDate(new Date(Date.UTC(2026, 10, 7, 14, 30)))).toBe('2026-11-07 14:30')
    expect(formatNumber(0.1 + 0.2)).toBe('0.3')
    expect(formatNumber(0.125, '0.0%')).toBe('12.5%')
    expect(pdfCell({ formula: 'A1*2', result: 84 })).toEqual({ text: '84', numeric: true })
    expect(pdfCell({ formula: 'NOW()' })).toEqual({ text: '', numeric: false })
    expect(pdfCell({ richText: [{ text: 'a' }, { text: 'b' }] }).text).toBe('ab')
    expect(pdfCell({ text: 'link', hyperlink: 'https://x' }).text).toBe('link')
    expect(pdfCell({ error: '#DIV/0!' }).text).toBe('#DIV/0!')
    expect(pdfCell(true).text).toBe('TRUE')
    expect(isWideSheet({ title: 't', rows: [Array.from({ length: 8 }, () => ({ text: 'a', numeric: false }))], columns: 8, droppedColumns: 0 })).toBe(true)
  })

  it('every visible, non-empty sheet becomes a titled table with escaped cells and cached formula results', async () => {
    const d = await caseDir()
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const s1 = wb.addWorksheet('Sales <2026>')
    s1.addRow(['Item', 'Price', 'When', 'Total'])
    s1.addRow(['<script>alert(1)</script>', 12.5, new Date(Date.UTC(2026, 0, 2)), { formula: 'B2*2', result: 25 }])
    s1.addRow(['Pears & co', 3, new Date(Date.UTC(2026, 0, 3, 9, 15)), { formula: 'B3*2', result: 6 }])
    wb.addWorksheet('Empty')
    const hidden = wb.addWorksheet('Secret')
    hidden.state = 'hidden'
    hidden.addRow(['hidden-value'])
    const wide = wb.addWorksheet('Wide')
    wide.addRow(Array.from({ length: 55 }, (_, i) => `C${i + 1}`))
    wide.addRow(Array.from({ length: 55 }, (_, i) => i))
    const input = join(d, 'book.xlsx')
    await wb.xlsx.writeFile(input)

    const adapter = fakeHtmlToPdf()
    const [out] = await convertOk('to-pdf', [input], { adapters: adapter })
    expect(basename(out!)).toBe('book.pdf')
    const html = adapter.calls[0]!
    expect(html).toContain('<h2 class="lud-title">Sales &lt;2026&gt;</h2>')
    expect(html).toContain('<td>&lt;script&gt;alert(1)&lt;/script&gt;</td>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('<td class="lud-num">25</td>')
    expect(html).toContain('<td>2026-01-02</td>')
    expect(html).toContain('<td>2026-01-03 09:15</td>')
    expect(html).toContain('Pears &amp; co')
    expect(html).toContain('thead { display: table-header-group; }')
    expect(html).not.toContain('Empty')
    expect(html).not.toContain('hidden-value')
    expect(html).toContain('<section class="lud-sheet lud-wide">')
    expect(html).toContain('5 more columns left out (at most 50 columns are printed).')
    expect(html).toContain('<th>C50</th>')
    expect(html).not.toContain('<th>C51</th>')
    expect(html).toContain('Content-Security-Policy')
  })

  it('CSV → PDF with the row cap note; JSON → PDF is not offered', async () => {
    const d = await caseDir()
    const rows = ['id,name', ...Array.from({ length: MAX_PDF_TABLE_ROWS + 5 }, (_, i) => `${i},n${i}`)]
    const input = await textFile(join(d, 'big.csv'), rows.join('\n') + '\n')
    const adapter = fakeHtmlToPdf()
    await convertOk('to-pdf', [input], { adapters: adapter })
    const html = adapter.calls[0]!
    expect(html).toContain('<h2 class="lud-title">big</h2>')
    expect(html).toContain('More rows were left out here (at most 20,000 rows are printed).')
    expect((html.match(/<tr>/g) ?? []).length).toBe(MAX_PDF_TABLE_ROWS)
    const json = await textFile(join(d, 'x.json'), '[{"a":1}]')
    expect((await runOption('to-pdf', [json])).error?.code).toBe('UNSUPPORTED')
    const empty = await textFile(join(d, 'empty.csv'), '\n\n')
    expect((await runOption('to-pdf', [empty])).error?.code).toBe('INPUT_INVALID')
  })
})

// ---------------------------------------------------------------------------------------------

describe('media (ffmpeg)', () => {
  async function animatedGif(path: string, size = '81x61', seconds = 1): Promise<string> {
    await ffmpeg(['-f', 'lavfi', '-i', `testsrc=size=${size}:rate=10:duration=${seconds}`, '-f', 'gif', path])
    return path
  }

  it('GIF → MP4: H.264 yuv420p, even dimensions, faststart, no audio', async () => {
    const d = await caseDir()
    const input = await animatedGif(join(d, 'dance.gif'))
    const [out] = await convertOk('to-mp4', [input])
    expect(basename(out!)).toBe('dance.mp4')
    expect(await ffmpegDecode(out!)).toBe('')
    const info = await ffmpegInfo(out!)
    expect(info).toMatch(/Video: h264/)
    expect(info).toMatch(/yuv420p/)
    const p = parseProbeOutput(info)
    expect([p.width, p.height, p.hasAudio]).toEqual([80, 60, false])
    expect(p.durationSec).toBeGreaterThan(0.7)
    const buf = await readFile(out!)
    expect(buf.indexOf('moov')).toBeLessThan(buf.indexOf('mdat'))
  })

  it('GIF → MP4 refuses a single-frame GIF and a PNG named .gif', async () => {
    const d = await caseDir()
    const still = await sharpImage(join(d, 'still.gif'))
    expect((await runOption('to-mp4', [still])).error).toMatchObject({ code: 'INPUT_INVALID', message: expect.stringMatching(/single frame/) })
    const fake = join(d, 'fake.gif')
    await writeFile(fake, await readFile(await sharpImage(join(d, 'real.png'))))
    expect((await runOption('to-mp4', [fake])).error?.code).toBe('INPUT_INVALID')
  })

  it('720p: shorter side 720, aspect kept, H.264/AAC; small videos keep their size', async () => {
    const d = await caseDir()
    const big = await videoFile(join(d, 'big.mov'), { size: '1280x960', seconds: 1 })
    const [out] = await convertOk('to-720p', [big])
    expect(basename(out!)).toBe('big-720p.mp4')
    const info = await ffmpegInfo(out!)
    const p = parseProbeOutput(info)
    expect([p.width, p.height, p.hasAudio]).toEqual([960, 720, true])
    expect(info).toMatch(/Video: h264/)
    expect(info).toMatch(/Audio: aac/)

    const small = await videoFile(join(d, 'small.mp4'), { size: '160x120', seconds: 1 })
    const res = await runOption('to-720p', [small])
    expect(res.error).toBeUndefined()
    const sp = parseProbeOutput(await ffmpegInfo(res.outputPaths[0]!))
    expect([sp.width, sp.height]).toEqual([160, 120])
    expect(res.events.some((e) => e.type === 'progress' && e.stage === 'Already 720p or smaller, kept the size')).toBe(true)
  })

  it('720p for portrait video scales the width to 720', async () => {
    const d = await caseDir()
    const tall = await videoFile(join(d, 'tall.mp4'), { size: '1080x1920', seconds: 1, audio: false })
    const [out] = await convertOk('to-720p', [tall])
    const p = parseProbeOutput(await ffmpegInfo(out!))
    expect([p.width, p.height, p.hasAudio]).toEqual([720, 1280, false])
  })

  it('Mute: same container, video copied, no audio stream', async () => {
    const d = await caseDir()
    for (const ext of ['mkv', 'mp4', 'webm']) {
      const input = await videoFile(join(d, `clip.${ext}`), { seconds: 1 })
      const before = await ffmpegInfo(input)
      const [out] = await convertOk('mute', [input])
      expect(basename(out!)).toBe(`clip-muted.${ext}`)
      expect(await ffmpegDecode(out!)).toBe('')
      const info = await ffmpegInfo(out!)
      const p = parseProbeOutput(info)
      expect(p.hasVideo, ext).toBe(true)
      expect(p.hasAudio, ext).toBe(false)
      const codec = (s: string): string => /Video: (\w+)/.exec(s)![1]!
      expect(codec(info)).toBe(codec(before))
    }
  })
})

// ---------------------------------------------------------------------------------------------

describe('Half size', () => {
  it('halves PNG, keeps the format, never below 1 px', async () => {
    const d = await caseDir()
    const [out] = await convertOk('half-size', [await sharpImage(join(d, 'a.png'), 65, 48)])
    expect(basename(out!)).toBe('a-half.png')
    const m = await sharp(out!).metadata()
    expect([m.format, m.width, m.height]).toEqual(['png', 33, 24])
    const [tiny] = await convertOk('half-size', [await sharpImage(join(d, 'dot.webp'), 1, 1)])
    const t = await sharp(tiny!).metadata()
    expect([t.format, t.width, t.height]).toEqual(['webp', 1, 1])
  })

  it('applies EXIF orientation (stored 40×20, displayed 20×40 → 10×20)', async () => {
    const d = await caseDir()
    const [out] = await convertOk('half-size', [await rotatedJpeg(join(d, 'phone.jpg'))])
    const m = await sharp(out!).metadata()
    expect([m.format, m.width, m.height]).toEqual(['jpeg', 10, 20])
    expect(m.orientation ?? 1).toBe(1)
  })

  it('keeps GIF animation', async () => {
    const d = await caseDir()
    const gif = join(d, 'anim.gif')
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=80x60:rate=5:duration=1', '-f', 'gif', gif])
    const [out] = await convertOk('half-size', [gif])
    const m = await sharp(out!, { animated: true }).metadata()
    expect(m.format).toBe('gif')
    expect(m.width).toBe(40)
    expect(m.pageHeight).toBe(30)
    expect(m.pages).toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------------------------------------

describe('PDF Split / Rotate', () => {
  it('Split: "<name> (pages)/<name>-p001.pdf …", one page each, in order', async () => {
    const d = await caseDir()
    const input = await pdfFile(join(d, 'report.pdf'), 3)
    const [out] = await convertOk('pdf-split', [input])
    expect(basename(out!)).toBe('report (pages)')
    expect(dirname(out!)).toBe(d)
    expect((await stat(out!)).isDirectory()).toBe(true)
    const files = (await readdir(out!)).sort()
    expect(files).toEqual(['report-p001.pdf', 'report-p002.pdf', 'report-p003.pdf'])
    const { PDFDocument } = await import('pdf-lib')
    const { pdfToText } = await import('../../src/engine/tools/pdf')
    for (const [i, f] of files.entries()) {
      const doc = await PDFDocument.load(await readFile(join(out!, f)))
      expect(doc.getPageCount()).toBe(1)
      expect(await pdfToText(join(out!, f), new AbortController().signal)).toContain(`Hello page ${i + 1}`)
    }
  })

  it('Split of a one-page PDF gives a single file', async () => {
    const d = await caseDir()
    const [out] = await convertOk('pdf-split', [await pdfFile(join(d, 'one.pdf'), 1)])
    expect(basename(out!)).toBe('one-p001.pdf')
    expect(dirname(out!)).toBe(d)
  })

  it('Rotate: every page turns 90° clockwise (adding to an existing rotation)', async () => {
    const d = await caseDir()
    const { PDFDocument, degrees } = await import('pdf-lib')
    const input = await pdfFile(join(d, 'scan.pdf'), 2)
    const doc = await PDFDocument.load(await readFile(input))
    doc.getPage(1).setRotation(degrees(270))
    await writeFile(input, await doc.save())
    const [out] = await convertOk('pdf-rotate', [input])
    expect(basename(out!)).toBe('scan-rotated.pdf')
    const rotated = await PDFDocument.load(await readFile(out!))
    expect(rotated.getPages().map((p) => p.getRotation().angle)).toEqual([90, 0])
  })

  it('a damaged PDF → INPUT_INVALID and nothing written', async () => {
    const d = await caseDir()
    const input = await textFile(join(d, 'bad.pdf'), '%PDF-1.7\nthis is not really a pdf')
    for (const option of ['pdf-split', 'pdf-rotate'] as const) expect((await runOption(option, [input])).error?.code).toBe('INPUT_INVALID')
    expect(await readdir(d)).toEqual(['bad.pdf'])
  })
})
