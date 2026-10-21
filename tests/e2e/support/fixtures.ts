// Test-time fixture generation. Everything is created in a fresh temp dir per test and removed
// afterwards (set LUD_E2E_KEEP=1 to keep them for debugging).
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import sharp from 'sharp'

export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `lud-e2e-${prefix}-`))
}

export function removeDir(dir: string): void {
  if (process.env['LUD_E2E_KEEP'] === '1') return
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
}

/** A small opaque PNG (solid colour, so JPG conversion needs no alpha handling). */
export async function makePng(path: string, width = 64, height = 48): Promise<string> {
  await sharp({ create: { width, height, channels: 3, background: { r: 220, g: 80, b: 40 } } })
    .png()
    .toFile(path)
  return path
}

export async function makeJpg(path: string, width = 64, height = 48): Promise<string> {
  await sharp({ create: { width, height, channels: 3, background: { r: 40, g: 120, b: 220 } } })
    .jpeg()
    .toFile(path)
  return path
}

export async function makePdf(path: string, pages = 1): Promise<string> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) {
    doc.addPage([300, 200]).drawText(`Let us drag! page ${i + 1}`, { x: 20, y: 100, size: 18, font })
  }
  writeFileSync(path, await doc.save())
  return path
}

/** Random bytes with a misleading extension (e.g. "broken.png"). */
export function makeCorrupt(path: string, bytes = 4096): string {
  writeFileSync(path, randomBytes(bytes))
  return path
}

/** A harmless file that merely carries a blocked extension (never executed). */
export function makeBlocked(path: string): string {
  writeFileSync(path, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(510)]))
  return path
}

/** ffmpeg used for fixtures: LUD_FFMPEG_PATH, else `ffmpeg` on PATH. Returns null if unusable. */
export function resolveFfmpeg(): string | null {
  const fromEnv = process.env['LUD_FFMPEG_PATH']
  const candidates = fromEnv ? [fromEnv, 'ffmpeg'] : ['ffmpeg']
  for (const bin of candidates) {
    const r = spawnSync(bin, ['-hide_banner', '-version'], { shell: false, stdio: 'ignore', timeout: 15_000 })
    if (r.status === 0) return bin
  }
  return null
}

/** 1 s 440 Hz sine WAV via ffmpeg's lavfi source. */
export function makeWav(ffmpeg: string, path: string, seconds = 1): string {
  const r = spawnSync(
    ffmpeg,
    ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-y', path],
    { shell: false, stdio: ['ignore', 'ignore', 'pipe'], timeout: 60_000 }
  )
  if (r.status !== 0) throw new Error(`ffmpeg failed to create ${path}: ${r.stderr?.toString() ?? ''}`)
  return path
}

export function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function listNames(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : []
}

export function readHead(path: string, bytes: number): Buffer {
  return readFileSync(path).subarray(0, bytes)
}

/** Magic-byte checks for outputs that sharp cannot decode. */
export const magic = {
  pdf: (path: string): boolean => readHead(path, 5).toString('latin1') === '%PDF-',
  zip: (path: string): boolean => readHead(path, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  /** MP3: ID3v2 tag or an MPEG audio frame sync (11 set bits). */
  mp3: (path: string): boolean => {
    const h = readHead(path, 3)
    if (h.toString('latin1') === 'ID3') return true
    return h.length >= 2 && h[0] === 0xff && ((h[1] ?? 0) & 0xe0) === 0xe0
  }
}

export async function pdfPageCount(path: string): Promise<number> {
  const doc = await PDFDocument.load(readFileSync(path))
  return doc.getPageCount()
}

export async function imageInfo(path: string): Promise<{ format: string | undefined; width: number | undefined; height: number | undefined }> {
  const m = await sharp(path).metadata()
  return { format: m.format, width: m.width, height: m.height }
}
