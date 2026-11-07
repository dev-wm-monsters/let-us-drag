// The only place the engine imports sharp (SEC-50/51). Importing this module hardens libvips for
// the whole process before any image is opened:
//   1. sharp.block({ operation: ['VipsForeignLoad'] }) blocks EVERY libvips loader,
//   2. sharp.unblock(...) re-enables only the loaders §5 needs (PNG, JPEG, WebP, GIF, TIFF, HEIF/AVIF),
//      file and buffer variants. SVG, PDF, VIPS-native, Matrix, CSV, raw, UltraHDR, OpenSlide and
//      Magick loaders stay blocked, so e.g. an SVG renamed ".png" can never reach librsvg.
// Loader class names verified with `strings` on the bundled libvips 8.18.7
// (@img/sharp-libvips-linux-x64), and the block/unblock API in node_modules/sharp/lib/index.d.ts.
// Raw pixel input (`{ raw: … }`) and `create` do not go through a loader and keep working.
//
// SVG (TPM D30): only the BUFFER variant of the SVG loader is re-enabled, and only
// rasterizeSvgBuffer() below feeds it, with markup that ./svg.ts has already parsed, sanitized
// and re-serialized. librsvg resolves no URL for a buffer (no base file), so even a reference that
// slipped through could not read a file or the network (verified with librsvg 2.63.2). The SVG
// FILE/SOURCE loaders stay blocked (an SVG renamed ".png" still fails), and safeSharp() refuses
// any buffer that is not a sniffed raster image, so no other code path can reach librsvg.
import sharp from 'sharp'
import type { Sharp, SharpOptions } from 'sharp'
import { MAX_INPUT_PIXELS } from '../limits'
import { EngineError, errMessage, invalidInput } from '../errors'
import { sniffImage } from '../sniff'

export const ALLOWED_LOADERS: readonly string[] = [
  'VipsForeignLoadPngFile',
  'VipsForeignLoadPngBuffer',
  'VipsForeignLoadJpegFile',
  'VipsForeignLoadJpegBuffer',
  'VipsForeignLoadWebpFile',
  'VipsForeignLoadWebpBuffer',
  'VipsForeignLoadNsgifFile',
  'VipsForeignLoadNsgifBuffer',
  'VipsForeignLoadTiffFile',
  'VipsForeignLoadTiffBuffer',
  'VipsForeignLoadHeifFile',
  'VipsForeignLoadHeifBuffer'
]

/** The one non-raster loader that is enabled, used only by rasterizeSvgBuffer(). */
export const SVG_BUFFER_LOADER = 'VipsForeignLoadSvgBuffer'

sharp.block({ operation: ['VipsForeignLoad'] })
sharp.unblock({ operation: [...ALLOWED_LOADERS, SVG_BUFFER_LOADER] })
// No libvips operation cache: cached operations keep the input file open, which on Windows locks
// the user's original (it cannot be renamed or deleted until the app quits). Each job reads once.
sharp.cache(false)

/**
 * Options for every sharp() input (SEC-51): an explicit pixel cap (never `unlimited`), and
 * failOn 'error' — corrupt or truncated data is an error, mere warnings (e.g. odd but readable
 * metadata) are tolerated so real-world photos still open.
 */
export const SHARP_INPUT: Readonly<Pick<SharpOptions, 'failOn' | 'limitInputPixels'>> = Object.freeze({
  failOn: 'error',
  limitInputPixels: MAX_INPUT_PIXELS
})

/** sharp() with the hardened input options merged in. */
export function safeSharp(input: string | Buffer | Uint8Array, options: SharpOptions = {}): Sharp {
  // Buffers must be sniffed raster images: SVG markup only ever goes through rasterizeSvgBuffer().
  if (typeof input !== 'string' && !sniffImage(input.subarray(0, 64))) {
    throw invalidInput("I couldn't read this image. It may be damaged, or it isn't really an image.", 'safeSharp: buffer is not a known raster format')
  }
  return sharp(input, { ...options, ...SHARP_INPUT })
}

/**
 * Rasterize SANITIZED SVG markup (from ./svg.ts renderSvgMarkup, which sets the pixel size) to a
 * PNG (alpha kept) or a JPG (on white) file.
 */
export async function rasterizeSvgBuffer(markup: Buffer, format: 'png' | 'jpg', outPath: string): Promise<void> {
  if (sniffImage(markup.subarray(0, 64))) throw new EngineError('INTERNAL', undefined, 'rasterizeSvgBuffer: not SVG markup')
  try {
    // density 72 = one SVG px per output pixel (renderSvgMarkup already set width/height).
    const img = sharp(markup, { ...SHARP_INPUT, density: 72 })
    await (format === 'png' ? img.png() : img.flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true })).toFile(outPath)
  } catch (err) {
    throw sharpError(err, 'SVG picture')
  }
}

const PIXEL_LIMIT = /pixel limit/i
/** Messages libvips/sharp produce for undecodable input (loaders run lazily, on first pixel access). */
const DECODE_FAILURE =
  /unsupported image format|corrupt|premature end|truncat|read error|bad seek|load|tiff2vips|not a known|invalid|huffman|marker|IHDR|IDAT|crc error|blocked/i

/**
 * Map a sharp/libvips failure to a JobError: pixel cap and decoding problems are the input's
 * fault (INPUT_INVALID, TPM decision D6); anything else is an unexpected tool failure.
 */
export function sharpError(err: unknown, what = 'image'): EngineError {
  if (err instanceof EngineError) return err
  const msg = errMessage(err)
  if (/no space left on device/i.test(msg)) {
    return new EngineError('OUTPUT_NOT_WRITABLE', 'The disk is full, so I could not save the result.', msg)
  }
  if (PIXEL_LIMIT.test(msg)) {
    return invalidInput(`This ${what} is too big (more than ${Math.round(MAX_INPUT_PIXELS / 1e6)} megapixels), so I refused to open it.`, err)
  }
  if (DECODE_FAILURE.test(msg)) return invalidInput(`I couldn't read this ${what}. It may be damaged, or it isn't really an image.`, err)
  return new EngineError('TOOL_FAILED', undefined, msg)
}

export { sharp }
export type { Sharp }
