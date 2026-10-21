// E2E-MEDIA/DATA/ARCHIVE: video → GIF / WEBM through the bundled-or-system ffmpeg, CSV → XLSX,
// and a ZIP → Unzip round trip, all through the real app (overlay drop → engine utilityProcess).
// Test plan IDs: E2E-70..E2E-73 (docs/qa/TEST_PLAN.md §15), CONV-VID-03/04, CONV-DATA-01, CONV-ZIP-01/08.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Workbook } from 'exceljs'
import sharp from 'sharp'
import { ffmpegInfo, videoFile } from '../helpers/fixtures'
import { expect, test } from './support/app'
import { listNames, magic, makePng, resolveFfmpeg, sha256 } from './support/fixtures'
import { convertViaDrop, expectOverlayHidesItself, outputsOf } from './support/flows'
import { expectedOutputPath } from './support/naming'

/** Make sure tests/helpers/fixtures (which reads LUD_FFMPEG_PATH) uses the same ffmpeg as the E2E fixtures. */
function requireFfmpeg(): void {
  const ffmpeg = resolveFfmpeg()
  test.skip(ffmpeg === null, 'ffmpeg not available (set LUD_FFMPEG_PATH or put ffmpeg on PATH)')
  if (!process.env['LUD_FFMPEG_PATH'] && ffmpeg) process.env['LUD_FFMPEG_PATH'] = ffmpeg
}

test.describe('media, data and archive conversions', () => {
  test('E2E-70 MP4 → GIF: animated GIF, ≤ 480 px wide, ≤ 15 fps', async ({ lud }, testInfo) => {
    requireFfmpeg()
    const app = await lud.launchReady()
    const input = await videoFile(join(lud.workDir, 'clip.mp4'), { seconds: 2, size: '640x360' })
    const { event } = await convertViaDrop(app, testInfo, 'mp4-to-gif', [input], 'to-gif')
    expect(event.type, JSON.stringify(event)).toBe('done')
    const out = outputsOf(event)
    expect(out).toEqual([expectedOutputPath(input, 'gif')])
    expect(readFileSync(out[0]!).subarray(0, 4).toString('latin1')).toBe('GIF8')
    const meta = await sharp(out[0]!, { animated: true }).metadata()
    expect(meta.format).toBe('gif')
    expect(meta.width).toBeLessThanOrEqual(480)
    expect(meta.pages ?? 1, 'animated: more than one frame').toBeGreaterThan(1)
    // 2 s at ≤ 15 fps → at most ~30 frames (+1 for rounding).
    expect(meta.pages ?? 1).toBeLessThanOrEqual(31)
  })

  test('E2E-71 MP4 → WEBM: VP9 + Opus in a WebM container', async ({ lud }, testInfo) => {
    requireFfmpeg()
    const app = await lud.launchReady()
    const input = await videoFile(join(lud.workDir, 'movie.mp4'), { seconds: 2 })
    const { event } = await convertViaDrop(app, testInfo, 'mp4-to-webm', [input], 'to-webm')
    expect(event.type, JSON.stringify(event)).toBe('done')
    const out = outputsOf(event)
    expect(out).toEqual([expectedOutputPath(input, 'webm')])
    // EBML magic 1A 45 DF A3
    expect([...readFileSync(out[0]!).subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3])
    const info = await ffmpegInfo(out[0]!)
    expect(info).toMatch(/Video: vp9/)
    expect(info).toMatch(/Audio: opus/)
    expect(info).toMatch(/Duration: 00:00:0[12]\./)
  })

  test('E2E-72 CSV → XLSX: header and rows survive', async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = join(lud.workDir, 'people.csv')
    writeFileSync(input, 'name,age,city\nAnn,31,"Paris, FR"\nBob,42,Berlin\n')
    const { event } = await convertViaDrop(app, testInfo, 'csv-to-xlsx', [input], 'to-xlsx')
    expect(event.type, JSON.stringify(event)).toBe('done')
    const out = outputsOf(event)
    expect(out).toEqual([expectedOutputPath(input, 'xlsx')])
    expect(magic.zip(out[0]!)).toBe(true)
    // Static import: Playwright's loader cannot link exceljs' CommonJS tree through a dynamic import().
    const wb = new Workbook()
    await wb.xlsx.readFile(out[0]!)
    const rows: string[][] = []
    wb.worksheets[0]!.eachRow((r) => rows.push((r.values as unknown[]).slice(1).map((v) => String(v))))
    expect(rows).toEqual([
      ['name', 'age', 'city'],
      ['Ann', '31', 'Paris, FR'],
      ['Bob', '42', 'Berlin']
    ])
  })

  test('E2E-73 ZIP → Unzip round trip: mixed files in, byte-identical files out', async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const src = join(lud.workDir, 'src')
    mkdirSync(src)
    const png = await makePng(join(src, 'pic.png'))
    const txt = join(src, 'notes été.txt')
    writeFileSync(txt, 'Hello from the round trip ✓\n')
    const hashes = { 'pic.png': sha256(png), 'notes été.txt': sha256(txt) }

    const zipped = await convertViaDrop(app, testInfo, 'zip', [png, txt], 'zip')
    expect(zipped.event.type, JSON.stringify(zipped.event)).toBe('done')
    const [zipPath] = outputsOf(zipped.event)
    expect(dirname(zipPath!)).toBe(src)
    expect(magic.zip(zipPath!)).toBe(true)
    await expectOverlayHidesItself(app)

    // Unzip next to a copy in a different folder, so the extracted names cannot collide with the sources.
    const dest = join(lud.workDir, 'dest')
    mkdirSync(dest)
    const copy = join(dest, basename(zipPath!))
    writeFileSync(copy, readFileSync(zipPath!))
    const unzipped = await convertViaDrop(app, testInfo, 'unzip', [copy], 'unzip')
    expect(unzipped.event.type, JSON.stringify(unzipped.event)).toBe('done')
    const [folder] = outputsOf(unzipped.event)
    expect(dirname(folder!)).toBe(dest)
    expect(basename(folder!)).toBe(basename(copy, '.zip'))
    expect(readdirSync(folder!).sort()).toEqual(Object.keys(hashes).sort())
    for (const [name, hash] of Object.entries(hashes)) expect(sha256(join(folder!, name)), name).toBe(hash)
    // Sources untouched, nothing else written.
    expect(listNames(src)).toEqual([basename(zipPath!), 'notes été.txt', 'pic.png'].sort())
  })
})
