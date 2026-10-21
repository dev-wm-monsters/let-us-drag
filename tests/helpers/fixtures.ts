// Test fixture generators. Every fixture is created at test time inside a temp dir, using only
// installed packages and FFmpeg (env LUD_FFMPEG_PATH, else "ffmpeg" on PATH). Portable across
// Linux/macOS/Windows: no shell, no hard-coded separators, LF line endings in generated text.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { crc32, deflateRawSync } from 'node:zlib'
import sharp from 'sharp'

const execFileP = promisify(execFile)

export function ffmpegBin(): string {
  return process.env['LUD_FFMPEG_PATH'] || (process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
}

/** Run ffmpeg with an args array; resolves { stdout, stderr }; rejects on non-zero exit. */
export async function ffmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileP(ffmpegBin(), ['-hide_banner', '-nostdin', '-y', ...args], { maxBuffer: 64 * 1024 * 1024, windowsHide: true })
}

/** `ffmpeg -i file` stderr (exit code 1 is expected). */
export async function ffmpegInfo(file: string): Promise<string> {
  try {
    await execFileP(ffmpegBin(), ['-hide_banner', '-nostdin', '-i', file], { windowsHide: true })
    return ''
  } catch (err) {
    return String((err as { stderr?: string }).stderr ?? '')
  }
}

/** Fully decode a media file; resolves the stderr (must be empty for a clean file). */
export async function ffmpegDecode(file: string): Promise<string> {
  const { stderr } = await execFileP(ffmpegBin(), ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-f', 'null', '-'], { windowsHide: true })
  return stderr
}

export async function makeTempDir(prefix = 'lud-test-'): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 3 }) }
}

async function ensureParent(p: string): Promise<void> {
  await mkdir(dirname(p), { recursive: true })
}

// --- images -----------------------------------------------------------------------------------

/** RGBA PNG: half-transparent background with an opaque square in the middle. */
export async function pngWithAlpha(path: string, width = 64, height = 48): Promise<string> {
  await ensureParent(path)
  const square = await sharp({ create: { width: Math.floor(width / 2), height: Math.floor(height / 2), channels: 4, background: { r: 20, g: 120, b: 220, alpha: 1 } } })
    .png()
    .toBuffer()
  await sharp({ create: { width, height, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } })
    .composite([{ input: square, left: Math.floor(width / 4), top: Math.floor(height / 4) }])
    .png()
    .toFile(path)
  return path
}

/** Encode an opaque test image in the format implied by the extension (sharp formats only). */
export async function sharpImage(path: string, width = 64, height = 48): Promise<string> {
  await ensureParent(path)
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const base = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 150, b: 40 } } })
  const img = (() => {
    switch (ext) {
      case 'png':
        return base.png()
      case 'jpg':
      case 'jpeg':
        return base.jpeg({ quality: 95 })
      case 'webp':
        return base.webp({ quality: 95 })
      case 'avif':
        return base.avif({ quality: 80 })
      case 'gif':
        return base.gif()
      case 'tif':
      case 'tiff':
        return base.tiff({ compression: 'none' })
      case 'heif':
      case 'heic':
        return base.heif({ compression: 'av1', quality: 80 })
      default:
        throw new Error(`sharpImage: unsupported ${ext}`)
    }
  })()
  await img.toFile(path)
  return path
}

/** A noisy photo-like PNG (compressible by palette quantisation). */
export async function noisyPng(path: string, width = 256, height = 192): Promise<string> {
  await ensureParent(path)
  const raw = Buffer.alloc(width * height * 3)
  let seed = 42
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    raw[i] = (i % 3 === 0 ? (i / 3) % width : 128) + (seed % 32)
  }
  await sharp(raw, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 0 }).toFile(path)
  return path
}

/** JPEG with EXIF orientation 6 (rotate 90° CW): stored 40×20, displayed 20×40. */
export async function rotatedJpeg(path: string): Promise<string> {
  await ensureParent(path)
  await sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 10, g: 200, b: 10 } } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toFile(path)
  return path
}

/** BMP via FFmpeg (sharp cannot write BMP). */
export async function bmpImage(path: string, width = 32, height = 24): Promise<string> {
  await ensureParent(path)
  await ffmpeg(['-f', 'lavfi', '-i', `color=c=blue:s=${width}x${height}`, '-frames:v', '1', '-c:v', 'bmp', '-f', 'image2', path])
  return path
}

/** ICO via FFmpeg with a BMP-encoded (or PNG-encoded) entry. */
export async function icoImage(path: string, codec: 'bmp' | 'png' = 'bmp', size = 32): Promise<string> {
  await ensureParent(path)
  await ffmpeg(['-f', 'lavfi', '-i', `color=c=green:s=${size}x${size}`, '-frames:v', '1', '-c:v', codec, '-pix_fmt', codec === 'bmp' ? 'bgra' : 'rgba', '-f', 'ico', path])
  return path
}

// --- audio / video ----------------------------------------------------------------------------

/** 2 s test video (testsrc + 440 Hz sine). Container chosen by extension. */
export async function videoFile(path: string, opts: { seconds?: number; audio?: boolean; size?: string } = {}): Promise<string> {
  await ensureParent(path)
  const seconds = String(opts.seconds ?? 2)
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const args = ['-f', 'lavfi', '-i', `testsrc=size=${opts.size ?? '160x120'}:rate=25:duration=${seconds}`]
  if (opts.audio !== false) args.push('-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=44100:duration=${seconds}`)
  const codecs: Record<string, string[]> = {
    mp4: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'],
    mov: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'],
    m4v: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mp4'],
    // yuv444p allows odd sizes (used to check that outputs are forced to even dimensions)
    mkv: ['-c:v', 'libx264', '-pix_fmt', 'yuv444p', '-c:a', 'libvorbis'],
    webm: ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus'],
    avi: ['-c:v', 'mpeg4', '-c:a', 'libmp3lame']
  }
  const c = codecs[ext]
  if (!c) throw new Error(`videoFile: unsupported ${ext}`)
  await ffmpeg([...args, ...c, '-shortest', path])
  return path
}

/** 2 s sine tone. Codec chosen by extension. */
export async function audioFile(path: string, seconds = 2): Promise<string> {
  await ensureParent(path)
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const codecs: Record<string, string[]> = {
    wav: ['-c:a', 'pcm_s16le'],
    mp3: ['-c:a', 'libmp3lame', '-b:a', '128k'],
    m4a: ['-c:a', 'aac', '-f', 'ipod'],
    aac: ['-c:a', 'aac', '-f', 'adts'],
    ogg: ['-c:a', 'libvorbis'],
    oga: ['-c:a', 'libvorbis', '-f', 'ogg'],
    opus: ['-c:a', 'libopus', '-f', 'ogg'],
    flac: ['-c:a', 'flac']
  }
  const c = codecs[ext]
  if (!c) throw new Error(`audioFile: unsupported ${ext}`)
  await ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=44100:duration=${seconds}`, ...c, path])
  return path
}

// --- pdf / office -----------------------------------------------------------------------------

/** PDF with `pages` pages, each saying "Hello page N". */
export async function pdfFile(path: string, pages = 2, label = 'Hello page'): Promise<string> {
  await ensureParent(path)
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([300, 200])
    page.drawText(`${label} ${i}`, { x: 30, y: 100, size: 18, font, color: rgb(0, 0, 0) })
  }
  await writeFile(path, await doc.save())
  return path
}

/** DOCX with a heading, formatted paragraph, a bullet list and a table. */
export async function docxFile(path: string): Promise<string> {
  await ensureParent(path)
  const d = await import('docx')
  const doc = new d.Document({
    sections: [
      {
        children: [
          new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, children: [new d.TextRun('Quarterly Report')] }),
          new d.Paragraph({ children: [new d.TextRun('Revenue was '), new d.TextRun({ text: 'great', bold: true }), new d.TextRun({ text: ' this time.', italics: true })] }),
          new d.Paragraph({ text: 'First point', bullet: { level: 0 } }),
          new d.Paragraph({ text: 'Second point', bullet: { level: 0 } }),
          new d.Table({
            rows: [
              new d.TableRow({ children: [new d.TableCell({ children: [new d.Paragraph('Region')] }), new d.TableCell({ children: [new d.Paragraph('Sales')] })] }),
              new d.TableRow({ children: [new d.TableCell({ children: [new d.Paragraph('North')] }), new d.TableCell({ children: [new d.Paragraph('42')] })] })
            ]
          })
        ]
      }
    ]
  })
  await writeFile(path, await d.Packer.toBuffer(doc))
  return path
}

export const SAMPLE_MD = `# Title

Some **bold** and *italic* text with \`code\` and a [link](https://example.com).

- one
- two
  - nested

1. first
2. second

\`\`\`
const x = 1
\`\`\`

| a | b |
|---|---|
| 1 | 2 |
`

export const SAMPLE_HTML = `<!doctype html>
<html><head><title>Sample</title><script>alert(1)</script>
<link rel="stylesheet" href="https://evil.example/x.css"></head>
<body onload="steal()">
<h1>Hello HTML</h1>
<p>Para with <b>bold</b> &amp; <i>italic</i>.<img src="https://evil.example/track.png" alt="tracker"></p>
<ul><li>apple</li><li>banana</li></ul>
<a href="javascript:alert(1)">bad link</a>
</body></html>
`

export async function textFile(path: string, content: string): Promise<string> {
  await ensureParent(path)
  await writeFile(path, content, 'utf8')
  return path
}

export const SAMPLE_CSV = 'name,age,city\nAnn,31,"Paris, FR"\nBob,42,Berlin\n'
export const SAMPLE_JSON = JSON.stringify([
  { name: 'Ann', age: 31, tags: ['a', 'b'] },
  { name: 'Bob', age: 42, city: 'Berlin' }
])
export const SAMPLE_YAML = '- name: Ann\n  age: 31\n- name: Bob\n  age: 42\n'

export async function xlsxFile(path: string, rows: (string | number)[][] = [['name', 'age'], ['Ann', 31], ['Bob', 42]]): Promise<string> {
  await ensureParent(path)
  const mod = (await import('exceljs')) as typeof import('exceljs') & { default?: typeof import('exceljs') }
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Data')
  rows.forEach((r) => ws.addRow(r))
  await wb.xlsx.writeFile(path)
  return path
}

// --- zip --------------------------------------------------------------------------------------

/** Normal zip built with yazl: { "a.txt": "...", "sub/b.txt": "..." }. */
export async function zipFile(path: string, files: Record<string, string>): Promise<string> {
  await ensureParent(path)
  const yazl = await import('yazl')
  const { createWriteStream } = await import('node:fs')
  const { pipeline } = await import('node:stream/promises')
  const zip = new yazl.ZipFile()
  for (const [name, content] of Object.entries(files)) zip.addBuffer(Buffer.from(content), name)
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(path))
  return path
}

export interface RawZipEntry {
  name: string
  data: string | Buffer
  /** Upper 16 bits = Unix mode when madeBy is Unix (3). */
  unixMode?: number
  /** 0 = stored (default), 8 = deflated (raw deflate of `data`). */
  method?: 0 | 8
  /** Lie about the uncompressed size in both headers (zip-bomb fixtures). */
  declaredSize?: number
}

/**
 * Hand-rolled "stored" zip writer that does NOT validate names, to build hostile archives
 * (zip-slip "../" paths, absolute paths, symlink entries) that yazl refuses to create.
 */
export function rawZip(entries: readonly RawZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data)
    const method = e.method ?? 0
    const data = method === 8 ? deflateRawSync(raw) : raw
    const crc = crc32(raw)
    const usize = e.declaredSize ?? raw.length
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(usize, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(e.unixMode !== undefined ? (3 << 8) | 20 : 20, 4) // made by
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(usize, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(e.unixMode !== undefined ? (e.unixMode << 16) >>> 0 : 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

// --- onnx -------------------------------------------------------------------------------------

function varint(n: number): Buffer {
  const out: number[] = []
  let v = n
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80)
    v = Math.floor(v / 128)
  }
  out.push(v)
  return Buffer.from(out)
}
const fieldVarint = (field: number, n: number): Buffer => Buffer.concat([varint(field << 3), varint(n)])
const fieldBytes = (field: number, data: Buffer | string): Buffer => {
  const b = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  return Buffer.concat([varint((field << 3) | 2), varint(b.length), b])
}

function valueInfo(name: string, dims: number[]): Buffer {
  const shape = Buffer.concat(dims.map((d) => fieldBytes(1, fieldVarint(1, d)))) // TensorShapeProto.dim[].dim_value
  const tensorType = Buffer.concat([fieldVarint(1, 1 /* FLOAT */), fieldBytes(2, shape)])
  const typeProto = fieldBytes(1, tensorType) // TypeProto.tensor_type
  return Buffer.concat([fieldBytes(1, name), fieldBytes(2, typeProto)])
}

/**
 * A tiny ONNX model with the same I/O contract as isnet-general-use:
 * input "input_image" [1,3,S,S] → output "output_image" [1,1,S,S] = Sigmoid(ReduceMean(x, axis=1)).
 * Hand-encoded protobuf (opset 13), used to exercise the remove-bg pipeline without the 170 MB model.
 */
export function tinyOnnxModel(size = 1024): Buffer {
  const attrAxes = Buffer.concat([fieldBytes(1, 'axes'), fieldVarint(8, 1), fieldVarint(20, 7 /* INTS */)])
  const attrKeep = Buffer.concat([fieldBytes(1, 'keepdims'), fieldVarint(3, 1), fieldVarint(20, 2 /* INT */)])
  const reduce = Buffer.concat([fieldBytes(1, 'input_image'), fieldBytes(2, 'mean'), fieldBytes(3, 'reduce'), fieldBytes(4, 'ReduceMean'), fieldBytes(5, attrAxes), fieldBytes(5, attrKeep)])
  const sigmoid = Buffer.concat([fieldBytes(1, 'mean'), fieldBytes(2, 'output_image'), fieldBytes(3, 'sig'), fieldBytes(4, 'Sigmoid')])
  const graph = Buffer.concat([
    fieldBytes(1, reduce),
    fieldBytes(1, sigmoid),
    fieldBytes(2, 'tiny'),
    fieldBytes(11, valueInfo('input_image', [1, 3, size, size])),
    fieldBytes(12, valueInfo('output_image', [1, 1, size, size]))
  ])
  const opset = Buffer.concat([fieldBytes(1, ''), fieldVarint(2, 13)])
  return Buffer.concat([fieldVarint(1, 8 /* ir_version */), fieldBytes(2, 'lud-tests'), fieldBytes(7, graph), fieldBytes(8, opset)])
}

// --- hostile inputs ---------------------------------------------------------------------------

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/**
 * A tiny PNG whose header DECLARES `width`×`height` (e.g. 30000×30000) but carries almost no data:
 * the "decompression bomb" shape used to test the pixel cap without allocating anything.
 */
export function pngDeclaring(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // greyscale
  const idat = deflateRawSync(Buffer.alloc(16)) // far too little data, never reached
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))])
}

/** A minimal valid-looking XLSX/DOCX skeleton plus extra entries (for bomb fixtures). */
export function officeZip(kind: 'xlsx' | 'docx', extra: readonly RawZipEntry[] = []): Buffer {
  const main = kind === 'xlsx' ? 'xl/workbook.xml' : 'word/document.xml'
  return rawZip([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: main, data: '<x/>' }, ...extra])
}

// --- misc -------------------------------------------------------------------------------------

export function startsWith(buf: Buffer, bytes: readonly number[] | string, offset = 0): boolean {
  const b = typeof bytes === 'string' ? Buffer.from(bytes, 'latin1') : Buffer.from(bytes)
  return buf.subarray(offset, offset + b.length).equals(b)
}

export const MAGIC = {
  png: [0x89, 0x50, 0x4e, 0x47],
  jpg: [0xff, 0xd8, 0xff],
  gif: 'GIF8',
  pdf: '%PDF-',
  zip: [0x50, 0x4b, 0x03, 0x04],
  ico: [0, 0, 1, 0],
  webpRiff: 'RIFF',
  flac: 'fLaC',
  ogg: 'OggS',
  wav: 'RIFF'
} as const
