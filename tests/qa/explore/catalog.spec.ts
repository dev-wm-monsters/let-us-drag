// QA phase 3b: every option of docs/PLAN.md §5 converted through the overlay flow of the real app
// (Playwright _electron + __ludTest.dropFiles) and validated independently. Results are recorded in
// test-results/qa-explore/results.jsonl and summarised in docs/qa/QA_REPORT.md.
import type { ElectronApplication, TestInfo } from '@playwright/test'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import type { OptionId } from '../../../src/shared/types'
import { expect, test } from '../../e2e/support/app'
import {
  SAMPLE_CSV, SAMPLE_JSON, SAMPLE_MD, SAMPLE_YAML, bmpImage, docxFile, icoImage, noisyPng, pdfFile, sharpImage, textFile, xlsxFile, zipFile
} from '../../helpers/fixtures'
import { convert, makeAudio, makeVideo, outputs, record, short } from './support'
import {
  alphaStats, docxText, ffmpegDecodeErrors, ffprobe, fps, icoSizes, imageMeta, magic, pdfPages, pdfText, size, xlsxRows, yamlLoad, zipEntries
} from './validate'

type Validate = (outs: string[]) => Promise<string> | string

interface Case {
  id: string
  what: string
  inputs: () => Promise<string[]> | string[]
  option: OptionId
  validate: Validate
}

async function runCases(app: ElectronApplication, testInfo: TestInfo, cases: Case[]): Promise<string[]> {
  const failures: string[] = []
  for (const c of cases) {
    let inputs: string[] = []
    try {
      inputs = await c.inputs()
      const r = await convert(app, testInfo, c.id, inputs, c.option)
      if (r.event.type !== 'done') throw new Error(`job ended with ${JSON.stringify(r.event)}`)
      const ev = await c.validate(outputs(r.event))
      record({ id: c.id, what: c.what, result: 'PASS', evidence: `${ev}; ${r.ms} ms; states ${r.states.join('→')}` })
    } catch (err) {
      const msg = short((err as Error).message.split('\n')[0] ?? String(err), 300)
      failures.push(`${c.id}: ${msg}`)
      record({ id: c.id, what: c.what, result: 'FAIL', evidence: msg })
    }
  }
  return failures
}

const one = (outs: string[]): string => {
  expect(outs).toHaveLength(1)
  return outs[0]!
}

test.describe.configure({ mode: 'serial' })

test('QA-CAT image: every image option + HEIC/BMP/ICO/TIFF/GIF inputs', async ({ lud }, testInfo) => {
  test.setTimeout(15 * 60_000)
  const app = await lud.launchReady()
  const d = (n: string): string => join(lud.workDir, n)
  // Photo-like 2000x1500 JPEG shot "portrait" (EXIF orientation 6) like a phone photo.
  const phone = async (): Promise<string> => {
    const p = d('Phone photo.jpg')
    await sharp(readFileSync(await noisyPng(d('noise-src.png'), 2000, 1500))).jpeg({ quality: 90 }).withMetadata({ orientation: 6 }).toFile(p)
    return p
  }
  const transparentPng = async (): Promise<string> => {
    const p = d('logo.png')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><circle cx="256" cy="256" r="200" fill="#e85d2a"/></svg>`
    await sharp(Buffer.from(svg)).png().toFile(p)
    return p
  }
  const failures = await runCases(app, testInfo, [
    {
      id: 'CAT-IMG-PNG', what: 'Phone JPG (EXIF orientation 6) → PNG', option: 'to-png', inputs: async () => [await phone()],
      validate: async (o) => {
        const m = await imageMeta(one(o))
        expect(m.format).toBe('png')
        // EXIF orientation 6 = rotate 90°: a 2000x1500 sensor image must come out 1500x2000.
        expect(`${m.width}x${m.height}`, 'EXIF orientation must be applied').toBe('1500x2000')
        return `${basename(one(o))} png ${m.width}x${m.height}`
      }
    },
    {
      id: 'CAT-IMG-JPG', what: 'Transparent PNG → JPG', option: 'to-jpg', inputs: async () => [await transparentPng()],
      validate: async (o) => {
        const m = await imageMeta(one(o))
        expect(m.format).toBe('jpeg')
        const { data } = await sharp(one(o)).raw().toBuffer({ resolveWithObject: true })
        return `${basename(one(o))} jpeg ${m.width}x${m.height}, corner rgb ${data[0]},${data[1]},${data[2]} (white expected)`
      }
    },
    {
      id: 'CAT-IMG-WEBP', what: 'PNG → WEBP', option: 'to-webp', inputs: async () => [await noisyPng(d('shot.png'), 800, 600)],
      validate: async (o) => {
        const m = await imageMeta(one(o))
        expect(m.format).toBe('webp')
        return `${basename(one(o))} webp ${m.width}x${m.height} ${size(one(o))} B`
      }
    },
    {
      id: 'CAT-IMG-AVIF', what: 'PNG → AVIF', option: 'to-avif', inputs: async () => [await noisyPng(d('shot2.png'), 800, 600)],
      validate: async (o) => {
        const m = await imageMeta(one(o))
        expect(m.format).toBe('heif')
        expect(m.compression).toBe('av1')
        return `${basename(one(o))} avif(heif/av1) ${m.width}x${m.height}`
      }
    },
    {
      id: 'CAT-IMG-PDF', what: '3 images (jpg, png, webp) → one PDF', option: 'to-pdf',
      inputs: async () => [await sharpImage(d('scan1.jpg'), 1240, 1754), await sharpImage(d('scan2.png'), 1754, 1240), await sharpImage(d('scan3.webp'), 800, 800)],
      validate: (o) => {
        expect(pdfPages(one(o))).toBe(3)
        return `${basename(one(o))} 3 pages (pdfinfo)`
      }
    },
    {
      id: 'CAT-IMG-ICO', what: 'PNG → ICO', option: 'to-ico', inputs: async () => [await transparentPng()],
      validate: (o) => `${basename(one(o))} ICO sizes ${icoSizes(one(o)).join(',')}; ffprobe ${ffprobe(one(o)).streams[0]?.codec_name}`
    },
    {
      id: 'CAT-IMG-COMPRESS', what: 'Big photo PNG → Compress', option: 'compress', inputs: async () => [await noisyPng(d('big shot.png'), 1600, 1200)],
      validate: async (o) => {
        const m = await imageMeta(one(o))
        expect(m.format).toBe('png')
        const before = size(d('big shot.png'))
        return `${basename(one(o))} ${before} → ${size(one(o))} B (${Math.round((100 * size(one(o))) / before)} %)`
      }
    },
    {
      id: 'CAT-IMG-HEIC', what: 'iPhone-style HEIC (HEVC, x265) → JPG', option: 'to-jpg',
      inputs: () => {
        // A real HEVC HEIC (sharp can only write AV1 HEIF); see docs/qa/QA_REPORT.md for how it was made.
        const src = process.env['QA_HEIC']
        if (!src) throw new Error('QA_HEIC not set: no real HEVC .HEIC fixture available')
        const p = d('IMG_0042.HEIC')
        writeFileSync(p, readFileSync(src))
        return [p]
      },
      validate: async (o) => {
        const m = await imageMeta(one(o))
        expect(m.format).toBe('jpeg')
        return `${basename(one(o))} jpeg ${m.width}x${m.height}`
      }
    },
    {
      id: 'CAT-IMG-BMP', what: 'BMP → PNG', option: 'to-png', inputs: async () => [await bmpImage(d('paint.bmp'), 320, 240)],
      validate: async (o) => `${basename(one(o))} ${(await imageMeta(one(o))).format} ${(await imageMeta(one(o))).width}px`
    },
    {
      id: 'CAT-IMG-ICOIN', what: 'ICO → PNG', option: 'to-png', inputs: async () => [await icoImage(d('favicon.ico'), 'png', 64)],
      validate: async (o) => `${basename(one(o))} ${(await imageMeta(one(o))).format} ${(await imageMeta(one(o))).width}px`
    },
    {
      id: 'CAT-IMG-TIFF', what: 'TIFF → JPG', option: 'to-jpg', inputs: async () => [await sharpImage(d('scan.tiff'), 600, 400)],
      validate: async (o) => `${basename(one(o))} ${(await imageMeta(one(o))).format}`
    },
    {
      id: 'CAT-IMG-GIF', what: 'GIF → WEBP', option: 'to-webp', inputs: async () => [await sharpImage(d('meme.gif'), 300, 200)],
      validate: async (o) => `${basename(one(o))} ${(await imageMeta(one(o))).format}`
    }
  ])
  expect(failures, failures.join('\n')).toEqual([])
})

test('QA-CAT video: every video option', async ({ lud }, testInfo) => {
  test.setTimeout(15 * 60_000)
  const app = await lud.launchReady()
  const d = (n: string): string => join(lud.workDir, n)
  const mp4 = makeVideo(d('holiday.mp4'), 6)
  const mov = makeVideo(d('iphone clip.mov'), 4)
  const mkv = makeVideo(d('show.mkv'), 3)
  const avi = makeVideo(d('old.avi'), 3, ['-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame'])
  const failures = await runCases(app, testInfo, [
    {
      id: 'CAT-VID-MP4', what: 'MOV → MP4 (H.264/AAC)', option: 'to-mp4', inputs: () => [mov],
      validate: (o) => {
        const p = ffprobe(one(o))
        const v = p.streams.find((s) => s.codec_type === 'video')
        const a = p.streams.find((s) => s.codec_type === 'audio')
        expect(v?.codec_name).toBe('h264')
        expect(a?.codec_name).toBe('aac')
        expect(ffmpegDecodeErrors(one(o))).toBe('')
        return `${basename(one(o))} h264+aac ${v?.width}x${v?.height} ${Number(p.format.duration).toFixed(2)} s`
      }
    },
    {
      id: 'CAT-VID-MOV', what: 'MP4 → MOV', option: 'to-mov', inputs: () => [mp4],
      validate: (o) => {
        const p = ffprobe(one(o))
        expect(p.format.format_name).toContain('mov')
        return `${basename(one(o))} ${p.streams.map((s) => s.codec_name).join('+')} ${Number(p.format.duration).toFixed(2)} s`
      }
    },
    {
      id: 'CAT-VID-WEBM', what: 'MKV → WEBM (VP9/Opus)', option: 'to-webm', inputs: () => [mkv],
      validate: (o) => {
        const p = ffprobe(one(o))
        expect(p.streams.map((s) => s.codec_name).sort()).toEqual(['opus', 'vp9'])
        return `${basename(one(o))} vp9+opus ${Number(p.format.duration).toFixed(2)} s`
      }
    },
    {
      id: 'CAT-VID-GIF', what: 'MP4 → GIF (≤15 fps, ≤480 px)', option: 'to-gif', inputs: () => [mp4],
      validate: (o) => {
        const v = ffprobe(one(o)).streams[0]!
        expect(v.codec_name).toBe('gif')
        expect(v.width!).toBeLessThanOrEqual(480)
        expect(fps(v.avg_frame_rate)).toBeLessThanOrEqual(15.01)
        return `${basename(one(o))} gif ${v.width}x${v.height} ${fps(v.avg_frame_rate).toFixed(1)} fps ${size(one(o))} B`
      }
    },
    {
      id: 'CAT-VID-MP3', what: 'AVI (mpeg4+mp3) → MP3 audio', option: 'to-mp3', inputs: () => [avi],
      validate: (o) => {
        const p = ffprobe(one(o))
        expect(p.streams.map((s) => s.codec_name)).toEqual(['mp3'])
        return `${basename(one(o))} mp3 ${Number(p.format.duration).toFixed(2)} s`
      }
    },
    {
      id: 'CAT-VID-WAV', what: 'MP4 → WAV audio', option: 'to-wav', inputs: () => [mp4],
      validate: (o) => {
        const p = ffprobe(one(o))
        expect(p.streams[0]?.codec_name).toMatch(/^pcm_/)
        return `${basename(one(o))} ${p.streams[0]?.codec_name} ${Number(p.format.duration).toFixed(2)} s`
      }
    },
    {
      id: 'CAT-VID-COMPRESS', what: 'MP4 → Compress (H.264 CRF 28)', option: 'compress', inputs: () => [mp4],
      validate: (o) => {
        const p = ffprobe(one(o))
        expect(ffmpegDecodeErrors(one(o))).toBe('')
        return `${basename(one(o))} ${p.streams.map((s) => s.codec_name).join('+')} ${size(mp4)} → ${size(one(o))} B`
      }
    }
  ])
  expect(failures, failures.join('\n')).toEqual([])
})

test('QA-CAT audio: every audio option', async ({ lud }, testInfo) => {
  test.setTimeout(10 * 60_000)
  const app = await lud.launchReady()
  const d = (n: string): string => join(lud.workDir, n)
  const flac = makeAudio(d('song.flac'), 5)
  const wav = makeAudio(d('memo.wav'), 5)
  const m4a = makeAudio(d('voice.m4a'), 5, ['-c:a', 'aac'])
  const opus = makeAudio(d('call.opus'), 5, ['-c:a', 'libopus'])
  const mp3 = makeAudio(d('podcast.mp3'), 30, ['-c:a', 'libmp3lame', '-b:a', '320k'])
  const codec = (o: string[], want: string | RegExp): string => {
    const p = ffprobe(one(o))
    expect(p.streams[0]?.codec_name).toMatch(want)
    expect(ffmpegDecodeErrors(one(o))).toBe('')
    return `${basename(one(o))} ${p.streams[0]?.codec_name} ${Number(p.format.duration).toFixed(2)} s`
  }
  const failures = await runCases(app, testInfo, [
    { id: 'CAT-AUD-MP3', what: 'FLAC → MP3', option: 'to-mp3', inputs: () => [flac], validate: (o) => codec(o, 'mp3') },
    { id: 'CAT-AUD-WAV', what: 'M4A → WAV', option: 'to-wav', inputs: () => [m4a], validate: (o) => codec(o, /^pcm_/) },
    { id: 'CAT-AUD-M4A', what: 'WAV → M4A', option: 'to-m4a', inputs: () => [wav], validate: (o) => codec(o, 'aac') },
    { id: 'CAT-AUD-OGG', what: 'OPUS → OGG', option: 'to-ogg', inputs: () => [opus], validate: (o) => codec(o, /vorbis|opus/) },
    { id: 'CAT-AUD-FLAC', what: 'WAV → FLAC', option: 'to-flac', inputs: () => [wav], validate: (o) => codec(o, 'flac') },
    {
      id: 'CAT-AUD-COMPRESS', what: 'MP3 320k → Compress (MP3 128k)', option: 'compress', inputs: () => [mp3],
      validate: (o) => `${codec(o, 'mp3')}; ${size(mp3)} → ${size(one(o))} B`
    }
  ])
  expect(failures, failures.join('\n')).toEqual([])
})

test('QA-CAT pdf/document/text: every option', async ({ lud }, testInfo) => {
  test.setTimeout(10 * 60_000)
  const app = await lud.launchReady()
  const d = (n: string): string => join(lud.workDir, n)
  const pdf3 = await pdfFile(d('contract.pdf'), 3, 'Contract page')
  const pdf2 = await pdfFile(d('annex.pdf'), 2, 'Annex page')
  const docx = await docxFile(d('Quarterly report.docx'))
  const md = await textFile(d('notes.md'), `${SAMPLE_MD}\nUnicode: Ünïcødé — 日本語 — emoji 🎉\n`)
  const html = await textFile(d('page.html'), '<!doctype html><html><head><title>T</title></head><body><h1>Hello HTML</h1><p>Para with <b>bold</b>.</p><ul><li>apple</li><li>banana</li></ul></body></html>')
  const txt = await textFile(d('readme.txt'), 'Plain text line one\nLine two with Ünïcødé\n')
  const pagesOk = (o: string[], ext: string, n: number): string => {
    const dir = one(o)
    expect(statSync(dir).isDirectory()).toBe(true)
    const files = readdirSync(dir).sort()
    expect(files).toHaveLength(n)
    for (const f of files) expect(f.endsWith(`.${ext}`)).toBe(true)
    return `${basename(dir)}/ {${files.join(', ')}} magic ${magic(join(dir, files[0]!), 4)}`
  }
  const failures = await runCases(app, testInfo, [
    { id: 'CAT-PDF-PNG', what: '3-page PDF → PNG pages', option: 'pdf-to-png', inputs: () => [pdf3], validate: (o) => pagesOk(o, 'png', 3) },
    { id: 'CAT-PDF-JPG', what: '3-page PDF → JPG pages', option: 'pdf-to-jpg', inputs: () => [pdf3], validate: (o) => pagesOk(o, 'jpg', 3) },
    {
      id: 'CAT-PDF-TXT', what: 'PDF → TXT', option: 'to-txt', inputs: () => [pdf3],
      validate: (o) => {
        const t = readFileSync(one(o), 'utf8')
        expect(t).toContain('Contract page 3')
        return `${basename(one(o))} ${t.length} chars, has "Contract page 1..3"`
      }
    },
    {
      id: 'CAT-PDF-MERGE', what: '3-page + 2-page PDF → Merge', option: 'pdf-merge', inputs: () => [pdf3, pdf2],
      validate: (o) => {
        expect(pdfPages(one(o))).toBe(5)
        expect(pdfText(one(o))).toContain('Annex page 2')
        return `${basename(one(o))} 5 pages (pdfinfo)`
      }
    },
    {
      id: 'CAT-DOC-PDF', what: 'DOCX → PDF', option: 'to-pdf', inputs: () => [docx],
      validate: (o) => {
        const t = pdfText(one(o))
        expect(t).toContain('Quarterly Report')
        expect(t).toContain('North')
        return `${basename(one(o))} ${pdfPages(one(o))} page(s), text has heading + table`
      }
    },
    {
      id: 'CAT-DOC-HTML', what: 'DOCX → HTML', option: 'to-html', inputs: () => [docx],
      validate: (o) => {
        const h = readFileSync(one(o), 'utf8')
        expect(h).toContain('Quarterly Report')
        expect(h).toContain('<table')
        expect(h.toLowerCase()).toContain('content-security-policy')
        expect(h.toLowerCase()).not.toContain('<script')
        return `${basename(one(o))} ${h.length} chars, CSP meta, table, no script`
      }
    },
    {
      id: 'CAT-DOC-MD', what: 'DOCX → Markdown', option: 'to-md', inputs: () => [docx],
      validate: (o) => {
        const t = readFileSync(one(o), 'utf8')
        expect(t).toMatch(/^# Quarterly Report/m)
        return `${basename(one(o))}: ${JSON.stringify(t.slice(0, 80))}`
      }
    },
    {
      id: 'CAT-DOC-TXT', what: 'DOCX → TXT', option: 'to-txt', inputs: () => [docx],
      validate: (o) => {
        const t = readFileSync(one(o), 'utf8')
        expect(t).toContain('Revenue was great this time.')
        return `${basename(one(o))}: ${JSON.stringify(t.slice(0, 80))}`
      }
    },
    {
      id: 'CAT-TXT-PDF', what: 'Markdown (unicode + emoji) → PDF', option: 'to-pdf', inputs: () => [md],
      validate: (o) => {
        const t = pdfText(one(o))
        expect(t).toContain('Title')
        expect(t).toContain('Ünïcødé')
        return `${basename(one(o))} ${pdfPages(one(o))} page(s); CJK present: ${t.includes('日本語')}; emoji present: ${t.includes('🎉')}`
      }
    },
    {
      id: 'CAT-TXT-HTML', what: 'Markdown → HTML', option: 'to-html', inputs: () => [md],
      validate: (o) => {
        const h = readFileSync(one(o), 'utf8')
        expect(h).toContain('<h1')
        expect(h).toContain('<table')
        return `${basename(one(o))} ${h.length} chars with h1 + table`
      }
    },
    {
      id: 'CAT-TXT-DOCX', what: 'Markdown → DOCX', option: 'to-docx', inputs: () => [md],
      validate: async (o) => {
        const t = await docxText(one(o))
        expect(t).toContain('Title')
        expect(t).toContain('nested')
        return `${basename(one(o))} mammoth text ${t.length} chars`
      }
    },
    {
      id: 'CAT-TXT-TXT', what: 'HTML → TXT', option: 'to-txt', inputs: () => [html],
      validate: (o) => {
        const t = readFileSync(one(o), 'utf8')
        expect(t).toContain('Hello HTML')
        expect(t).not.toContain('<h1')
        return `${basename(one(o))}: ${JSON.stringify(t.slice(0, 80))}`
      }
    },
    {
      id: 'CAT-TXT-HTML2', what: 'TXT → HTML', option: 'to-html', inputs: () => [txt],
      validate: (o) => `${basename(one(o))} contains text: ${readFileSync(one(o), 'utf8').includes('Line two with Ünïcødé')}`
    },
    {
      id: 'CAT-TXT-PDF2', what: 'HTML → PDF', option: 'to-pdf', inputs: () => [html],
      validate: (o) => {
        expect(pdfText(one(o))).toContain('Hello HTML')
        return `${basename(one(o))} ${pdfPages(one(o))} page(s)`
      }
    }
  ])
  expect(failures, failures.join('\n')).toEqual([])
})

test('QA-CAT data/archive/any: every option', async ({ lud }, testInfo) => {
  test.setTimeout(10 * 60_000)
  const app = await lud.launchReady()
  const d = (n: string): string => join(lud.workDir, n)
  const csv = await textFile(d('people.csv'), `${SAMPLE_CSV}"Zoë ""Z"" Ünïc",7,"Line\nbreak"\n`)
  const json = await textFile(d('people.json'), SAMPLE_JSON)
  const yml = await textFile(d('config.yaml'), SAMPLE_YAML)
  const xlsx = await xlsxFile(d('budget.xlsx'), [['item', 'cost'], ['rent', 1200], ['food', 350.5]])
  const zip = await zipFile(d('photos.zip'), { 'a.txt': 'alpha', 'sub/b.txt': 'beta', 'sub/deeper/c.txt': 'gamma' })
  const folder = d('My stuff')
  mkdirSync(join(folder, 'inner'), { recursive: true })
  writeFileSync(join(folder, 'one.txt'), 'one')
  writeFileSync(join(folder, 'inner', 'two.txt'), 'two')
  const png = await noisyPng(d('mixed.png'), 64, 64)
  const mp3 = makeAudio(d('mixed.mp3'), 1, ['-c:a', 'libmp3lame'])
  const failures = await runCases(app, testInfo, [
    {
      id: 'CAT-DAT-JSON', what: 'CSV (quotes, newline in cell, unicode) → JSON', option: 'to-json', inputs: () => [csv],
      validate: (o) => {
        const j = JSON.parse(readFileSync(one(o), 'utf8')) as Record<string, unknown>[]
        expect(j).toHaveLength(3)
        expect(j[2]?.['name']).toBe('Zoë "Z" Ünïc')
        return `${basename(one(o))} ${j.length} rows; row3=${JSON.stringify(j[2])}`
      }
    },
    {
      id: 'CAT-DAT-YAML', what: 'JSON → YAML', option: 'to-yaml', inputs: () => [json],
      validate: (o) => {
        const y = yamlLoad(one(o)) as Record<string, unknown>[]
        expect(y[0]?.['name']).toBe('Ann')
        return `${basename(one(o))} parsed ${JSON.stringify(y).slice(0, 80)}`
      }
    },
    {
      id: 'CAT-DAT-XLSX', what: 'YAML → XLSX', option: 'to-xlsx', inputs: () => [yml],
      validate: async (o) => {
        const rows = await xlsxRows(one(o))
        expect(rows[0]).toEqual(['name', 'age'])
        return `${basename(one(o))} rows ${JSON.stringify(rows)}`
      }
    },
    {
      id: 'CAT-DAT-CSV', what: 'XLSX → CSV', option: 'to-csv', inputs: () => [xlsx],
      validate: (o) => {
        const t = readFileSync(one(o), 'utf8')
        expect(t).toContain('food,350.5')
        return `${basename(one(o))}: ${JSON.stringify(t)}`
      }
    },
    {
      id: 'CAT-ARC-UNZIP', what: 'ZIP (nested folders) → Unzip', option: 'unzip', inputs: () => [zip],
      validate: (o) => {
        const dir = one(o)
        expect(readFileSync(join(dir, 'sub', 'deeper', 'c.txt'), 'utf8')).toBe('gamma')
        return `${basename(dir)}/ has a.txt, sub/b.txt, sub/deeper/c.txt`
      }
    },
    {
      id: 'CAT-ANY-ZIPDIR', what: 'Folder → ZIP', option: 'zip', inputs: () => [folder],
      validate: async (o) => {
        const e = await zipEntries(one(o))
        return `${basename(one(o))} entries ${e.join(', ')}`
      }
    },
    {
      id: 'CAT-ANY-ZIPMIX', what: 'Mixed batch PNG + MP3 → ZIP', option: 'zip', inputs: () => [png, mp3],
      validate: async (o) => {
        const e = await zipEntries(one(o))
        expect(e.sort()).toEqual(['mixed.mp3', 'mixed.png'])
        return `${basename(one(o))} entries ${e.join(', ')}`
      }
    }
  ])
  expect(failures, failures.join('\n')).toEqual([])
})

test('QA-CAT remove-bg with the real ISNet model (LUD_MODEL_PATH)', async ({ lud }, testInfo) => {
  test.setTimeout(10 * 60_000)
  const model = process.env['QA_MODEL_PATH']
  test.skip(!model, 'set QA_MODEL_PATH to the verified isnet-general-use.onnx')
  const app = await lud.launchReady({ env: { LUD_MODEL_PATH: model! } })
  const d = (n: string): string => join(lud.workDir, n)
  const photos = (process.env['QA_PHOTOS'] ?? '').split(',').filter(Boolean)
  const cases: Case[] = photos.map((src, i) => ({
    id: `CAT-IMG-RMBG-${i + 1}`,
    what: `Real photo ${basename(src)} → Remove BG`,
    option: 'remove-bg' as OptionId,
    inputs: () => {
      const p = d(basename(src))
      writeFileSync(p, readFileSync(src))
      return [p]
    },
    validate: async (o: string[]) => {
      const s = await alphaStats(one(o))
      expect(s.hasAlpha).toBe(true)
      expect(s.transparent).toBeGreaterThan(0.1)
      expect(s.transparent).toBeLessThan(0.95)
      return `${basename(one(o))} ${Math.round(s.transparent * 100)} % transparent, corners clear: ${s.cornersClear}`
    }
  }))
  const failures = await runCases(app, testInfo, cases)
  expect(failures, failures.join('\n')).toEqual([])
})
