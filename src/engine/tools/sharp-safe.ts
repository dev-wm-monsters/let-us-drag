// The only place the engine imports sharp (SEC-50/51). Importing this module hardens libvips for
// the whole process before any image is opened:
//   1. sharp.block({ operation: ['VipsForeignLoad'] }) blocks EVERY libvips loader,
//   2. sharp.unblock(...) re-enables only the loaders §5 needs (PNG, JPEG, WebP, GIF, TIFF, HEIF/AVIF),
//      file and buffer variants. SVG, PDF, VIPS-native, Matrix, CSV, raw, UltraHDR, OpenSlide and
//      Magick loaders stay blocked, so e.g. an SVG renamed ".png" can never reach librsvg.
// Loader class names verified with `strings` on the bundled libvips 8.18.7
// (@img/sharp-libvips-linux-x64), and the block/unblock API in node_modules/sharp/lib/index.d.ts.
// Raw pixel input (`{ raw: … }`) and `create` do not go through a loader and keep working.
import sharp from 'sharp'
import type { Sharp, SharpOptions } from 'sharp'
import { MAX_INPUT_PIXELS } from '../limits'
import { EngineError, errMessage, invalidInput } from '../errors'

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

sharp.block({ operation: ['VipsForeignLoad'] })
sharp.unblock({ operation: [...ALLOWED_LOADERS] })

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
  return sharp(input, { ...options, ...SHARP_INPUT })
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
