// Independent output validators for the QA exploratory suite (phase 3b).
// Every check decodes the output with a tool that is NOT the code path the app used where
// possible (ffprobe / poppler pdfinfo+pdftotext / sharp / exceljs / mammoth / yauzl / js-yaml).
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import ExcelJS from 'exceljs'
import yaml from 'js-yaml'
import mammoth from 'mammoth'
import sharp, { type Metadata } from 'sharp'
import yauzl from 'yauzl'

export function ffmpegPath(): string {
  return process.env['LUD_FFMPEG_PATH'] || 'ffmpeg'
}

function ffprobePath(): string {
  const ff = ffmpegPath()
  return ff.endsWith('ffmpeg') ? `${ff.slice(0, -'ffmpeg'.length)}ffprobe` : 'ffprobe'
}

export interface ProbeStream {
  codec_type: string
  codec_name: string
  width?: number
  height?: number
  r_frame_rate?: string
  avg_frame_rate?: string
  nb_frames?: string
}
export interface Probe {
  format: { format_name: string; duration?: string }
  streams: ProbeStream[]
}

export function ffprobe(file: string): Probe {
  const r = spawnSync(ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {
    shell: false,
    encoding: 'utf8',
    timeout: 60_000
  })
  if (r.status !== 0) throw new Error(`ffprobe failed for ${file}: ${r.stderr}`)
  return JSON.parse(r.stdout) as Probe
}

/** Decode the whole media file; returns ffmpeg's error output ('' = clean). */
export function ffmpegDecodeErrors(file: string): string {
  const r = spawnSync(ffmpegPath(), ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-f', 'null', '-'], {
    shell: false,
    encoding: 'utf8',
    timeout: 300_000
  })
  return `${r.status === 0 ? '' : `exit ${String(r.status)} `}${r.stderr.trim()}`
}

export function fps(rate: string | undefined): number {
  if (!rate) return 0
  const [n, d] = rate.split('/').map(Number)
  return d ? (n ?? 0) / d : (n ?? 0)
}

export function pdfPages(file: string): number {
  const r = spawnSync('pdfinfo', [file], { shell: false, encoding: 'utf8', timeout: 60_000 })
  if (r.status !== 0) throw new Error(`pdfinfo failed for ${file}: ${r.stderr}`)
  const m = /^Pages:\s+(\d+)/m.exec(r.stdout)
  if (!m) throw new Error(`pdfinfo: no page count for ${file}`)
  return Number(m[1])
}

export function pdfText(file: string): string {
  const r = spawnSync('pdftotext', ['-layout', file, '-'], { shell: false, encoding: 'utf8', timeout: 60_000 })
  if (r.status !== 0) throw new Error(`pdftotext failed for ${file}: ${r.stderr}`)
  return r.stdout
}

export async function imageMeta(file: string): Promise<Metadata> {
  return sharp(readFileSync(file)).metadata()
}

/** Fraction of fully transparent pixels (alpha < 16) and whether all 4 corners are transparent. */
export async function alphaStats(file: string): Promise<{ transparent: number; cornersClear: boolean; hasAlpha: boolean }> {
  const img = sharp(readFileSync(file)).ensureAlpha()
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  let clear = 0
  const px = info.width * info.height
  for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 255) < 16) clear++
  const a = (x: number, y: number): number => data[(y * info.width + x) * 4 + 3] ?? 255
  const w = info.width - 1
  const h = info.height - 1
  const meta = await imageMeta(file)
  return { transparent: clear / px, cornersClear: [a(0, 0), a(w, 0), a(0, h), a(w, h)].every((v) => v < 16), hasAlpha: meta.hasAlpha === true }
}

/** ICO header: reserved 0, type 1, count; returns the sizes of the embedded images. */
export function icoSizes(file: string): number[] {
  const b = readFileSync(file)
  if (b.readUInt16LE(0) !== 0 || b.readUInt16LE(2) !== 1) throw new Error('not an ICO file')
  const n = b.readUInt16LE(4)
  const sizes: number[] = []
  for (let i = 0; i < n; i++) sizes.push(b[6 + i * 16] || 256)
  return sizes
}

export async function docxText(file: string): Promise<string> {
  return (await mammoth.extractRawText({ path: file })).value
}

export async function xlsxRows(file: string): Promise<unknown[][]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.worksheets[0]
  if (!ws) return []
  const rows: unknown[][] = []
  ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1)))
  return rows
}

export function yamlLoad(file: string): unknown {
  return yaml.load(readFileSync(file, 'utf8'))
}

export function zipEntries(file: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('no zip'))
      const names: string[] = []
      zip.on('entry', (e: yauzl.Entry) => {
        names.push(e.fileName)
        zip.readEntry()
      })
      zip.on('end', () => resolve(names))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

export function size(file: string): number {
  return statSync(file).size
}

export function magic(file: string, n = 8): string {
  return readFileSync(file).subarray(0, n).toString('hex')
}
