// Image conversions with sharp. HEIC/HEIF (HEVC) input is decoded with heic-decode, BMP and
// BMP-encoded ICO input through FFmpeg, PNG-encoded ICO entries directly.
// sharp's prebuilt libvips (verified 0.35.5): jpeg/png/webp/tiff/gif/heif(AV1 only) in+out, svg in;
// no bmp/ico/pdf.
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import type { Sharp } from 'sharp'
import type { OptionId } from '../../shared/types'
import { EngineError, errMessage, invalidInput } from '../errors'
import { spawnFfmpeg } from './ffmpeg'
import { ICO_SIZES, encodeIco, largestIcoEntry, parseIco } from './ico'

export type HeicDecoder = (input: { buffer: Uint8Array }) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>

export interface ImageDeps {
  signal: AbortSignal
  /** Resolve the ffmpeg binary (only called for BMP/ICO fallbacks). */
  ffmpeg: () => string
  /** Injectable for tests; defaults to heic-decode. */
  decodeHeic?: HeicDecoder
}

/** Very large inputs are refused instead of exhausting memory (≈ 16k × 16k). */
export const MAX_INPUT_PIXELS = 268_402_689

const SHARP_OPTS = { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS } as const

async function defaultHeicDecoder(input: { buffer: Uint8Array }): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const mod = (await import('heic-decode')) as unknown as HeicDecoder & { default?: HeicDecoder }
  const decode = mod.default ?? mod
  return decode(input)
}

/** Decode anything FFmpeg understands (BMP, BMP-in-ICO) into PNG bytes. */
async function decodeWithFfmpeg(path: string, deps: ImageDeps): Promise<Buffer> {
  const res = await spawnFfmpeg(
    deps.ffmpeg(),
    ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', path, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'],
    { signal: deps.signal, captureStdout: true }
  ).catch((err: unknown) => {
    if (err instanceof EngineError && err.code === 'TOOL_FAILED') throw invalidInput("I couldn't read this image. It may be damaged.", err.detail)
    throw err
  })
  if (!res.stdout || res.stdout.length === 0) throw invalidInput("I couldn't read this image. It may be damaged.")
  return res.stdout
}

/**
 * Open an image as an auto-oriented sharp pipeline. `animated` keeps all frames (GIF/WEBP).
 * Throws INPUT_INVALID for unreadable files.
 */
export async function openImage(path: string, ext: string, deps: ImageDeps, opts: { animated?: boolean } = {}): Promise<Sharp> {
  const e = ext.toLowerCase()
  try {
    if (e === 'heic' || e === 'heif') return await openHeif(path, deps)
    if (e === 'bmp') return sharp(await decodeWithFfmpeg(path, deps), SHARP_OPTS).autoOrient()
    if (e === 'ico') {
      const bytes = await readFile(path)
      let entries
      try {
        entries = parseIco(bytes)
      } catch (err) {
        throw invalidInput("This icon file looks damaged.", err)
      }
      const best = largestIcoEntry(entries)!
      if (best.isPng) return sharp(bytes.subarray(best.offset, best.offset + best.size), SHARP_OPTS)
      return sharp(await decodeWithFfmpeg(path, deps), SHARP_OPTS)
    }
    const img = sharp(path, { ...SHARP_OPTS, animated: opts.animated === true })
    await img.metadata() // fail early on unreadable input
    return opts.animated ? img : img.autoOrient()
  } catch (err) {
    if (err instanceof EngineError) throw err
    throw invalidInput("I couldn't read this image. It may be damaged, or it isn't really an image.", err)
  }
}

async function openHeif(path: string, deps: ImageDeps): Promise<Sharp> {
  const bytes = await readFile(path)
  // AV1-compressed HEIF works natively in sharp; HEVC (iPhone photos) needs heic-decode.
  try {
    const img = sharp(bytes, SHARP_OPTS)
    const meta = await img.metadata()
    if (meta.compression === 'av1') return img.autoOrient()
  } catch {
    // not readable by sharp: fall through to heic-decode
  }
  const decode = deps.decodeHeic ?? defaultHeicDecoder
  let decoded
  try {
    decoded = await decode({ buffer: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) })
  } catch (err) {
    throw invalidInput("I couldn't read this HEIC photo. It may be damaged.", err)
  }
  const { width, height, data } = decoded
  if (width * height * 4 !== data.length) throw invalidInput("I couldn't read this HEIC photo.", 'unexpected pixel buffer size')
  // libheif applies the HEIF orientation transform itself; no EXIF rotate needed.
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } })
}

export interface EncodedImage {
  data: Buffer
  ext: string
  /** Name suffix (e.g. "-compressed"). */
  suffix?: string
  /** Optional stage text to show (e.g. "kept the original"). */
  note?: string
}

/** Formats we can re-encode in their own format when compressing. */
const SAME_FORMAT_COMPRESS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'tif', 'tiff', 'gif'])

/** Output format used by Compress for each input extension. */
export function compressTargetExt(ext: string): string {
  const e = ext.toLowerCase()
  if (SAME_FORMAT_COMPRESS.has(e)) return e
  if (e === 'heic' || e === 'heif') return 'jpg'
  return 'png' // bmp, ico
}

function compressPipeline(img: Sharp, targetExt: string): Sharp {
  switch (targetExt) {
    case 'jpg':
    case 'jpeg':
      return img.flatten({ background: '#ffffff' }).jpeg({ quality: 75, mozjpeg: true })
    case 'png':
      return img.png({ palette: true, quality: 80, effort: 10, compressionLevel: 9 })
    case 'webp':
      return img.webp({ quality: 75, effort: 6 })
    case 'avif':
      return img.avif({ quality: 50, effort: 4 })
    case 'tif':
    case 'tiff':
      return img.tiff({ compression: 'lzw', predictor: 'horizontal' })
    case 'gif':
      return img.gif({ effort: 10, colours: 128, interFrameMaxError: 8 })
    default:
      throw new EngineError('UNSUPPORTED')
  }
}

/** Encode one input image for a single-output option. */
export async function encodeImage(optionId: OptionId, path: string, ext: string, deps: ImageDeps): Promise<EncodedImage> {
  switch (optionId) {
    case 'to-png':
      return { data: await (await openImage(path, ext, deps)).png().toBuffer(), ext: 'png' }
    case 'to-jpg':
      return {
        data: await (await openImage(path, ext, deps)).flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer(),
        ext: 'jpg'
      }
    case 'to-webp':
      return { data: await (await openImage(path, ext, deps)).webp({ quality: 90 }).toBuffer(), ext: 'webp' }
    case 'to-avif':
      return { data: await (await openImage(path, ext, deps)).avif({ quality: 60, effort: 4 }).toBuffer(), ext: 'avif' }
    case 'to-ico':
      return { data: await buildIco(await openImage(path, ext, deps)), ext: 'ico' }
    case 'compress':
      return compressImage(path, ext, deps)
    default:
      throw new EngineError('UNSUPPORTED')
  }
}

/** Multi-size ICO (16…256 px, PNG entries). Non-square images are centred on transparency. */
export async function buildIco(img: Sharp): Promise<Buffer> {
  const entries = []
  for (const size of ICO_SIZES) {
    const png = await img
      .clone()
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .png({ compressionLevel: 9 })
      .toBuffer()
    entries.push({ size, png })
  }
  return encodeIco(entries)
}

async function compressImage(path: string, ext: string, deps: ImageDeps): Promise<EncodedImage> {
  const target = compressTargetExt(ext)
  const animated = target === 'gif' || target === 'webp'
  const img = await openImage(path, ext, deps, { animated })
  const data = await compressPipeline(img, target).toBuffer()
  const sameFormat = target === ext.toLowerCase()
  if (sameFormat) {
    const original = await readFile(path)
    if (data.length >= original.length) {
      return { data: original, ext: target, suffix: '-compressed', note: 'Already as small as it gets, kept the original' }
    }
  }
  return { data, ext: target, suffix: '-compressed' }
}

/** Points per pixel: images are placed at 96 dpi. PDF pages are capped at 14400 pt per side. */
const PT_PER_PX = 72 / 96
const MAX_PAGE_PT = 14_400

export function pageSizeForImage(width: number, height: number): [number, number] {
  let w = width * PT_PER_PX
  let h = height * PT_PER_PX
  const scale = Math.min(1, MAX_PAGE_PT / Math.max(w, h))
  w *= scale
  h *= scale
  return [Math.max(1, w), Math.max(1, h)]
}

/** One page per image, each page sized to its image. */
export async function imagesToPdf(
  inputs: readonly { path: string; ext: string }[],
  deps: ImageDeps,
  onEach?: (index: number) => void
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.setProducer('Let us drag!')
  for (let i = 0; i < inputs.length; i++) {
    onEach?.(i)
    const { path, ext } = inputs[i]!
    const img = await openImage(path, ext, deps)
    const { hasAlpha } = await img.clone().metadata()
    // Encoding resolves the oriented output size, which is what the page must match.
    const encoded = hasAlpha
      ? await img.png().toBuffer({ resolveWithObject: true })
      : await img.jpeg({ quality: 92, mozjpeg: true }).toBuffer({ resolveWithObject: true })
    let embedded
    try {
      embedded = hasAlpha ? await doc.embedPng(encoded.data) : await doc.embedJpg(encoded.data)
    } catch (err) {
      throw new EngineError('TOOL_FAILED', undefined, errMessage(err))
    }
    const [pw, ph] = pageSizeForImage(encoded.info.width, encoded.info.height)
    const page = doc.addPage([pw, ph])
    page.drawImage(embedded, { x: 0, y: 0, width: pw, height: ph })
  }
  return doc.save()
}
