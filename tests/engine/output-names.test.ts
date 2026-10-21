// B-053 / QA3-08, TPM D23: over-long output names are shortened (stem only, at a character
// boundary; suffix, collision number and extension kept) so they fit 255 UTF-8 bytes on every OS
// and the full-path limit where relevant. Never fail for name length alone.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  MAX_NAME_BYTES,
  WIN_MAX_PATH,
  commitDir,
  commitFile,
  convertedName,
  mergedName,
  numberedName,
  pagesFolderName,
  splitName,
  suffixedName,
  truncateTo,
  unzipFolderName,
  zipName
} from '../../src/engine/output'
import { makeTempDir } from '../helpers/fixtures'
import { runOption } from '../helpers/engine'

let dir = ''
let cleanup: () => Promise<void> = async () => undefined
beforeAll(async () => {
  ;({ dir, cleanup } = await makeTempDir('lud-names-'))
})
afterAll(() => cleanup())

const bytes = (s: string): number => Buffer.byteLength(s, 'utf8')
/** No U+FFFD and no lone surrogate: the shortened name is still valid Unicode. */
const wellFormed = (s: string): boolean => Buffer.from(s, 'utf8').toString('utf8') === s && !/\p{Cs}/u.test(s)
const COLLISION = ' (9999)'

describe('names fit 255 UTF-8 bytes', () => {
  it('ASCII: keeps "-compressed" and the extension, shortens the stem (QA NASTY-LONG-2)', () => {
    const out = suffixedName(`${'L'.repeat(246)}.png`, '-compressed', 'png')
    expect(out).toMatch(/^L+-compressed\.png$/)
    expect(bytes(out) + COLLISION.length).toBeLessThanOrEqual(MAX_NAME_BYTES)
    // the collision number " (n)" still fits
    expect(bytes(numberedName(splitName(out).base, 'png', 9999))).toBeLessThanOrEqual(MAX_NAME_BYTES)
  })

  it('names that fit are unchanged', () => {
    expect(suffixedName('photo.jpg', '-nobg', 'png')).toBe('photo-nobg.png')
    expect(convertedName(`${'a'.repeat(200)}.png`, 'jpg')).toBe(`${'a'.repeat(200)}.jpg`)
    expect(pagesFolderName('doc.pdf', { dir: '/tmp' })).toBe('doc (pages)')
  })

  it('every builder keeps its tail', () => {
    const long = `${'x'.repeat(250)}.pdf`
    const cases: [string, string][] = [
      [convertedName(long, 'docx'), '.docx'],
      [suffixedName(long, '-compressed'), '-compressed.pdf'],
      [pagesFolderName(long), ' (pages)'],
      [mergedName(long, 'pdf'), ' (merged).pdf'],
      [zipName([long], false), '.zip'],
      [zipName(['y'.repeat(255)], true), '.zip'],
      [unzipFolderName(`${'z'.repeat(251)}.zip`), 'zzz']
    ]
    for (const [name, tail] of cases) {
      expect(name.endsWith(tail), name).toBe(true)
      expect(bytes(name) + COLLISION.length, name).toBeLessThanOrEqual(MAX_NAME_BYTES)
    }
  })

  it('emoji (4-byte, surrogate pairs, ZWJ and flag sequences) and accents are never split', () => {
    for (const unit of ['😀', '👨‍👩‍👧‍👦', '🇫🇷', 'e\u0301']) {
      const out = suffixedName(`${unit.repeat(80)}.mov`, '-compressed')
      expect(out.endsWith('-compressed.mov')).toBe(true)
      expect(bytes(out)).toBeLessThanOrEqual(MAX_NAME_BYTES)
      expect(wellFormed(out)).toBe(true)
      const stem = out.slice(0, -'-compressed.mov'.length)
      expect(stem.length).toBeGreaterThan(0)
      expect(stem, `${unit}: cut inside a character`).toBe(unit.repeat(stem.length / unit.length))
    }
  })

  it('CJK (3-byte) names', () => {
    const stem = '漢字かな'.repeat(25) // 300 bytes
    const out = convertedName(`${stem}.docx`, 'pdf')
    expect(out.endsWith('.pdf')).toBe(true)
    expect(bytes(out)).toBeLessThanOrEqual(MAX_NAME_BYTES)
    expect(wellFormed(out)).toBe(true)
    expect(stem.startsWith(out.slice(0, -4))).toBe(true)
    expect(out.length - 4).toBeGreaterThan(70) // shortened, not emptied
  })

  it('a shortened stem never ends with a dot or space (Windows strips them)', () => {
    expect(suffixedName(`${'ab. '.repeat(70)}.png`, '-nobg', 'png')).toMatch(/[^. ]-nobg\.png$/)
    expect(unzipFolderName(`${'cd. '.repeat(70)}.zip`)).toMatch(/[^. ]$/)
  })

  it('truncateTo cuts at character boundaries only', () => {
    expect(truncateTo('a😀b', 4)).toBe('a')
    expect(truncateTo('a😀b', 5)).toBe('a😀')
    expect(truncateTo('漢字', 5)).toBe('漢')
    expect(truncateTo('short', 255)).toBe('short')
  })

  it('commit safety net: a too-long name given directly is shortened, not refused', async () => {
    const temp = join(dir, '.tmp-long')
    await writeFile(temp, 'x')
    const final = await commitFile(temp, dir, `${'Q'.repeat(300)}.txt`)
    const name = final.slice(dir.length + 1)
    expect(name).toMatch(/^Q+\.txt$/)
    expect(bytes(name)).toBeLessThanOrEqual(MAX_NAME_BYTES)
    expect(await readFile(final, 'utf8')).toBe('x')

    // and a collision with that shortened name gets " (1)" without exceeding the limit
    const temp2 = join(dir, '.tmp-long2')
    await writeFile(temp2, 'y')
    const second = await commitFile(temp2, dir, `${'Q'.repeat(300)}.txt`)
    expect(second.slice(dir.length + 1)).toMatch(/^Q+ \(1\)\.txt$/)
    expect(bytes(second.slice(dir.length + 1))).toBeLessThanOrEqual(MAX_NAME_BYTES)

    const tempDir = join(dir, '.tmp-dir')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(tempDir)
    const folder = await commitDir(tempDir, dir, '😀'.repeat(70))
    expect(bytes(folder.slice(dir.length + 1))).toBeLessThanOrEqual(MAX_NAME_BYTES)
  })
})

describe('name-too-long errors are reported as such', () => {
  it('ENAMETOOLONG → OUTPUT_NOT_WRITABLE saying the name/path is too long (not "doesn\'t let me write")', async () => {
    const { OutputStager } = await import('../../src/engine/output')
    const stager = new OutputStager()
    const err = await stager.tempFile(join(dir, 'd'.repeat(300)), 'png').catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'OUTPUT_NOT_WRITABLE' })
    expect((err as Error).message).toMatch(/too long/)
  })
})

describe('full path budget', () => {
  it('Windows: stays within MAX_PATH (259) when the input fits it', () => {
    const winDir = `C:\\Users\\me\\${'deep\\'.repeat(30)}photos`
    const input = `${'p'.repeat(85)}.png`
    expect(`${winDir}\\${input}`.length).toBeLessThanOrEqual(WIN_MAX_PATH)
    const out = suffixedName(input, '-compressed', 'png', { dir: winDir, platform: 'win32' })
    expect(out).toMatch(/^p+-compressed\.png$/)
    expect(`${winDir}\\${out}`.length + COLLISION.length).toBeLessThanOrEqual(WIN_MAX_PATH)
    // the same name in a short folder is not shortened
    expect(suffixedName(input, '-compressed', 'png', { dir: 'C:\\x', platform: 'win32' })).toBe(`${'p'.repeat(85)}-compressed.png`)
  })

  it('Windows: when the input path is already longer than MAX_PATH (long paths enabled), no path shortening', () => {
    const winDir = `D:\\${'long-folder-name\\'.repeat(15)}x`
    const input = `${'n'.repeat(40)}.wav`
    expect(`${winDir}\\${input}`.length).toBeGreaterThan(WIN_MAX_PATH)
    expect(convertedName(input, 'mp3', { dir: winDir, platform: 'win32' })).toBe(`${'n'.repeat(40)}.mp3`)
  })

  it('Windows: keeps a minimum stem when the folder alone is near the limit', () => {
    const winDir = `C:\\${'f'.repeat(230)}`
    expect(suffixedName(`${'s'.repeat(14)}.png`, '-nobg', 'png', { dir: winDir, platform: 'win32' })).toBe(`${'s'.repeat(14)}-nobg.png`)
    const out = suffixedName(`${'s'.repeat(20)}.png`, '-nobg', 'png', { dir: winDir, platform: 'win32' })
    expect(out).toBe(`${'s'.repeat(16)}-nobg.png`)
  })

  it('Windows: the pages folder leaves room for the page files inside', () => {
    const winDir = `C:\\${'d'.repeat(150)}`
    const folder = pagesFolderName(`${'r'.repeat(95)}.pdf`, { dir: winDir, platform: 'win32' })
    expect(folder).toMatch(/^r+ \(pages\)$/)
    expect(`${winDir}\\${folder}${COLLISION}\\page-0001.png`.length).toBeLessThanOrEqual(WIN_MAX_PATH + 2)
  })

  it('Windows: counts UTF-16 units for the path (emoji = 2)', () => {
    const winDir = `C:\\${'e'.repeat(150)}`
    const out = suffixedName(`${'😀'.repeat(50)}.jpg`, '-nobg', 'png', { dir: winDir, platform: 'win32' })
    expect(wellFormed(out)).toBe(true)
    expect(`${winDir}\\${out}`.length + COLLISION.length).toBeLessThanOrEqual(WIN_MAX_PATH)
  })

  it('macOS: PATH_MAX 1024 bytes', () => {
    const macDir = `/Users/me/${'very-long-folder/'.repeat(57)}`.slice(0, -1)
    const out = suffixedName(`${'m'.repeat(40)}.mov`, '-compressed', undefined, { dir: macDir, platform: 'darwin' })
    expect(out).toMatch(/^m+-compressed\.mov$/)
    expect(bytes(`${macDir}/${out}${COLLISION}`)).toBeLessThanOrEqual(1023)
  })

  it('Linux: an ordinary folder adds no shortening beyond the 255-byte rule', () => {
    const input = `${'L'.repeat(246)}.png`
    expect(suffixedName(input, '-compressed', 'png', { dir: '/home/me/Pictures', platform: 'linux' })).toBe(suffixedName(input, '-compressed', 'png'))
  })
})

describe('engine: long names end to end (QA3-08)', () => {
  it('246×"L".png → Compress succeeds with a shortened "-compressed" name', async () => {
    const src = join(dir, `${'L'.repeat(246)}.png`)
    await sharp({ create: { width: 16, height: 16, channels: 3, background: '#cc3333' } }).png().toFile(src)
    const res = await runOption('compress', [src])
    expect(res.error, JSON.stringify(res.error)).toBeUndefined()
    const name = res.outputPaths[0]!.slice(dir.length + 1)
    expect(name).toMatch(/^L+-compressed\.png$/)
    expect(bytes(name)).toBeLessThanOrEqual(MAX_NAME_BYTES)
  })

  it('emoji name: Remove-BG-style suffix and extension kept, no broken characters', async () => {
    const src = join(dir, `${'🐱'.repeat(62)}.png`) // 248 + 4 bytes
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#33cc33' } }).png().toFile(src)
    const res = await runOption('compress', [src])
    expect(res.error, JSON.stringify(res.error)).toBeUndefined()
    const name = res.outputPaths[0]!.slice(dir.length + 1)
    expect(name).toMatch(/^(🐱)+-compressed\.png$/u)
    expect(bytes(name)).toBeLessThanOrEqual(MAX_NAME_BYTES)
  })

  it('CJK name → to-jpg keeps working', async () => {
    const src = join(dir, `${'写真'.repeat(41)}.png`) // 250 bytes
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3333cc' } }).png().toFile(src)
    const res = await runOption('to-jpg', [src])
    expect(res.error, JSON.stringify(res.error)).toBeUndefined()
    const name = res.outputPaths[0]!.slice(dir.length + 1)
    expect(name).toMatch(/^[写真]+\.jpg$/u)
    expect(bytes(name)).toBeLessThanOrEqual(MAX_NAME_BYTES)
  })
})
