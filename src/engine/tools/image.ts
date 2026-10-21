// Image conversions with sharp. The input format is decided by content sniffing (SEC-40), not by
// the extension: HEIC/HEIF (HEVC) is decoded with heic-decode, BMP and BMP-encoded ICO through
// FFmpeg (forced demuxer, whitelisted, "file:" input), PNG-encoded ICO entries directly, everything
// else by sharp with only the needed libvips loaders enabled (./sharp-safe).
// sharp's prebuilt libvips (verified 0.35.5): jpeg/png/webp/tiff/gif/heif(AV1 only) in+out;
// no bmp/ico/pdf; svg is available in libvips but blocked.
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { OptionId } from '../../shared/types'
import { EngineError, aboutFile, errMessage, invalidInput } from '../errors'
import { MAX_FFMPEG_IMAGE_BYTES, MAX_HEIC_BYTES, MAX_INPUT_PIXELS, formatBytes } from '../limits'
import { requireImage, type ImageKind } from '../sniff'
import { ffmpegInput, spawnFfmpeg } from './ffmpeg'
import { ICO_SIZES, encodeIco, largestIcoEntry, parseIco } from './ico'
import { safeSharp, sharp, sharpError, type Sharp } from './sharp-safe'

export type HeicDecoder = (input: { buffer: Uint8Array }) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>

export interface ImageDeps {
  signal: AbortSignal
  /** Resolve the ffmpeg binary (only called for BMP/ICO fallbacks). */
  ffmpeg: () => string
  /** Injectable for tests; defaults to heic-decode (dimensions checked before decoding). */
  decodeHeic?: HeicDecoder
}

export { MAX_INPUT_PIXELS }

function tooManyPixels(): EngineError {
  return invalidInput(`This picture is too big (more than ${Math.round(MAX_INPUT_PIXELS / 1e6)} megapixels), so I refused to open it.`)
}

interface HeicImage {
  width: number
  height: number
  decode(): Promise<{ width: number; height: number; data: Uint8ClampedArray }>
}
type HeicAll = (input: { buffer: Uint8Array }) => Promise<HeicImage[] & { dispose(): void }>

/** heic-decode's `all()` exposes width/height before decoding, so the pixel cap applies first (SEC-52). */
async function defaultHeicDecoder(input: { buffer: Uint8Array }): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const mod = (await import('heic-decode')) as unknown as { all?: HeicAll; default?: { all?: HeicAll } }
  const all = mod.all ?? mod.default?.all
  if (!all) throw new EngineError('TOOL_MISSING', undefined, 'heic-decode has no all()')
  const images = await all(input)
  try {
    const first = images[0]
    if (!first) throw new Error('HEIF image not found')
    if (first.width * first.height > MAX_INPUT_PIXELS) throw tooManyPixels()
    return await first.decode()
  } finally {
    images.dispose()
  }
}

async function assertSize(path: string, max: number, what: string): Promise<void> {
  const { size } = await stat(path)
  if (size > max) throw invalidInput(`This ${what} is larger than ${formatBytes(max)}, which is more than I can chew.`)
}

/** Decode BMP (or BMP-in-ICO) with FFmpeg into PNG bytes. The demuxer is forced: no probing, no image2 patterns. */
async function decodeWithFfmpeg(path: string, kind: 'bmp' | 'ico', deps: ImageDeps): Promise<Buffer> {
  await assertSize(path, MAX_FFMPEG_IMAGE_BYTES, 'picture')
  const res = await spawnFfmpeg(
    deps.ffmpeg(),
    ['-hide_banner', '-nostdin', '-loglevel', 'error', ...ffmpegInput(path, 'image', kind === 'bmp' ? 'bmp_pipe' : 'ico'),
      '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'],
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
 * Throws INPUT_INVALID for unreadable, disguised or oversized files.
 */
export async function openImage(path: string, _ext: string, deps: ImageDeps, opts: { animated?: boolean } = {}): Promise<Sharp> {
  const kind: ImageKind = await requireImage(path)
  try {
    if (kind === 'heif') return await openHeif(path, deps)
    if (kind === 'bmp') return safeSharp(await decodeWithFfmpeg(path, 'bmp', deps)).autoOrient()
    if (kind === 'ico') {
      await assertSize(path, MAX_FFMPEG_IMAGE_BYTES, 'icon')
      const bytes = await readFile(path)
      let entries
      try {
        entries = parseIco(bytes)
      } catch (err) {
        throw invalidInput('This icon file looks damaged.', err)
      }
      const best = largestIcoEntry(entries)!
      if (best.isPng) {
        const img = safeSharp(bytes.subarray(best.offset, best.offset + best.size))
        await img.metadata()
        return img
      }
      return safeSharp(await decodeWithFfmpeg(path, 'ico', deps))
    }
    const img = safeSharp(path, { animated: opts.animated === true })
    const meta = await img.metadata() // fail early on unreadable input (header only)
    const frames = opts.animated ? Math.max(1, meta.pages ?? 1) : 1
    if ((meta.width ?? 0) * (meta.pageHeight ?? meta.height ?? 0) * frames > MAX_INPUT_PIXELS) throw tooManyPixels()
    return opts.animated ? img : img.autoOrient()
  } catch (err) {
    throw sharpError(err)
  }
}

async function openHeif(path: string, deps: ImageDeps): Promise<Sharp> {
  // AV1-compressed HEIF (AVIF) works natively in sharp; HEVC (iPhone photos) needs heic-decode.
  try {
    const img = safeSharp(path)
    const meta = await img.metadata()
    if (meta.compression === 'av1') return img.autoOrient()
  } catch {
    // not readable by sharp: fall through to heic-decode
  }
  await assertSize(path, MAX_HEIC_BYTES, 'HEIC photo')
  const bytes = await readFile(path)
  const decode = deps.decodeHeic ?? defaultHeicDecoder
  let decoded
  try {
    decoded = await decode({ buffer: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) })
  } catch (err) {
    if (err instanceof EngineError) throw err
    throw invalidInput("I couldn't read this HEIC photo. It may be damaged.", err)
  }
  const { width, height, data } = decoded
  if (width * height > MAX_INPUT_PIXELS) throw tooManyPixels()
  if (width * height * 4 !== data.length) throw invalidInput("I couldn't read this HEIC photo.", 'unexpected pixel buffer size')
  // libheif applies the HEIF orientation transform itself; no EXIF rotate needed.
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 }, limitInputPixels: MAX_INPUT_PIXELS })
}

export interface EncodedImage {
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

/** Extension of the single output an image option produces for an input with extension `ext`. */
export function imageOutputExt(optionId: OptionId, ext: string): string {
  switch (optionId) {
    case 'to-png':
      return 'png'
    case 'to-jpg':
      return 'jpg'
    case 'to-webp':
      return 'webp'
    case 'to-avif':
      return 'avif'
    case 'to-ico':
      return 'ico'
    case 'compress':
      return compressTargetExt(ext)
    default:
      throw new EngineError('UNSUPPORTED')
  }
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

/** Run a sharp pipeline into a file; decoding failures (libvips decodes lazily) become INPUT_INVALID. */
async function writePipeline(pipeline: Sharp, outPath: string): Promise<void> {
  try {
    await pipeline.toFile(outPath)
  } catch (err) {
    throw sharpError(err)
  }
}

/**
 * Encode one input image for a single-output option straight into `outPath` (a temp file whose
 * extension is imageOutputExt(optionId, ext)). The output never sits in JS memory as a whole.
 */
export async function encodeImageTo(optionId: OptionId, path: string, ext: string, deps: ImageDeps, outPath: string): Promise<EncodedImage> {
  const outExt = imageOutputExt(optionId, ext)
  switch (optionId) {
    case 'to-png':
      await writePipeline((await openImage(path, ext, deps)).png(), outPath)
      return { ext: outExt }
    case 'to-jpg':
      await writePipeline((await openImage(path, ext, deps)).flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }), outPath)
      return { ext: outExt }
    case 'to-webp':
      await writePipeline((await openImage(path, ext, deps)).webp({ quality: 90 }), outPath)
      return { ext: outExt }
    case 'to-avif':
      await writePipeline((await openImage(path, ext, deps)).avif({ quality: 60, effort: 4 }), outPath)
      return { ext: outExt }
    case 'to-ico':
      await writeFile(outPath, await buildIco(await openImage(path, ext, deps)))
      return { ext: outExt }
    case 'compress':
      return compressImageTo(path, ext, deps, outPath)
    default:
      throw new EngineError('UNSUPPORTED')
  }
}

/** Multi-size ICO (16…256 px, PNG entries). Non-square images are centred on transparency. */
export async function buildIco(img: Sharp): Promise<Buffer> {
  const entries = []
  try {
    for (const size of ICO_SIZES) {
      const png = await img
        .clone()
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .ensureAlpha()
        .png({ compressionLevel: 9 })
        .toBuffer()
      entries.push({ size, png })
    }
  } catch (err) {
    throw sharpError(err)
  }
  return encodeIco(entries)
}

const SNIFFED_EXT: Readonly<Record<ImageKind, readonly string[]>> = {
  png: ['png'],
  jpeg: ['jpg', 'jpeg'],
  gif: ['gif'],
  webp: ['webp'],
  tiff: ['tif', 'tiff'],
  heif: ['avif', 'heif', 'heic'],
  bmp: ['bmp'],
  ico: ['ico']
}

async function compressImageTo(path: string, ext: string, deps: ImageDeps, outPath: string): Promise<EncodedImage> {
  const target = compressTargetExt(ext)
  const animated = target === 'gif' || target === 'webp'
  const img = await openImage(path, ext, deps, { animated })
  await writePipeline(compressPipeline(img, target), outPath)
  // Keep the original only when it really is in the target format (content, not just the name).
  const sameFormat = SNIFFED_EXT[await requireImage(path)].includes(target)
  if (sameFormat && (await stat(outPath)).size >= (await stat(path)).size) {
    await copyFile(path, outPath)
    return { ext: target, suffix: '-compressed', note: 'Already as small as it gets, kept the original' }
  }
  return { ext: target, suffix: '-compressed' }
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
    try {
      await addImagePage(doc, path, ext, deps)
    } catch (err) {
      throw inputs.length > 1 ? aboutFile(err, basename(path)) : err
    }
  }
  return doc.save()
}

async function addImagePage(doc: import('pdf-lib').PDFDocument, path: string, ext: string, deps: ImageDeps): Promise<void> {
  {
    const img = await openImage(path, ext, deps)
    let encoded
    let hasAlpha
    try {
      hasAlpha = (await img.clone().metadata()).hasAlpha
      // Encoding resolves the oriented output size, which is what the page must match.
      encoded = hasAlpha
        ? await img.png().toBuffer({ resolveWithObject: true })
        : await img.jpeg({ quality: 92, mozjpeg: true }).toBuffer({ resolveWithObject: true })
    } catch (err) {
      throw sharpError(err)
    }
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
}
