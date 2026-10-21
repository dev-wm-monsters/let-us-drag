// ZIP / Unzip: integration plus hostile-archive checks (zip-slip, absolute paths, symlinks, bombs).
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isDirectoryEntry, isSymlinkEntry, safeEntryPath, uniqueRootNames } from '../../src/engine/tools/archive'
import { MAGIC, makeTempDir, rawZip, startsWith, zipFile } from '../helpers/fixtures'
import { convertOk, runOption } from '../helpers/engine'

let dir = ''
let cleanup: () => Promise<void> = async () => undefined

beforeAll(async () => {
  ;({ dir, cleanup } = await makeTempDir('lud-zip-'))
})
afterAll(() => cleanup())

async function listZip(path: string): Promise<string[]> {
  const yauzl = await import('yauzl')
  const zip = await yauzl.openPromise(path)
  const names: string[] = []
  for await (const e of zip.eachEntry()) names.push(e.fileName)
  zip.close()
  return names.sort()
}

describe('archive helpers', () => {
  const root = resolve('/tmp/target')
  it('safeEntryPath rejects traversal, absolute paths and drive letters', () => {
    expect(safeEntryPath(root, 'a/b.txt', 'linux')).toBe(join(root, 'a', 'b.txt'))
    expect(safeEntryPath(root, './a//b.txt', 'linux')).toBe(join(root, 'a', 'b.txt'))
    expect(safeEntryPath(root, '../evil.txt', 'linux')).toBeUndefined()
    expect(safeEntryPath(root, 'a/../../evil.txt', 'linux')).toBeUndefined()
    expect(safeEntryPath(root, '..\\evil.txt', 'linux')).toBeUndefined()
    expect(safeEntryPath(root, '/etc/passwd', 'linux')).toBeUndefined()
    expect(safeEntryPath(root, 'C:/Windows/x', 'win32')).toBeUndefined()
    expect(safeEntryPath(root, '', 'linux')).toBeUndefined()
  })

  it('safeEntryPath makes names Windows-safe on win32', () => {
    expect(safeEntryPath(root, 'ab:c?.txt', 'win32')).toBe(join(root, 'ab_c_.txt'))
    expect(safeEntryPath(root, 'trailing. ', 'win32')).toBe(join(root, 'trailing_'))
  })

  it('detects symlink and directory entries', () => {
    expect(isSymlinkEntry({ fileName: 'l', versionMadeBy: (3 << 8) | 20, externalFileAttributes: (0o120777 << 16) >>> 0 })).toBe(true)
    expect(isSymlinkEntry({ fileName: 'f', versionMadeBy: (3 << 8) | 20, externalFileAttributes: (0o100644 << 16) >>> 0 })).toBe(false)
    expect(isSymlinkEntry({ fileName: 'f', versionMadeBy: 20, externalFileAttributes: (0o120777 << 16) >>> 0 })).toBe(false)
    expect(isDirectoryEntry({ fileName: 'd/', versionMadeBy: 20, externalFileAttributes: 0 })).toBe(true)
  })

  it('uniqueRootNames de-duplicates case-insensitively', () => {
    expect(uniqueRootNames(['/x/a.txt', '/y/A.txt', '/z/a.txt'])).toEqual(['a.txt', 'A (1).txt', 'a (2).txt'])
  })
})

describe('zip', () => {
  it('a single file → "name.zip"', async () => {
    const f = join(dir, 'single', 'notes.txt')
    await mkdir(join(dir, 'single'), { recursive: true })
    await writeFile(f, 'hello')
    const [out] = await convertOk('zip', [f])
    expect(basename(out!)).toBe('notes.zip')
    expect(startsWith(await readFile(out!), MAGIC.zip)).toBe(true)
    expect(await listZip(out!)).toEqual(['notes.txt'])
  })

  it('files + folders (mixed categories) → "Archive.zip", then "Archive (1).zip"; structure preserved', async () => {
    const base = join(dir, 'mixed')
    await mkdir(join(base, 'folder', 'deep'), { recursive: true })
    await mkdir(join(base, 'folder', 'empty'), { recursive: true })
    await writeFile(join(base, 'folder', 'deep', 'x.txt'), 'x')
    await writeFile(join(base, 'photo.png'), 'not really a png')
    await writeFile(join(base, 'song.mp3'), 'not really audio')
    const inputs = [join(base, 'folder'), join(base, 'photo.png'), join(base, 'song.mp3')]
    const [out] = await convertOk('zip', inputs)
    expect(basename(out!)).toBe('Archive.zip')
    expect(await listZip(out!)).toEqual(['folder/deep/x.txt', 'folder/empty/', 'photo.png', 'song.mp3'])
    const [out2] = await convertOk('zip', inputs)
    expect(basename(out2!)).toBe('Archive (1).zip')
  })

  it('a folder alone → "Folder.zip"', async () => {
    const f = join(dir, 'Holiday')
    await mkdir(f, { recursive: true })
    await writeFile(join(f, 'a.txt'), 'a')
    const [out] = await convertOk('zip', [f])
    expect(basename(out!)).toBe('Holiday.zip')
  })
})

describe('unzip', () => {
  it('extracts into a folder named after the archive', async () => {
    const z = await zipFile(join(dir, 'bundle.zip'), { 'a.txt': 'A', 'sub/b.txt': 'B' })
    const [out] = await convertOk('unzip', [z])
    expect(basename(out!)).toBe('bundle')
    expect(await readFile(join(out!, 'sub', 'b.txt'), 'utf8')).toBe('B')
    const [out2] = await convertOk('unzip', [z])
    expect(basename(out2!)).toBe('bundle (1)')
  })

  it('refuses zip-slip entries and writes nothing outside (or inside) the target', async () => {
    const sub = join(dir, 'slip')
    await mkdir(sub, { recursive: true })
    const z = join(sub, 'evil.zip')
    await writeFile(z, rawZip([{ name: 'ok.txt', data: 'ok' }, { name: '../escaped.txt', data: 'pwned' }]))
    const res = await runOption('unzip', [z])
    expect(res.error?.code).toBe('INPUT_INVALID')
    expect(res.error?.message).toMatch(/unsafe paths/)
    expect((await readdir(sub)).sort()).toEqual(['evil.zip'])
    expect(await readdir(dir)).not.toContain('escaped.txt')
  })

  it('refuses absolute entry paths', async () => {
    const sub = join(dir, 'abs')
    await mkdir(sub, { recursive: true })
    const z = join(sub, 'abs.zip')
    await writeFile(z, rawZip([{ name: '/tmp/lud-abs-test.txt', data: 'x' }]))
    expect((await runOption('unzip', [z])).error?.code).toBe('INPUT_INVALID')
    expect(await readdir(sub)).toEqual(['abs.zip'])
  })

  it('skips symlink entries', async () => {
    const z = join(dir, 'links.zip')
    await writeFile(z, rawZip([{ name: 'real.txt', data: 'real', unixMode: 0o100644 }, { name: 'link', data: '/etc/passwd', unixMode: 0o120777 }]))
    const [out] = await convertOk('unzip', [z])
    expect(await readdir(out!)).toEqual(['real.txt'])
  })

  it('refuses archives that declare gigabytes from a few bytes (zip bomb)', async () => {
    // Two entries whose central directory claims ≈ 4 GiB each: rejected before anything is written.
    const buf = rawZip([
      { name: 'b1.bin', data: 'x' },
      { name: 'b2.bin', data: 'y' }
    ])
    const cdOffset = buf.readUInt32LE(buf.length - 22 + 16)
    for (const central of [cdOffset, cdOffset + 46 + 'b1.bin'.length]) {
      buf.writeUInt16LE(8, central + 10) // "deflated", so the size mismatch is not an instant format error
      buf.writeUInt32LE(0xfffffff0, central + 24) // claimed uncompressed size
    }
    const sub = join(dir, 'bomb')
    await mkdir(sub, { recursive: true })
    const z = join(sub, 'bomb.zip')
    await writeFile(z, buf)
    const res = await runOption('unzip', [z])
    expect(res.error?.code).toBe('INPUT_INVALID')
    expect(res.error?.message).toMatch(/zip bomb/)
    expect(await readdir(sub)).toEqual(['bomb.zip'])
  })

  it('a damaged zip → INPUT_INVALID', async () => {
    const z = join(dir, 'broken.zip')
    await writeFile(z, 'PK\u0003\u0004 nope')
    expect((await runOption('unzip', [z])).error?.code).toBe('INPUT_INVALID')
  })
})
