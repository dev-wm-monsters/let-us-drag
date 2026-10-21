// Integration: every image option converts a real fixture; outputs are validated by magic bytes
// and by decoding them again with sharp / our ICO parser / pdf-lib.
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import type { Metadata } from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { openImage } from '../../src/engine/tools/image'
import { parseIco } from '../../src/engine/tools/ico'
import { MAGIC, bmpImage, icoImage, makeTempDir, noisyPng, pngWithAlpha, rotatedJpeg, sharpImage, startsWith } from '../helpers/fixtures'
import { convertOk, runOption } from '../helpers/engine'

let dir = ''
let cleanup: () => Promise<void> = async () => undefined

beforeAll(async () => {
  ;({ dir, cleanup } = await makeTempDir('lud-image-'))
})
afterAll(() => cleanup())

async function meta(p: string): Promise<Metadata> {
  return sharp(p).metadata()
}

describe('sharp capabilities on this machine (PLAN U5)', () => {
  it('has no BMP/ICO support and HEIF only via AV1, as assumed', () => {
    expect(sharp.format.jpeg.output.file).toBe(true)
    expect(sharp.format.png.output.file).toBe(true)
    expect(sharp.format.webp.output.file).toBe(true)
    expect(sharp.format.gif.output.file).toBe(true)
    expect(sharp.format.tiff.input.file).toBe(true)
    expect((sharp.format as unknown as Record<string, unknown>)['bmp']).toBeUndefined()
    expect((sharp.format as unknown as Record<string, unknown>)['ico']).toBeUndefined()
  })
})

describe('image conversions', () => {
  it('PNG (alpha) → JPG flattens on white', async () => {
    const src = await pngWithAlpha(join(dir, 'alpha.png'))
    const [out] = await convertOk('to-jpg', [src])
    expect(basename(out!)).toBe('alpha.jpg')
    const buf = await readFile(out!)
    expect(startsWith(buf, MAGIC.jpg)).toBe(true)
    const m = await meta(out!)
    expect(m.format).toBe('jpeg')
    expect(m.hasAlpha).toBe(false)
    // top-left pixel was red at 50% alpha → flattened over white ≈ (255,128,128)
    const { data } = await sharp(out!).raw().toBuffer({ resolveWithObject: true })
    expect(data[0]).toBeGreaterThan(230)
    expect(data[1]).toBeGreaterThan(100)
    expect(data[1]).toBeLessThan(160)
  })

  it('JPG → PNG / WEBP / AVIF', async () => {
    const src = await sharpImage(join(dir, 'photo.jpg'))
    for (const [opt, fmt, ext] of [
      ['to-png', 'png', 'png'],
      ['to-webp', 'webp', 'webp'],
      ['to-avif', 'heif', 'avif']
    ] as const) {
      const [out] = await convertOk(opt, [src])
      expect(basename(out!)).toBe(`photo.${ext}`)
      const m = await meta(out!)
      expect(m.format).toBe(fmt)
      expect([m.width, m.height]).toEqual([64, 48])
    }
  })

  it('respects EXIF orientation', async () => {
    const src = await rotatedJpeg(join(dir, 'rotated.jpg'))
    const [out] = await convertOk('to-png', [src])
    const m = await meta(out!)
    expect([m.width, m.height]).toEqual([20, 40])
  })

  it('never overwrites: second conversion becomes "name (1).ext"', async () => {
    const src = await sharpImage(join(dir, 'twice.png'))
    const [a] = await convertOk('to-jpg', [src])
    const [b] = await convertOk('to-jpg', [src])
    expect(basename(a!)).toBe('twice.jpg')
    expect(basename(b!)).toBe('twice (1).jpg')
  })

  it('ICO: real multi-size icon (16…256)', async () => {
    const src = await pngWithAlpha(join(dir, 'logo.png'), 300, 200)
    const [out] = await convertOk('to-ico', [src])
    expect(basename(out!)).toBe('logo.ico')
    const buf = await readFile(out!)
    expect(startsWith(buf, MAGIC.ico)).toBe(true)
    const entries = parseIco(buf)
    expect(entries.map((e) => e.width)).toEqual([16, 32, 48, 64, 128, 256])
    expect(entries.every((e) => e.isPng)).toBe(true)
    const big = entries[5]!
    const m = await sharp(buf.subarray(big.offset, big.offset + big.size)).metadata()
    expect([m.width, m.height, m.hasAlpha]).toEqual([256, 256, true])
  })

  it('BMP input (decoded through FFmpeg) → PNG', async () => {
    const src = await bmpImage(join(dir, 'paint.bmp'))
    const [out] = await convertOk('to-png', [src])
    const m = await meta(out!)
    expect([m.format, m.width, m.height]).toEqual(['png', 32, 24])
  })

  it('ICO input with BMP and PNG entries → PNG', async () => {
    for (const codec of ['bmp', 'png'] as const) {
      const src = await icoImage(join(dir, `fav-${codec}.ico`), codec, 32)
      const [out] = await convertOk('to-png', [src])
      const m = await meta(out!)
      expect([m.format, m.width, m.height]).toEqual(['png', 32, 32])
    }
  })

  it('HEIF (AV1) input works natively; GIF/TIFF/WEBP inputs convert', async () => {
    for (const name of ['pic.heif', 'anim.gif', 'scan.tiff', 'web.webp', 'pic2.avif']) {
      const src = await sharpImage(join(dir, name))
      const [out] = await convertOk('to-jpg', [src])
      expect((await meta(out!)).format).toBe('jpeg')
    }
  })

  it('HEIC (HEVC) input goes through the heic decoder (stubbed: no HEVC encoder is available to build a fixture)', async () => {
    // A file sharp cannot decode, with a HEIC brand. The injected decoder returns RGBA pixels.
    const fake = join(dir, 'iphone.heic')
    const header = Buffer.alloc(32)
    header.write('ftypheic', 4, 'latin1')
    await writeFile(fake, header)
    let called = 0
    const img = await openImage(fake, 'heic', {
      signal: new AbortController().signal,
      ffmpeg: () => 'ffmpeg',
      decodeHeic: async ({ buffer }) => {
        called++
        expect(buffer.byteLength).toBe(32)
        return { width: 4, height: 2, data: new Uint8ClampedArray(4 * 2 * 4).fill(200) }
      }
    })
    const png = await img.png().toBuffer()
    const m = await sharp(png).metadata()
    expect(called).toBe(1)
    expect([m.width, m.height]).toEqual([4, 2])
  })

  it('HEIC that is not really HEIC → INPUT_INVALID via the real heic-decode', async () => {
    const fake = join(dir, 'broken.heic')
    await writeFile(fake, Buffer.from('definitely not an image'))
    const res = await runOption('to-png', [fake])
    expect(res.error?.code).toBe('INPUT_INVALID')
  })

  it('Compress: same format, smaller, named "-compressed"', async () => {
    const src = await noisyPng(join(dir, 'noisy.png'))
    const [out] = await convertOk('compress', [src])
    expect(basename(out!)).toBe('noisy-compressed.png')
    expect((await stat(out!)).size).toBeLessThan((await stat(src)).size)
    expect((await meta(out!)).format).toBe('png')
    const jpg = join(dir, 'big.jpg')
    await sharp(await readFile(src)).jpeg({ quality: 100 }).toFile(jpg)
    const [outJ] = await convertOk('compress', [jpg])
    expect(basename(outJ!)).toBe('big-compressed.jpg')
    expect((await stat(outJ!)).size).toBeLessThan((await stat(jpg)).size)
  })

  it('Compress keeps the original when it cannot get smaller (and says so)', async () => {
    const src = join(dir, 'tiny.jpg')
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#808080' } }).jpeg({ quality: 10, mozjpeg: true }).toFile(src)
    const res = await runOption('compress', [src])
    expect(res.error).toBeUndefined()
    const out = res.outputPaths[0]!
    expect((await stat(out)).size).toBeLessThanOrEqual((await stat(src)).size)
    const stages = res.events.flatMap((e) => (e.type === 'progress' && e.stage ? [e.stage] : []))
    expect(stages.some((s) => /kept the original/i.test(s))).toBe(true)
  })

  it('PDF: one page per image, batch → one merged PDF named after the first', async () => {
    const a = await pngWithAlpha(join(dir, 'pdfa.png'), 96, 48)
    const b = await sharpImage(join(dir, 'pdfb.jpg'), 40, 80)
    const [single] = await convertOk('to-pdf', [a])
    expect(basename(single!)).toBe('pdfa.pdf')
    const [merged] = await convertOk('to-pdf', [a, b])
    expect(basename(merged!)).toBe('pdfa (merged).pdf')
    const buf = await readFile(merged!)
    expect(startsWith(buf, MAGIC.pdf)).toBe(true)
    const doc = await PDFDocument.load(buf)
    expect(doc.getPageCount()).toBe(2)
    const [p1, p2] = doc.getPages()
    expect(p1!.getSize()).toEqual({ width: 72, height: 36 }) // 96 dpi → pt
    expect(p2!.getSize()).toEqual({ width: 30, height: 60 })
  })

  it('batch "each": every input gets its own output', async () => {
    const a = await sharpImage(join(dir, 'b1.png'))
    const b = await sharpImage(join(dir, 'b2.png'))
    const outs = await convertOk('to-webp', [a, b])
    expect(outs.map((p) => basename(p))).toEqual(['b1.webp', 'b2.webp'])
  })

  it('a damaged image fails cleanly and leaves no temp files', async () => {
    const sub = join(dir, 'damaged')
    const bad = await (async () => {
      const p = join(sub, 'bad.png')
      await sharpImage(join(sub, 'ok.png'))
      await writeFile(p, Buffer.from('not a png at all'))
      return p
    })()
    const res = await runOption('to-jpg', [join(sub, 'ok.png'), bad])
    expect(res.error?.code).toBe('INPUT_INVALID')
    // the first (successful) conversion must not be committed either
    expect((await readdir(sub)).sort()).toEqual(['bad.png', 'ok.png'])
  })
})
