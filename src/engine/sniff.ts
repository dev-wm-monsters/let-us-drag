// Content sniffing (SEC-40): the first bytes of a file decide which parser may see it, never the
// extension alone. A mismatch is INPUT_INVALID before any parser runs.
import { open } from 'node:fs/promises'
import { invalidInput } from './errors'

export type ImageKind = 'png' | 'jpeg' | 'gif' | 'webp' | 'tiff' | 'heif' | 'bmp' | 'ico'

/** Read up to `n` bytes from the start of a file. */
export async function readHead(path: string, n = 64): Promise<Buffer> {
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(n)
    const { bytesRead } = await fh.read(buf, 0, n, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

function at(buf: Uint8Array, offset: number, bytes: readonly number[] | string): boolean {
  const b = typeof bytes === 'string' ? Buffer.from(bytes, 'latin1') : bytes
  if (buf.length < offset + b.length) return false
  for (let i = 0; i < b.length; i++) if (buf[offset + i] !== b[i]) return false
  return true
}

/** ISO-BMFF brands of HEIF/HEIC/AVIF still images and sequences. */
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'mif2', 'msf1', 'avif', 'avis'])

/** Detect the image formats we accept (PLAN §5). SVG, PDF, PSD, … are deliberately absent. */
export function sniffImage(head: Uint8Array): ImageKind | undefined {
  if (at(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (at(head, 0, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (at(head, 0, 'GIF87a') || at(head, 0, 'GIF89a')) return 'gif'
  if (at(head, 0, 'RIFF') && at(head, 8, 'WEBP')) return 'webp'
  if (at(head, 0, [0x49, 0x49, 0x2a, 0x00]) || at(head, 0, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff'
  if (at(head, 0, [0x49, 0x49, 0x2b, 0x00]) || at(head, 0, [0x4d, 0x4d, 0x00, 0x2b])) return 'tiff' // BigTIFF
  if (at(head, 4, 'ftyp')) {
    const major = Buffer.from(head.subarray(8, 12)).toString('latin1')
    if (HEIF_BRANDS.has(major)) return 'heif'
    // Some encoders put a generic major brand first and the HEIF brand in the compatible list.
    const boxSize = Buffer.from(head.subarray(0, 4)).readUInt32BE(0)
    const end = Math.min(head.length, boxSize)
    for (let o = 16; o + 4 <= end; o += 4) {
      if (HEIF_BRANDS.has(Buffer.from(head.subarray(o, o + 4)).toString('latin1'))) return 'heif'
    }
    return undefined
  }
  if (at(head, 0, 'BM') && head.length >= 18) return 'bmp'
  if (at(head, 0, [0x00, 0x00, 0x01, 0x00]) && head.length >= 6 && (head[4]! | (head[5]! << 8)) > 0) return 'ico'
  return undefined
}

export const NOT_AN_IMAGE = "This doesn't look like a picture I can read. It may be damaged, or it isn't what its name says."

/** Sniff an image file or throw INPUT_INVALID. */
export async function requireImage(path: string): Promise<ImageKind> {
  const kind = sniffImage(await readHead(path, 64))
  if (!kind) throw invalidInput(NOT_AN_IMAGE)
  return kind
}

/** "%PDF-" must appear in the first 1024 bytes (what PDF readers tolerate). */
export function isPdfHead(head: Uint8Array): boolean {
  return Buffer.from(head).toString('latin1').includes('%PDF-')
}

/** Local file header of a ZIP container (ZIP, DOCX, XLSX). */
export function isZipHead(head: Uint8Array): boolean {
  return at(head, 0, [0x50, 0x4b, 0x03, 0x04]) || at(head, 0, [0x50, 0x4b, 0x05, 0x06]) /* empty zip */
}
