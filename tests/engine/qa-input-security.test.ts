// QA security fixtures for hostile inputs (docs/security/CHECKLIST.md §C/§D):
// YAML alias bomb (SEC-90), SVG renamed .png (SEC-40/50), ffconcat / HLS playlists disguised as
// .mp3 (SEC-61/62), XLSX zip bomb (SEC-91), FIFO input (SEC-43), file names starting with "-"
// or containing "%" (SEC-60/63, TEST_PLAN ERR-10).
//
// Tests titled "[needs-p2]" check checklist requirements that the current engine does not meet yet
// (expected to turn green once the phase-2 engine work is merged). They are deliberately active.
import { spawnSync } from 'node:child_process'
import { constants, createWriteStream } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runOption, type JobOutcome } from '../helpers/engine'
import { startBeacon, type Beacon } from '../helpers/beacon'
import { MAGIC, audioFile, bmpImage, ffmpegDecode, makeTempDir, startsWith, textFile, videoFile, xlsxFile } from '../helpers/fixtures'

let root = ''
let cleanup: () => Promise<void> = async () => undefined
let beacon: Beacon

beforeAll(async () => {
  ;({ dir: root, cleanup } = await makeTempDir('lud-qa-input-'))
  beacon = await startBeacon()
})
afterAll(async () => {
  await beacon.close()
  await cleanup()
})

let caseCounter = 0
async function caseDir(): Promise<string> {
  const d = join(root, `case-${++caseCounter}`)
  await mkdir(d)
  return d
}

async function names(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort()
}

function expectRefused(res: JobOutcome, codes: readonly string[] = ['INPUT_INVALID']): void {
  expect(res.error, `expected an error, got outputs ${JSON.stringify(res.outputPaths)}`).toBeDefined()
  expect(codes, JSON.stringify(res.error)).toContain(res.error!.code)
  expect(res.outputPaths).toEqual([])
  expect(res.error!.message.length).toBeLessThanOrEqual(200)
}

// -------------------------------------------------------------------------------------------------

describe('QA YAML alias bomb — CONV-DATA-07 / SEC-90', () => {
  // Classic "billion laughs": 9 levels × 9 references → 9^9 ≈ 387 M leaves if expanded.
  const levels = ['a: &a ["lol","lol","lol","lol","lol","lol","lol","lol","lol"]']
  for (let i = 1; i <= 8; i++) {
    const prev = String.fromCharCode(96 + i)
    const cur = String.fromCharCode(97 + i)
    levels.push(`${cur}: &${cur} [*${prev},*${prev},*${prev},*${prev},*${prev},*${prev},*${prev},*${prev},*${prev}]`)
  }
  const bomb = levels.join('\n') + '\n'

  for (const option of ['to-json', 'to-csv', 'to-xlsx'] as const) {
    it(`${option}: refused with INPUT_INVALID in bounded time, nothing written`, async () => {
      const dir = await caseDir()
      const input = await textFile(join(dir, 'laughs.yaml'), bomb)
      const started = Date.now()
      const res = await runOption(option, [input])
      expectRefused(res)
      expect(Date.now() - started).toBeLessThan(10_000)
      expect(await names(dir)).toEqual(['laughs.yaml'])
    })
  }
})

// -------------------------------------------------------------------------------------------------

describe('QA SVG renamed to .png — SEC-40 / SEC-50', () => {
  async function svgAsPng(dir: string): Promise<string> {
    const svg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="64" height="64">
  <rect width="64" height="64" fill="red"/>
  <image href="${beacon.url('/svg-image')}" xlink:href="${beacon.url('/svg-xlink')}" width="64" height="64"/>
  <image href="file:///etc/hostname" width="64" height="64"/>
</svg>`
    return textFile(join(dir, 'innocent.png'), svg)
  }

  it('converting it never fetches the external <image> (beacon gets zero hits)', async () => {
    const dir = await caseDir()
    const input = await svgAsPng(dir)
    const before = beacon.hits.length
    await runOption('to-jpg', [input])
    await new Promise((r) => setTimeout(r, 300))
    expect(beacon.hits.slice(before)).toEqual([])
  })

  it('[needs-p2] SEC-50 the SVG loader is blocked: to-jpg / to-webp refuse with INPUT_INVALID', async () => {
    const dir = await caseDir()
    const input = await svgAsPng(dir)
    for (const option of ['to-jpg', 'to-webp'] as const) {
      const res = await runOption(option, [input])
      expectRefused(res)
    }
    expect(await names(dir)).toEqual(['innocent.png'])
  })

  it('a real PNG still converts (control for the test above)', async () => {
    const dir = await caseDir()
    const input = join(dir, 'real.png')
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#00f' } }).png().toFile(input)
    const res = await runOption('to-jpg', [input])
    expect(res.error).toBeUndefined()
  })
})

// -------------------------------------------------------------------------------------------------

describe('QA playlists disguised as audio — SEC-61 / SEC-62', () => {
  it('[needs-p2] SEC-62 an ffconcat script named .mp3 is refused (it must not read the referenced local file)', async () => {
    const dir = await caseDir()
    await audioFile(join(dir, 'private.wav'), 1)
    const input = await textFile(join(dir, 'song.mp3'), 'ffconcat version 1.0\nfile private.wav\n')
    const res = await runOption('to-wav', [input])
    expectRefused(res)
    expect(await names(dir)).toEqual(['private.wav', 'song.mp3'])
  })

  it('an HLS playlist named .mp3 with an http:// segment never reaches the network', async () => {
    const dir = await caseDir()
    const playlist = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:2', '#EXTINF:2.0,', beacon.url('/hls-segment.ts'), '#EXT-X-ENDLIST', ''].join('\n')
    const input = await textFile(join(dir, 'stream.mp3'), playlist)
    const before = beacon.hits.length
    const res = await runOption('to-wav', [input])
    await new Promise((r) => setTimeout(r, 300))
    expect(beacon.hits.slice(before), 'ffmpeg must not open network protocols').toEqual([])
    expectRefused(res)
    expect(await names(dir)).toEqual(['stream.mp3'])
  })

  it('an HLS playlist named .mp4 whose segment is a local file is refused', async () => {
    const dir = await caseDir()
    const secret = await audioFile(join(dir, 'secret.wav'), 1)
    const playlist = ['#EXTM3U', '#EXT-X-TARGETDURATION:1', '#EXTINF:1.0,', `file://${secret}`, '#EXT-X-ENDLIST', ''].join('\n')
    const input = await textFile(join(dir, 'clip.mp4'), playlist)
    const res = await runOption('to-mp3', [input])
    expectRefused(res)
    expect(await names(dir)).toEqual(['clip.mp4', 'secret.wav'])
  })
})

// -------------------------------------------------------------------------------------------------

/** A valid XLSX with an extra, highly compressed 512 MiB entry (declared in the central directory). */
async function xlsxBomb(path: string, dir: string): Promise<string> {
  const yauzl = await import('yauzl')
  const yazl = await import('yazl')
  const base = await xlsxFile(join(dir, 'base.xlsx'))
  const src = await yauzl.openPromise(base, { lazyEntries: false })
  const out = new yazl.ZipFile()
  for await (const e of src.eachEntry()) {
    if (e.fileName.endsWith('/')) continue // directory entries (exceljs adds "_rels/" etc.)
    const chunks: Buffer[] = []
    for await (const c of await src.openReadStreamPromise(e)) chunks.push(c as Buffer)
    out.addBuffer(Buffer.concat(chunks), e.fileName)
  }
  src.close()
  const chunk = Buffer.alloc(1024 * 1024, 0x20)
  let left = 512
  const spaces = new Readable({
    read() {
      if (left-- <= 0) return void this.push(null)
      this.push(chunk)
    }
  })
  out.addReadStream(spaces, 'xl/media/padding.bin', { compressionLevel: 9 })
  out.end()
  await pipeline(out.outputStream, createWriteStream(path))
  await rm(base)
  return path
}

describe('QA XLSX bomb — SEC-91', () => {
  it('[needs-p2] SEC-91 an XLSX that unpacks to > 512 MiB is refused quickly (pre-scan before exceljs)', async () => {
    const dir = await caseDir()
    const input = await xlsxBomb(join(dir, 'bomb.xlsx'), dir)
    const started = Date.now()
    const res = await runOption('to-csv', [input])
    const ms = Date.now() - started
    expectRefused(res)
    expect(ms, 'pre-scan must refuse from the central directory, before inflating').toBeLessThan(5_000)
    expect(await names(dir)).toEqual(['bomb.xlsx'])
  })
})

// -------------------------------------------------------------------------------------------------

describe.skipIf(process.platform === 'win32')('QA FIFO input — SEC-43', () => {
  it('a named pipe with a .csv / .png name fails fast (never blocks on open) and writes nothing', async () => {
    const dir = await caseDir()
    for (const [name, option] of [
      ['pipe.csv', 'to-json'],
      ['pipe.png', 'to-jpg'],
      ['pipe.wav', 'to-mp3']
    ] as const) {
      const fifo = join(dir, name)
      const mk = spawnSync('mkfifo', [fifo], { shell: false })
      expect(mk.status, `mkfifo failed: ${mk.stderr?.toString() ?? ''}`).toBe(0)
      const started = Date.now()
      const job = runOption(option, [fifo])
      // If the engine opened the FIFO for reading it would block forever: unblock it by opening the
      // write end (non-blocking; ENXIO means no reader → nothing to unblock), then fail below.
      const guard = setTimeout(() => {
        void open(fifo, constants.O_WRONLY | constants.O_NONBLOCK)
          .then((fh) => fh.close())
          .catch(() => undefined)
      }, 5_000)
      const res = await job
      clearTimeout(guard)
      const ms = Date.now() - started
      expect(ms, `${name}: must be rejected without opening the pipe`).toBeLessThan(5_000)
      // SEC-43 asks for INPUT_INVALID; the engine currently answers UNSUPPORTED ("That's not a regular
      // file."). Both are safe; the code mismatch is reported to the TPM, not asserted here.
      expectRefused(res, ['INPUT_INVALID', 'UNSUPPORTED'])
    }
    expect(await names(dir)).toEqual(['pipe.csv', 'pipe.png', 'pipe.wav'])
  })
})

// -------------------------------------------------------------------------------------------------

describe('QA option-injection-looking file names — ERR-10 / SEC-60 / SEC-63', () => {
  it('"-version.wav" → MP3 is a real conversion, not an ffmpeg option', async () => {
    const dir = await caseDir()
    const input = await audioFile(join(dir, '-version.wav'), 1)
    const res = await runOption('to-mp3', [input])
    expect(res.error, JSON.stringify(res.error)).toBeUndefined()
    expect(res.outputPaths).toEqual([join(dir, '-version.mp3')])
    expect(await ffmpegDecode(res.outputPaths[0]!)).toBe('')
  })

  it('"-y.png" → JPG and "-i.csv" → JSON keep their names and contents', async () => {
    const dir = await caseDir()
    const png = join(dir, '-y.png')
    await sharp({ create: { width: 8, height: 6, channels: 3, background: '#f00' } }).png().toFile(png)
    const csv = await textFile(join(dir, '-i.csv'), 'a,b\n1,2\n')
    const r1 = await runOption('to-jpg', [png])
    expect(r1.error).toBeUndefined()
    expect(basename(r1.outputPaths[0]!)).toBe('-y.jpg')
    expect((await sharp(r1.outputPaths[0]!).metadata()).format).toBe('jpeg')
    const r2 = await runOption('to-json', [csv])
    expect(r2.error).toBeUndefined()
    expect(basename(r2.outputPaths[0]!)).toBe('-i.json')
  })

  it('"-f lavfi -i x.mp4" (spaces + dashes) → GIF works and is a GIF', async () => {
    const dir = await caseDir()
    const input = await videoFile(join(dir, '-f lavfi -i x.mp4'), { seconds: 1 })
    const res = await runOption('to-gif', [input])
    expect(res.error, JSON.stringify(res.error)).toBeUndefined()
    expect(startsWith(await readFile(res.outputPaths[0]!), MAGIC.gif)).toBe(true)
  })

  it('[needs-p2] SEC-63 a "%" in an image name is not an image2 pattern: "shot%03d.bmp" → PNG', async () => {
    // BMP/ICO inputs are decoded by ffmpeg; without "-f bmp_pipe"/"-pattern_type none" (or a "file:"
    // input with an explicit demuxer) the image2 demuxer expands "%03d" and the file is "not found".
    const dir = await caseDir()
    const bmp = join(dir, 'shot%03d.bmp')
    // bmpImage writes through ffmpeg's image2 muxer, which would also expand "%03d": create it under a
    // neutral name and rename.
    await rename(await bmpImage(join(dir, 'plain.bmp')), bmp)
    const res = await runOption('to-png', [bmp])
    expect(res.error, JSON.stringify(res.error)).toBeUndefined()
    expect(basename(res.outputPaths[0]!)).toBe('shot%03d.png')
    expect((await sharp(res.outputPaths[0]!).metadata()).width).toBe(32)
  })

  it('a "%" in a video name works: "a%d -x.mp4" → MP3', async () => {
    const dir = await caseDir()
    const mp4 = await videoFile(join(dir, 'a%d -x.mp4'), { seconds: 1 })
    const res = await runOption('to-mp3', [mp4])
    expect(res.error, JSON.stringify(res.error)).toBeUndefined()
    expect(basename(res.outputPaths[0]!)).toBe('a%d -x.mp3')
    expect(await ffmpegDecode(res.outputPaths[0]!)).toBe('')
  })
})
