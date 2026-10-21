// Minimal ICO (Windows icon) encoder/decoder. Entries are PNG-encoded (supported since Vista).
// Format: ICONDIR (6 bytes) + N × ICONDIRENTRY (16 bytes) + image data.

export const ICO_SIZES = [16, 32, 48, 64, 128, 256] as const

export interface IcoImage {
  /** Square size in pixels (1..256). */
  size: number
  /** PNG-encoded image data. */
  png: Uint8Array
  /** Bits per pixel recorded in the directory (32 for RGBA PNG). */
  bitCount?: number
}

export interface IcoEntry {
  width: number
  height: number
  bitCount: number
  size: number
  offset: number
  isPng: boolean
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function isPng(data: Uint8Array): boolean {
  return PNG_MAGIC.every((b, i) => data[i] === b)
}

/** Build an .ico file from PNG images. */
export function encodeIco(images: readonly IcoImage[]): Buffer {
  if (images.length === 0 || images.length > 0xffff) throw new Error('ICO needs 1..65535 images')
  const headerSize = 6 + 16 * images.length
  const total = headerSize + images.reduce((n, img) => n + img.png.byteLength, 0)
  const buf = Buffer.alloc(total)
  buf.writeUInt16LE(0, 0) // reserved
  buf.writeUInt16LE(1, 2) // type 1 = icon
  buf.writeUInt16LE(images.length, 4)
  let offset = headerSize
  images.forEach((img, i) => {
    if (!Number.isInteger(img.size) || img.size < 1 || img.size > 256) throw new Error(`Invalid ICO size ${img.size}`)
    const e = 6 + i * 16
    buf.writeUInt8(img.size === 256 ? 0 : img.size, e) // width (0 means 256)
    buf.writeUInt8(img.size === 256 ? 0 : img.size, e + 1) // height
    buf.writeUInt8(0, e + 2) // colour count (0 = no palette)
    buf.writeUInt8(0, e + 3) // reserved
    buf.writeUInt16LE(1, e + 4) // colour planes
    buf.writeUInt16LE(img.bitCount ?? 32, e + 6) // bits per pixel
    buf.writeUInt32LE(img.png.byteLength, e + 8) // size of image data
    buf.writeUInt32LE(offset, e + 12) // offset of image data
    buf.set(img.png, offset)
    offset += img.png.byteLength
  })
  return buf
}

/** Parse the ICO directory. Throws on anything that is not a well-formed icon. */
export function parseIco(data: Uint8Array): IcoEntry[] {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('Not an ICO file')
  const count = buf.readUInt16LE(4)
  if (count === 0 || buf.length < 6 + count * 16) throw new Error('Truncated ICO directory')
  const entries: IcoEntry[] = []
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16
    const size = buf.readUInt32LE(e + 8)
    const offset = buf.readUInt32LE(e + 12)
    if (offset + size > buf.length || size === 0) throw new Error('ICO entry points outside the file')
    entries.push({
      width: buf.readUInt8(e) || 256,
      height: buf.readUInt8(e + 1) || 256,
      bitCount: buf.readUInt16LE(e + 6),
      size,
      offset,
      isPng: isPng(buf.subarray(offset, offset + 8))
    })
  }
  return entries
}

/** The largest entry (by area, then bit depth). */
export function largestIcoEntry(entries: readonly IcoEntry[]): IcoEntry | undefined {
  return [...entries].sort((a, b) => b.width * b.height - a.width * a.height || b.bitCount - a.bitCount)[0]
}
