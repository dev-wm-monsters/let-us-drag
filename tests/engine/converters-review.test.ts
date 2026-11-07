// Independent QA/security review of D30 (SVG input, PDF Split): regressions for the issues found.
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rasterizeSvgBuffer, safeSharp, sharp } from '../../src/engine/tools/sharp-safe'
import { renderSvgMarkup, sanitizeSvg } from '../../src/engine/tools/svg'
import { splitPdf } from '../../src/engine/tools/pdf'
import { makeTempDir } from '../helpers/fixtures'
import { runOption } from '../helpers/engine'

let dir = ''
let cleanup: () => Promise<void> = async () => undefined
beforeAll(async () => {
  ;({ dir, cleanup } = await makeTempDir('lud-d30-review-'))
})
afterAll(async () => {
  await cleanup()
})

const S = (body: string, attrs = 'width="100" height="100"'): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${body}</svg>`

describe('SVG: librsvg is reachable only through the sanitized path', () => {
  it('a buffer that sniffs as BMP but carries "<svg" is refused by safeSharp (libvips would hand it to librsvg)', async () => {
    const polyglot = Buffer.from(`BM${' '.repeat(30)}${S('<rect width="10" height="10"/>')}`, 'latin1')
    // Why: libvips' SVG sniffer accepts this buffer and picks the (unblocked) SVG buffer loader.
    await expect(sharp(polyglot).metadata()).rejects.toThrow(/XML parse error/)
    expect(() => safeSharp(polyglot)).toThrowError(expect.objectContaining({ code: 'INPUT_INVALID' }))
    // ICO-style headers too (\0\0\1\0 is ASCII for the SVG sniffer).
    const ico = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0]), Buffer.from(' '.repeat(30) + S(''))])
    expect(() => safeSharp(ico)).toThrowError(expect.objectContaining({ code: 'INPUT_INVALID' }))
  })

  it('hostile reference spellings never survive sanitizing', () => {
    const hostile = [
      S('<image xmlns:foo="http://www.w3.org/1999/xlink" foo:href="file:///etc/passwd" width="9" height="9"/>'),
      S('<rect style="fill:u&#114;l(http://127.0.0.1:1/s)" width="9" height="9"/>'),
      S('<style><![CDATA[@import url(http://127.0.0.1:1/c.css);]]></style>'),
      S('<style>@IMPORT "http://127.0.0.1:1/i.css";</style>'),
      S('<style>rect{fill:image-set(linear-gradient(red,blue) 1x, "http://127.0.0.1:1/x" 2x)}</style>'),
      S('<a xlink:href="java&#x09;script:alert(1)"><rect width="9" height="9"/></a>'),
      S('<g xml:base="http://127.0.0.1:1/"><image href="x.png"/></g>'),
      S('<image href="//127.0.0.1:1/x.png"/><image href="\\\\host\\share\\x.png"/><image href=" FILE:///etc/passwd"/>'),
      S('<pattern id="p" href="http://127.0.0.1:1/p.svg"/><filter id="f"><feImage href="http://127.0.0.1:1/f.png"/></filter>'),
      S('<svg:foreignObject xmlns:svg="http://www.w3.org/2000/svg"><img src="http://127.0.0.1:1/fo"/></svg:foreignObject>'),
      S('<rect width="1" height="1"><set attributeName="fill" to="url(http://127.0.0.1:1/set)"/></rect>'),
      `<?xml-stylesheet href="http://127.0.0.1:1/pi.css"?>${S('<rect cursor="url(http://127.0.0.1:1/c),auto" width="1" height="1"/>')}`
    ]
    for (const svg of hostile) {
      const out = renderSvgMarkup(sanitizeSvg(svg), 100, 100).replace(/ xmlns(:xlink)?="[^"]*"/g, '')
      expect(out, svg).not.toMatch(/https?:|file:|javascript|\/\/127|x\.png|@import|foreignObject|\\\\host|passwd/i)
    }
  })
})

describe('SVG: rasterizing is time-limited', () => {
  it('a filter-heavy SVG stops with INPUT_INVALID at the time limit instead of running on', async () => {
    // A single blur over a 4096 px canvas: librsvg redoes the filter for every libvips tile
    // (~30 s on a 4-core CI box; heavier filters take hours).
    const svg = sanitizeSvg(S('<filter id="f"><feGaussianBlur stdDeviation="50"/></filter><rect filter="url(#f)" width="4096" height="4096"/>', 'width="4096" height="4096"'))
    const t0 = Date.now()
    const err = await rasterizeSvgBuffer(Buffer.from(renderSvgMarkup(svg, 4096, 4096)), 'png', join(dir, 'slow.png'), 1).then(
      () => undefined,
      (e: unknown) => e
    )
    expect(err).toEqual(expect.objectContaining({ code: 'INPUT_INVALID' }))
    expect(Date.now() - t0).toBeLessThan(25_000)
  })
})

describe('PDF Split: output size is capped', () => {
  async function sharedImagePdf(path: string, pages: number): Promise<number> {
    const { PDFDocument } = await import('pdf-lib')
    const png = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#000000', noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).png().toBuffer()
    const doc = await PDFDocument.create()
    const img = await doc.embedPng(png)
    for (let i = 0; i < pages; i++) doc.addPage([300, 300]).drawImage(img, { x: 0, y: 0, width: 300, height: 300 })
    const bytes = await doc.save()
    await writeFile(path, bytes)
    return bytes.byteLength
  }

  it('pages that share one big picture: every page file repeats it, and the total is capped', async () => {
    const input = join(dir, 'shared.pdf')
    const size = await sharedImagePdf(input, 30)
    const sizes: number[] = []
    await splitPdf(input, new AbortController().signal, async (_i, _n, bytes) => {
      sizes.push(bytes.byteLength)
    })
    // Amplification: each one-page file is about as big as the whole input.
    expect(sizes.reduce((a, b) => a + b, 0)).toBeGreaterThan(size * 20)
    await expect(splitPdf(input, new AbortController().signal, async () => undefined, size * 4)).rejects.toEqual(expect.objectContaining({ code: 'INPUT_INVALID' }))
  })

  it('a normal split stays well inside the default cap (job level, nothing left behind on refusal)', async () => {
    const d = join(dir, 'job')
    await (await import('node:fs/promises')).mkdir(d)
    const input = join(d, 'small.pdf')
    await sharedImagePdf(input, 3)
    const res = await runOption('pdf-split', [input])
    expect(res.error).toBeUndefined()
    expect((await readdir(d)).sort()).toEqual(['small (pages)', 'small.pdf'])
  })
})
