// Engine security hardening (docs/security/CHECKLIST.md sections C, D, E, F; QA ERR-10).
// Every test uses a hostile or tricky fixture generated at test time.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toJobError, EngineError } from '../../src/engine/errors'
import { assertInputSizes } from '../../src/engine/jobs'
import { MAX_INPUT_BYTES, MAX_OOXML_TOTAL_BYTES, MAX_PDF_PAGES, MAX_ZIP_ENTRIES } from '../../src/engine/limits'
import { commitDir, commitFile } from '../../src/engine/output'
import { sniffImage } from '../../src/engine/sniff'
import { dedupeTarget, isBombEntry, portableComponent, safeEntryPath } from '../../src/engine/tools/archive'
import { FORMAT_WHITELIST, classifyFfmpegFailure, ffmpegInput, fileUrl } from '../../src/engine/tools/ffmpeg'
import { openImage } from '../../src/engine/tools/image'
import { MODEL_MIRROR_URL, MODEL_UPSTREAM_URL, MODEL_URLS, ensureModel, isAllowedModelUrl, resetModelCacheState } from '../../src/engine/tools/model'
import { ALLOWED_LOADERS, safeSharp, sharpError } from '../../src/engine/tools/sharp-safe'
import { scanZipContainer } from '../../src/engine/tools/zipscan'
import type { DroppedItem } from '../../src/shared/types'
import { convertOk, runOption } from '../helpers/engine'
import {
  audioFile,
  bmpImage,
  ffmpegBin,
  makeTempDir,
  officeZip,
  pdfFile,
  pngDeclaring,
  pngWithAlpha,
  rawZip,
  sharpImage,
  textFile,
  videoFile
} from '../helpers/fixtures'

const posix = process.platform !== 'win32'
const MB = 1024 * 1024

let dir = ''
let cleanup: () => Promise<void> = async () => undefined
beforeAll(async () => {
  ;({ dir, cleanup } = await makeTempDir('lud-sec-'))
})
afterAll(() => cleanup())

async function sub(name: string): Promise<string> {
  const d = join(dir, name)
  await mkdir(d, { recursive: true })
  return d
}

// --- SEC-50/51/40: sharp hardening and sniffing --------------------------------------------------

describe('images: libvips loaders, pixel cap, sniffing', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'

  it('an SVG renamed .png is refused (INPUT_INVALID) and nothing is written', async () => {
    const d = await sub('svgpng')
    const f = join(d, 'pic.png')
    await writeFile(f, svg)
    const res = await runOption('to-jpg', [f])
    expect(res.error?.code).toBe('INPUT_INVALID')
    expect(await readdir(d)).toEqual(['pic.png'])
  })

  it('the SVG loader is blocked even when handed straight to the hardened sharp', async () => {
    await expect(safeSharp(Buffer.from(svg)).metadata()).rejects.toThrow()
    expect(ALLOWED_LOADERS.some((l) => /svg|pdf|magick|vips(file|source)?$/i.test(l))).toBe(false)
    // the allowed formats still work (buffer variant)
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } }).png().toBuffer()
    expect((await safeSharp(png).metadata()).format).toBe('png')
  })

  it('a PNG that declares 30000×30000 pixels → INPUT_INVALID (pixel cap), quickly', async () => {
    const f = join(await sub('huge'), 'huge.png')
    await writeFile(f, pngDeclaring(30000, 30000))
    const t0 = Date.now()
    const res = await runOption('to-jpg', [f])
    expect(res.error?.code).toBe('INPUT_INVALID')
    expect(res.error?.message).toMatch(/too big/)
    expect(Date.now() - t0).toBeLessThan(5000)
  })

  it('a truncated PNG → INPUT_INVALID (was INTERNAL)', async () => {
    const d = await sub('trunc')
    const full = join(d, 'full.png')
    await sharp({ create: { width: 300, height: 200, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
      .png()
      .toFile(full)
    const bytes = await readFile(full)
    const f = join(d, 'cut.png')
    await writeFile(f, bytes.subarray(0, Math.floor(bytes.length / 2)))
    const res = await runOption('to-webp', [f])
    expect(res.error?.code).toBe('INPUT_INVALID')
  })

  it('a text file renamed .jpg and a PDF renamed .png → INPUT_INVALID', async () => {
    const d = await sub('fake-img')
    const a = await textFile(join(d, 'a.jpg'), 'just text')
    const b = await pdfFile(join(d, 'b.png'), 1)
    expect((await runOption('to-png', [a])).error?.code).toBe('INPUT_INVALID')
    expect((await runOption('to-jpg', [b])).error?.code).toBe('INPUT_INVALID')
  })

  it('formats are routed by content: a PNG named .bmp and a JPEG named .png still convert', async () => {
    const d = await sub('route')
    const png = await pngWithAlpha(join(d, 'src.png'))
    const asBmp = join(d, 'really-png.bmp')
    await copyFile(png, asBmp)
    const [o1] = await convertOk('to-webp', [asBmp])
    expect((await sharp(o1!).metadata()).format).toBe('webp')
    const jpg = await sharpImage(join(d, 'src.jpg'))
    const asPng = join(d, 'really-jpg.png')
    await copyFile(jpg, asPng)
    const [o2] = await convertOk('to-webp', [asPng])
    expect((await sharp(o2!).metadata()).format).toBe('webp')
  })

  it('sniffImage recognises the §5 formats and nothing else', () => {
    const b = (s: string | number[]): Buffer => (typeof s === 'string' ? Buffer.from(s, 'latin1') : Buffer.from(s))
    expect(sniffImage(b([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png')
    expect(sniffImage(b([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg')
    expect(sniffImage(b('GIF89a'))).toBe('gif')
    expect(sniffImage(b('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp')
    expect(sniffImage(b('II*\0'))).toBe('tiff')
    expect(sniffImage(b('\0\0\0\x18ftypheic\0\0\0\0mif1heic'))).toBe('heif')
    expect(sniffImage(b('\0\0\0\x1cftypavif\0\0\0\0avifmif1miaf'))).toBe('heif')
    expect(sniffImage(b('\0\0\0\x18ftypisom\0\0\0\0isomiso2'))).toBeUndefined() // an MP4 named .heic
    expect(sniffImage(b('BM' + '\0'.repeat(20)))).toBe('bmp')
    expect(sniffImage(b([0, 0, 1, 0, 1, 0]))).toBe('ico')
    expect(sniffImage(b('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeUndefined()
    expect(sniffImage(b('%PDF-1.7'))).toBeUndefined()
    expect(sniffImage(b('8BPS'))).toBeUndefined() // PSD
  })

  it('HEIC: the pixel cap applies before the RGBA buffer is used', async () => {
    const f = join(await sub('heic'), 'big.heic')
    const header = Buffer.alloc(32)
    header.write('ftypheic', 4, 'latin1')
    await writeFile(f, header)
    const deps = {
      signal: new AbortController().signal,
      ffmpeg: () => ffmpegBin(),
      decodeHeic: async () => ({ width: 40000, height: 40000, data: new Uint8ClampedArray(4) })
    }
    await expect(openImage(f, 'heic', deps)).rejects.toMatchObject({ code: 'INPUT_INVALID' })
  })

  it('HEIC: a HEIC-branded but broken file reaches the real heic-decode (all()) and gives INPUT_INVALID', async () => {
    const f = join(await sub('heic2'), 'broken.heic')
    const bytes = Buffer.alloc(256, 7)
    bytes.writeUInt32BE(24, 0)
    bytes.write('ftypheic', 4, 'latin1')
    await writeFile(f, bytes)
    const res = await runOption('to-png', [f])
    expect(res.error?.code).toBe('INPUT_INVALID')
  })
})

// --- SEC-60…63, QA ERR-10: ffmpeg ---------------------------------------------------------------

describe('ffmpeg: whitelists, file: URLs, odd names', () => {
  it('args builder: protocol + format whitelist and an absolute file: URL before every -i', () => {
    const abs = join(dir, '-version.wav')
    const args = ffmpegInput(abs, 'audio')
    expect(args).toEqual(['-protocol_whitelist', 'file', '-format_whitelist', FORMAT_WHITELIST.audio.join(','), '-i', `file:${abs}`])
    expect(ffmpegInput(abs, 'image', 'bmp_pipe')).toContain('bmp_pipe')
    expect(() => ffmpegInput(abs, 'image', 'image2')).toThrow() // pattern-expanding demuxer is never forced
    expect(() => fileUrl('relative/x.mp4')).toThrow()
    for (const list of Object.values(FORMAT_WHITELIST)) {
      for (const bad of ['concat', 'hls', 'dash', 'image2', 'sdp', 'rtp', 'rtsp', 'lavfi', 'tty', 'data', 'ffmetadata']) expect(list).not.toContain(bad)
    }
  })

  it('every whitelisted demuxer exists in this ffmpeg build', () => {
    const out = execFileSync(ffmpegBin(), ['-hide_banner', '-demuxers'], { encoding: 'utf8' })
    const names = new Set(
      out
        .split(/\r?\n/)
        .map((l) => /^\s*D\S*\s+(\S+)/.exec(l)?.[1])
        .filter((n): n is string => !!n)
        .flatMap((n) => n.split(','))
    )
    for (const list of Object.values(FORMAT_WHITELIST)) for (const n of list) expect(names.has(n), n).toBe(true)
  })

  it('an ffconcat playlist disguised as .mp3 is refused (INPUT_INVALID), even though its target exists', async () => {
    const d = await sub('ffconcat')
    await audioFile(join(d, 'x.wav'), 1)
    const evil = await textFile(join(d, 'song.mp3'), 'ffconcat version 1.0\nfile x.wav\n')
    const res = await runOption('to-wav', [evil])
    expect(res.error?.code).toBe('INPUT_INVALID')
    expect((await readdir(d)).sort()).toEqual(['song.mp3', 'x.wav'])
  })

  describe('HLS playlist disguised as .mp3', () => {
    let server: Server
    let hits = 0
    let port = 0
    beforeAll(async () => {
      server = createServer((s) => {
        hits++
        s.destroy()
      })
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
      port = (server.address() as { port: number }).port
    })
    afterAll(() => new Promise<void>((r) => server.close(() => r())))

    it('is refused without any network attempt', async () => {
      const d = await sub('hls')
      const evil = await textFile(
        join(d, 'track.mp3'),
        `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:${port}/x.ts\n#EXT-X-ENDLIST\n`
      )
      const res = await runOption('to-wav', [evil])
      expect(res.error?.code).toBe('INPUT_INVALID')
      expect(hits).toBe(0)
    })
  })

  it('a text file renamed .mp4 → INPUT_INVALID', async () => {
    const f = await textFile(join(await sub('fake-mp4'), 'movie.mp4'), 'not a movie at all')
    expect((await runOption('to-mp3', [f])).error?.code).toBe('INPUT_INVALID')
  })

  it('names starting with "-" or containing "%", ":" and spaces convert correctly (no option/pattern/protocol parsing)', async () => {
    const d = await sub('odd names')
    const wav = await audioFile(join(d, 'tone.wav'), 1)
    const dashWav = join(d, '-version.wav')
    await copyFile(wav, dashWav)
    const [o1] = await convertOk('to-mp3', [dashWav])
    expect(basename(o1!)).toBe('-version.mp3')

    const mp4 = await videoFile(join(d, 'clip.mp4'), { seconds: 1 })
    const pct = join(d, 'a%03d -x.mp4')
    await copyFile(mp4, pct)
    const [o2] = await convertOk('to-mp3', [pct])
    expect(basename(o2!)).toBe('a%03d -x.mp3')

    if (posix) {
      const colon = join(d, 'http:evil.wav')
      await copyFile(wav, colon)
      const [o3] = await convertOk('to-flac', [colon])
      expect(basename(o3!)).toBe('http:evil.flac')
    }

    const png = await pngWithAlpha(join(d, 'p.png'))
    const dashPng = join(d, '-y.png')
    await copyFile(png, dashPng)
    const [o4] = await convertOk('to-jpg', [dashPng])
    expect(basename(o4!)).toBe('-y.jpg')

    const bmp = await bmpImage(join(d, 'plain.bmp'))
    const pctBmp = join(d, 'p%03d.bmp')
    await copyFile(bmp, pctBmp)
    const [o5] = await convertOk('to-png', [pctBmp])
    expect((await sharp(o5!).metadata()).format).toBe('png')
  })

  it('GIF (two-pass, palette input) works inside a folder whose name contains "%"', async () => {
    const d = await sub('100% fun %d')
    const mp4 = await videoFile(join(d, 'v.mp4'), { seconds: 1 })
    const [out] = await convertOk('to-gif', [mp4])
    expect((await readFile(out!)).subarray(0, 4).toString('latin1')).toBe('GIF8')
  })
})

// --- SEC-43: special files -------------------------------------------------------------------

describe.skipIf(!posix)('special files', () => {
  it('a FIFO input is refused (INPUT_INVALID) within 1 s', async () => {
    const d = await sub('fifo')
    const f = join(d, 'pipe.mp3')
    execFileSync('mkfifo', [f])
    const t0 = Date.now()
    const res = await runOption('to-wav', [f])
    expect(res.error?.code).toBe('INPUT_INVALID')
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  it('a symlink to a FIFO is refused too; a symlink to a regular file works', async () => {
    const d = await sub('fifo-link')
    const f = join(d, 'pipe')
    execFileSync('mkfifo', [f])
    await symlink(f, join(d, 'link.png'))
    expect((await runOption('to-jpg', [join(d, 'link.png')])).error?.code).toBe('INPUT_INVALID')
    const png = await pngWithAlpha(join(d, 'real.png'))
    await symlink(png, join(d, 'alias.png'))
    const [out] = await convertOk('to-jpg', [join(d, 'alias.png')])
    expect(basename(out!)).toBe('alias.jpg')
  })

  it('zipping a folder skips FIFOs and does not follow a symlink to "/"', async () => {
    const d = await sub('zipme')
    const folder = join(d, 'Stuff')
    await mkdir(folder)
    await writeFile(join(folder, 'a.txt'), 'a')
    execFileSync('mkfifo', [join(folder, 'fifo')])
    await symlink('/', join(folder, 'root'))
    const [out] = await convertOk('zip', [folder])
    expect((await stat(out!)).size).toBeLessThan(4096)
    const yauzl = await import('yauzl')
    const zip = await yauzl.openPromise(out!)
    const names: string[] = []
    for await (const e of zip.eachEntry()) names.push(e.fileName)
    zip.close()
    expect(names).toEqual(['Stuff/a.txt'])
  })
})

// --- SEC-90/91: YAML, XLSX, DOCX ----------------------------------------------------------------

describe('data and office documents', () => {
  it('a YAML alias bomb → INPUT_INVALID quickly', async () => {
    const lines = ['a: &a ["x","x","x","x","x","x","x","x","x","x"]']
    const names = 'bcdefghijklmnopqrstuvwxyz'
    let prev = 'a'
    for (const n of names) {
      lines.push(`${n}: &${n} [${Array(10).fill(`*${prev}`).join(',')}]`)
      prev = n
    }
    const f = await textFile(join(await sub('yaml'), 'bomb.yaml'), lines.join('\n') + '\n')
    const t0 = Date.now()
    const res = await runOption('to-json', [f])
    expect(res.error?.code).toBe('INPUT_INVALID')
    expect(Date.now() - t0).toBeLessThan(3000)
  })

  it('YAML with more than 100 aliases is refused; a few aliases are fine', async () => {
    const d = await sub('yaml2')
    const many = ['base: &b {k: 1}', ...Array.from({ length: 101 }, (_, i) => `i${i}: *b`)].join('\n') + '\n'
    const res = await runOption('to-json', [await textFile(join(d, 'many.yaml'), many)])
    expect(res.error?.code).toBe('INPUT_INVALID')
    expect(res.error?.message).toMatch(/YAML bomb/)
    const few = ['base: &b {k: 1}', 'x: *b', 'y: *b'].join('\n') + '\n'
    const [out] = await convertOk('to-json', [await textFile(join(d, 'few.yaml'), few)])
    expect(JSON.parse(await readFile(out!, 'utf8'))).toEqual({ base: { k: 1 }, x: { k: 1 }, y: { k: 1 } })
  })

  it('an XLSX zip bomb (declared size) → INPUT_INVALID before exceljs runs', async () => {
    const f = join(await sub('xlsx-bomb'), 'bomb.xlsx')
    await writeFile(f, officeZip('xlsx', [{ name: 'xl/worksheets/sheet1.xml', data: 'x', method: 8, declaredSize: MAX_OOXML_TOTAL_BYTES + 1 }]))
    const t0 = Date.now()
    const res = await runOption('to-csv', [f])
    expect(res.error?.code).toBe('INPUT_INVALID')
    expect(res.error?.message).toMatch(/zip bomb/)
    expect(Date.now() - t0).toBeLessThan(3000)
  })

  it('pre-scan counts REAL bytes: a lying entry or one over the cap is refused', async () => {
    const d = await sub('scan')
    const zeros = Buffer.alloc(4 * MB)
    const lying = join(d, 'lying.xlsx')
    await writeFile(lying, officeZip('xlsx', [{ name: 'xl/worksheets/sheet1.xml', data: zeros, method: 8, declaredSize: 10 }]))
    await expect(scanZipContainer(lying, 'Excel file', new AbortController().signal)).rejects.toMatchObject({ code: 'INPUT_INVALID' })
    const big = join(d, 'big.xlsx')
    await writeFile(big, officeZip('xlsx', [{ name: 'xl/worksheets/sheet1.xml', data: zeros, method: 8 }]))
    await expect(scanZipContainer(big, 'Excel file', new AbortController().signal, { maxEntries: 100, maxTotalBytes: MB })).rejects.toMatchObject({
      code: 'INPUT_INVALID'
    })
    const ok = await scanZipContainer(big, 'Excel file', new AbortController().signal)
    expect(ok.totalBytes).toBeGreaterThanOrEqual(4 * MB)
  })

  it('an XLSX without a workbook, and an HTML file renamed .docx → INPUT_INVALID', async () => {
    const d = await sub('fake-office')
    const noWb = join(d, 'nowb.xlsx')
    await writeFile(noWb, rawZip([{ name: 'hello.txt', data: 'hi' }]))
    expect((await runOption('to-csv', [noWb])).error?.code).toBe('INPUT_INVALID')
    const html = await textFile(join(d, 'page.docx'), '<html><body><p>hi</p></body></html>')
    expect((await runOption('to-txt', [html])).error?.code).toBe('INPUT_INVALID')
    const bomb = join(d, 'bomb.docx')
    await writeFile(bomb, officeZip('docx', [{ name: 'word/media/big.bin', data: 'x', method: 8, declaredSize: MAX_OOXML_TOTAL_BYTES + 1 }]))
    expect((await runOption('to-md', [bomb])).error?.code).toBe('INPUT_INVALID')
  })
})

// --- SEC-71: PDFs -----------------------------------------------------------------------------

describe('pdf', () => {
  it('a text file renamed .pdf → INPUT_INVALID; a merge names the bad file', async () => {
    const d = await sub('fake-pdf')
    const fake = await textFile(join(d, 'fake.pdf'), 'hello, not a pdf')
    expect((await runOption('to-txt', [fake])).error?.code).toBe('INPUT_INVALID')
    const good = await pdfFile(join(d, 'good.pdf'), 1)
    const res = await runOption('pdf-merge', [good, fake])
    expect(res.error?.code).toBe('INPUT_INVALID')
    expect(res.error?.message).toContain('fake.pdf')
  })

  it(`a PDF with more than ${MAX_PDF_PAGES} pages is refused before the host renders anything`, async () => {
    const { PDFDocument } = await import('pdf-lib')
    const doc = await PDFDocument.create()
    for (let i = 0; i <= MAX_PDF_PAGES; i++) doc.addPage([10, 10])
    const f = join(await sub('many-pages'), 'many.pdf')
    await writeFile(f, await doc.save())
    let calls = 0
    const res = await runOption('pdf-to-png', [f], {
      adapters: {
        htmlToPdf: async () => new Uint8Array(),
        renderPdfPages: async () => {
          calls++
          return []
        }
      }
    })
    expect(res.error?.code).toBe('INPUT_INVALID')
    expect(calls).toBe(0)
  })
})

// --- SEC-100…104: unzip ---------------------------------------------------------------------

describe('unzip: names, bombs, modes', () => {
  const root = join(dir || '/tmp', 'dest')

  it('pure name checks (SEC-101 table)', () => {
    const r = '/tmp/dest'
    expect(safeEntryPath(r, '../x', 'linux')).toBeUndefined()
    expect(safeEntryPath(r, '/abs', 'linux')).toBeUndefined()
    expect(safeEntryPath(r, 'C:/x', 'linux')).toBeUndefined()
    expect(safeEntryPath(r, 'a\\..\\..\\b', 'linux')).toBeUndefined()
    expect(safeEntryPath(r, 'a/../../b', 'linux')).toBeUndefined()
    expect(safeEntryPath(r, 'nul\u0000byte', 'linux')).toBeUndefined()
    expect(safeEntryPath(r, 'tab\there', 'linux')).toBeUndefined()
    expect(safeEntryPath(r, `${'x'.repeat(256)}.txt`, 'linux')).toBeUndefined()
    expect(portableComponent('CON.txt')).toBe('_CON.txt')
    expect(portableComponent('com1')).toBe('_com1')
    expect(portableComponent('x:stream')).toBe('x_stream')
    expect(portableComponent('a.')).toBe('a_')
    expect(portableComponent('a ')).toBe('a_')
    expect(portableComponent('console.log')).toBe('console.log')
    const used = new Set<string>()
    expect(basename(dedupeTarget(join(root, 'A.txt'), used))).toBe('A.txt')
    expect(basename(dedupeTarget(join(root, 'a.txt'), used))).toBe('a (1).txt')
    expect(isBombEntry(1024 ** 3, 1024 ** 2)).toBe(true)
    expect(isBombEntry(10 * 1024, 10)).toBe(false) // tiny files may compress a lot
  })

  it('CON / ab:stream / trailing dots / A.txt + a.txt are extracted safely and nothing is overwritten', async () => {
    const d = await sub('names')
    const z = join(d, 'names.zip')
    await writeFile(
      z,
      rawZip([
        { name: 'CON.txt', data: 'con' },
        { name: 'ab:stream', data: 'ads' },
        { name: 'a.', data: 'dot' },
        { name: 'A.txt', data: 'upper' },
        { name: 'a.txt', data: 'lower' },
        { name: 'a.txt', data: 'dup' }
      ])
    )
    const [out] = await convertOk('unzip', [z])
    expect((await readdir(out!)).sort()).toEqual(['A.txt', '_CON.txt', 'a (1).txt', 'a (2).txt', 'a_', 'ab_stream'].sort())
    expect(await readFile(join(out!, 'A.txt'), 'utf8')).toBe('upper')
    expect(await readFile(join(out!, 'a (1).txt'), 'utf8')).toBe('lower')
  })

  it('drive-letter-like, backslash (strictFileNames), control characters and over-long names → INPUT_INVALID, nothing written', async () => {
    for (const [i, name] of ['x:stream', '..\\evil.txt', 'dir\\file.txt', 'bell\u0007.txt', `${'y'.repeat(300)}.txt`].entries()) {
      const d = await sub(`badname${i}`)
      const z = join(d, 'bad.zip')
      await writeFile(z, rawZip([{ name: 'ok.txt', data: 'ok' }, { name, data: 'x' }]))
      const res = await runOption('unzip', [z])
      expect(res.error?.code, name).toBe('INPUT_INVALID')
      expect(await readdir(d)).toEqual(['bad.zip'])
    }
  })

  it('a highly compressed large entry (64 MB of zeros) is refused as a bomb before writing', async () => {
    const d = await sub('ratio')
    const z = join(d, 'zeros.zip')
    await writeFile(z, rawZip([{ name: 'zeros.bin', data: Buffer.alloc(64 * MB), method: 8 }]))
    const res = await runOption('unzip', [z])
    expect(res.error?.code).toBe('INPUT_INVALID')
    expect(res.error?.message).toMatch(/zip bomb/)
    expect(await readdir(d)).toEqual(['zeros.zip'])
  })

  it(`more than ${MAX_ZIP_ENTRIES} entries → INPUT_INVALID`, async () => {
    const d = await sub('many')
    const z = join(d, 'many.zip')
    await writeFile(z, rawZip(Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, i) => ({ name: `f${i}.txt`, data: '' }))))
    expect((await runOption('unzip', [z])).error?.code).toBe('INPUT_INVALID')
    expect(await readdir(d)).toEqual(['many.zip'])
  })

  it.skipIf(!posix)('symlink entries never become symlinks; setuid/exec modes are dropped', async () => {
    const d = await sub('modes')
    const z = join(d, 'm.zip')
    await writeFile(
      z,
      rawZip([
        { name: 'suid.sh', data: '#!/bin/sh\n', unixMode: 0o104777 },
        { name: 'link', data: '/etc/passwd', unixMode: 0o120777 }
      ])
    )
    const [out] = await convertOk('unzip', [z])
    expect(await readdir(out!)).toEqual(['suid.sh'])
    const st = await lstat(join(out!, 'suid.sh'))
    expect(st.isSymbolicLink()).toBe(false)
    expect(st.mode & 0o7777).toBe(0o644 & ~process.umask())
  })
})

// --- SEC-110: never overwrite ------------------------------------------------------------------

describe('output commit', () => {
  it('parallel commits racing for the same name produce distinct files with intact contents', async () => {
    const d = await sub('race')
    await writeFile(join(d, 'out.txt'), 'existing')
    const temps = await Promise.all(
      Array.from({ length: 12 }, async (_, i) => {
        const t = join(d, `.lud-t${i}.tmp`)
        await writeFile(t, `job ${i}`)
        return t
      })
    )
    const finals = await Promise.all(temps.map((t) => commitFile(t, d, 'out.txt')))
    expect(new Set(finals).size).toBe(12)
    expect(await readFile(join(d, 'out.txt'), 'utf8')).toBe('existing')
    const contents = await Promise.all(finals.map((f) => readFile(f, 'utf8')))
    expect(contents.sort()).toEqual(temps.map((_, i) => `job ${i}`).sort())
    expect((await readdir(d)).filter((n) => n.startsWith('.lud-'))).toEqual([])
  })

  it('folders: an existing (even empty) folder is never reused', async () => {
    const d = await sub('dirs')
    await mkdir(join(d, 'photos'))
    const t1 = join(d, '.lud-a.tmp')
    await mkdir(t1)
    await writeFile(join(t1, 'x.txt'), 'x')
    const final = await commitDir(t1, d, 'photos')
    expect(basename(final)).toBe('photos (1)')
    expect(await readdir(join(d, 'photos'))).toEqual([])
    expect(await readFile(join(final, 'x.txt'), 'utf8')).toBe('x')
  })
})

// --- D6/D7, SEC-41/44: errors and limits ----------------------------------------------------------

describe('errors and limits', () => {
  it('tool failures that blame the input become INPUT_INVALID (D6); others stay TOOL_FAILED', () => {
    const ff = (detail: string): unknown => classifyFfmpegFailure(new EngineError('TOOL_FAILED', undefined, detail))
    expect(ff('ffmpeg exited with 1: [mov] moov atom not found')).toMatchObject({ code: 'INPUT_INVALID' })
    expect(ff('ffmpeg exited with 1: Invalid data found when processing input')).toMatchObject({ code: 'INPUT_INVALID' })
    expect(ff('ffmpeg exited with 1: Unknown encoder libfoo')).toMatchObject({ code: 'TOOL_FAILED' })
    expect(sharpError(new Error('Input image exceeds pixel limit'))).toMatchObject({ code: 'INPUT_INVALID' })
    expect(sharpError(new Error('vipspng: libpng read error'))).toMatchObject({ code: 'INPUT_INVALID' })
    expect(sharpError(new Error('Input buffer contains unsupported image format'))).toMatchObject({ code: 'INPUT_INVALID' })
    expect(sharpError(new Error('unix error: No space left on device'))).toMatchObject({ code: 'OUTPUT_NOT_WRITABLE' })
    expect(sharpError(new Error('something odd'))).toMatchObject({ code: 'TOOL_FAILED' })
  })

  it('messages are one line, ≤ 200 chars; details ≤ 4 KB', () => {
    const e = toJobError(new EngineError('INPUT_INVALID', `${'very '.repeat(80)}\nlong`, 'd'.repeat(10_000)))
    expect(e.message.length).toBeLessThanOrEqual(200)
    expect(e.message).not.toMatch(/\n/)
    expect(e.detail!.length).toBeLessThanOrEqual(4096)
    const internal = toJobError(new Error('boom\n    at secret (/x/y.js:1:2)'))
    expect(internal.message).not.toMatch(/at secret/)
  })

  it("a batch 'each' job is all-or-nothing and the message names the failing file", async () => {
    const d = await sub('batch')
    const good = await pngWithAlpha(join(d, 'good.png'))
    const bad = await textFile(join(d, 'bad-file-with-a-rather-long-name-for-testing-purposes.png'), 'nope')
    const res = await runOption('to-jpg', [good, bad])
    expect(res.error?.code).toBe('INPUT_INVALID')
    expect(res.error?.message).toMatch(/^bad-file-with/)
    expect(res.error!.message.length).toBeLessThanOrEqual(200)
    expect((await readdir(d)).sort()).toEqual([basename(bad), 'good.png'].sort())
  })

  it('per-category byte limits are enforced before parsing', () => {
    const item = (name: string, sizeBytes: number): DroppedItem => ({ path: `/x/${name}`, name, ext: name.split('.').pop()!, isDirectory: false, sizeBytes })
    expect(() => assertInputSizes('pdf', [item('a.pdf', MAX_INPUT_BYTES.pdf + 1)])).toThrow(/larger than/)
    expect(() => assertInputSizes('pdf', [item('a.pdf', 1000)])).not.toThrow()
    expect(() => assertInputSizes('video', [item('a.mp4', 50 * 1024 ** 3)])).not.toThrow()
  })
})

// --- SEC-120/121, D10: model download --------------------------------------------------------

describe('model download', () => {
  const body = Buffer.from('pretend model bytes '.repeat(50))
  const sha = createHash('sha256').update(body).digest('hex')
  const base = { env: {}, sha256: sha, sizeBytes: body.length }

  it('upstream rembg release first, our (unpublished) mirror only second; https + GitHub hosts only', () => {
    expect(MODEL_URLS).toEqual([MODEL_UPSTREAM_URL, MODEL_MIRROR_URL])
    expect(MODEL_UPSTREAM_URL).toMatch(/^https:\/\/github\.com\/danielgatis\/rembg\/releases\//)
    expect(isAllowedModelUrl(MODEL_UPSTREAM_URL)).toBe(true)
    expect(isAllowedModelUrl('https://release-assets.githubusercontent.com/x')).toBe(true)
    expect(isAllowedModelUrl('http://github.com/x')).toBe(false)
    expect(isAllowedModelUrl('https://evil.example/x')).toBe(false)
    expect(isAllowedModelUrl('https://github.com.evil.example/x')).toBe(false)
    expect(isAllowedModelUrl('https://user:pw@github.com/x')).toBe(false)
  })

  it('follows a redirect to an allowed host; refuses one to any other host', async () => {
    resetModelCacheState()
    const seen: string[] = []
    const fetchImpl = (async (u: string | URL | Request) => {
      const url = String(u)
      seen.push(url)
      if (url === 'https://github.com/a') return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/blob' } })
      if (url === 'https://github.com/b') return new Response(null, { status: 302, headers: { location: 'https://evil.example/blob' } })
      return new Response(body, { status: 200 })
    }) as typeof fetch
    const ok = await ensureModel({ ...base, cacheDir: join(dir, 'm-redirect-ok'), signal: new AbortController().signal, fetchImpl, urls: ['https://github.com/a'] })
    expect(await readFile(ok)).toEqual(body)
    expect(seen).toEqual(['https://github.com/a', 'https://release-assets.githubusercontent.com/blob'])
    seen.length = 0
    await expect(
      ensureModel({ ...base, cacheDir: join(dir, 'm-redirect-bad'), signal: new AbortController().signal, fetchImpl, urls: ['https://github.com/b'] })
    ).rejects.toMatchObject({ code: 'MODEL_DOWNLOAD_FAILED' })
    expect(seen).toEqual(['https://github.com/b']) // the evil host was never contacted
  })

  it('a 404 source is skipped at once; more bytes than the pinned size are refused', async () => {
    resetModelCacheState()
    const fetchImpl = (async (u: string | URL | Request) => {
      if (String(u).endsWith('/missing')) return new Response('Not Found', { status: 404 })
      return new Response(Buffer.concat([body, Buffer.from('extra')]), { status: 200 })
    }) as typeof fetch
    const cacheDir = join(dir, 'm-size')
    const t0 = Date.now()
    await expect(
      ensureModel({ ...base, cacheDir, signal: new AbortController().signal, fetchImpl, urls: ['https://github.com/missing', 'https://github.com/toolong'] })
    ).rejects.toMatchObject({ code: 'MODEL_DOWNLOAD_FAILED', detail: expect.stringMatching(/HTTP 404.*more than/) })
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(await readdir(cacheDir)).toEqual([])
  })

  it('concurrent jobs share ONE download, all get progress, and one job leaving does not stop it', async () => {
    resetModelCacheState()
    let calls = 0
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const fetchImpl = (async () => {
      calls++
      await gate
      const half = body.length / 2
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(body.subarray(0, half))
          c.enqueue(body.subarray(half))
          c.close()
        }
      })
      return new Response(stream, { status: 200, headers: { 'content-length': String(body.length) } })
    }) as typeof fetch
    const cacheDir = join(dir, 'm-shared')
    const p1: number[] = []
    const p2: number[] = []
    const leaver = new AbortController()
    const a = ensureModel({ ...base, cacheDir, signal: new AbortController().signal, fetchImpl, urls: ['https://github.com/x'], onProgress: (v) => p1.push(v) })
    const b = ensureModel({ ...base, cacheDir, signal: new AbortController().signal, fetchImpl, urls: ['https://github.com/x'], onProgress: (v) => p2.push(v) })
    const c = ensureModel({ ...base, cacheDir, signal: leaver.signal, fetchImpl, urls: ['https://github.com/x'] })
    leaver.abort()
    await expect(c).rejects.toMatchObject({ code: 'CANCELLED' })
    release()
    const [pa, pb] = await Promise.all([a, b])
    expect(pa).toBe(pb)
    expect(calls).toBe(1)
    expect(p1.at(-1)).toBe(1)
    expect(p2.at(-1)).toBe(1)
  })

  it('leftover .part files are cleaned; a stalled download fails instead of hanging', async () => {
    resetModelCacheState()
    const cacheDir = join(dir, 'm-stall')
    await mkdir(cacheDir, { recursive: true })
    await writeFile(join(cacheDir, 'isnet-general-use.onnx.dead.part'), 'old')
    const fetchImpl = (async () => new Response(new ReadableStream({ start() {} }), { status: 200 })) as typeof fetch
    await expect(
      ensureModel({ ...base, cacheDir, signal: new AbortController().signal, fetchImpl, urls: ['https://github.com/slow'], stallTimeoutMs: 150 })
    ).rejects.toMatchObject({ code: 'MODEL_DOWNLOAD_FAILED', detail: expect.stringMatching(/stalled/) })
    expect(await readdir(cacheDir)).toEqual([])
  })

  it('a server that never answers hits the connect timeout', async () => {
    resetModelCacheState()
    const fetchImpl = ((_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof fetch
    await expect(
      ensureModel({ ...base, cacheDir: join(dir, 'm-connect'), signal: new AbortController().signal, fetchImpl, urls: ['https://github.com/void'], connectTimeoutMs: 150 })
    ).rejects.toMatchObject({ code: 'MODEL_DOWNLOAD_FAILED' })
  })
})
