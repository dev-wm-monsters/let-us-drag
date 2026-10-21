import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  OutputStager,
  commitDir,
  commitFile,
  convertedName,
  mergedName,
  numberedName,
  pagesFolderName,
  renameRetrying,
  splitName,
  suffixedName,
  unzipFolderName,
  zipName
} from '../../src/engine/output'
import { makeTempDir } from '../helpers/fixtures'

let dir = ''
let cleanup: () => Promise<void> = async () => undefined
beforeAll(async () => {
  ;({ dir, cleanup } = await makeTempDir('lud-out-'))
})
afterAll(() => cleanup())

describe('naming (PLAN §3.7)', () => {
  it('splits names', () => {
    expect(splitName('photo.final.PNG')).toEqual({ base: 'photo.final', ext: 'PNG' })
    expect(splitName('.bashrc')).toEqual({ base: '.bashrc', ext: '' })
    expect(splitName('README')).toEqual({ base: 'README', ext: '' })
  })

  it('numbers collisions as "name (n).ext"', () => {
    expect(numberedName('photo', 'png', 0)).toBe('photo.png')
    expect(numberedName('photo', 'png', 2)).toBe('photo (2).png')
    expect(numberedName('Folder', '', 1)).toBe('Folder (1)')
  })

  it('builds every output name', () => {
    expect(convertedName('photo.png', 'jpg')).toBe('photo.jpg')
    expect(suffixedName('photo.jpg', '-nobg', 'png')).toBe('photo-nobg.png')
    expect(suffixedName('clip.mov', '-compressed')).toBe('clip-compressed.mov')
    expect(pagesFolderName('doc.pdf')).toBe('doc (pages)')
    expect(mergedName('photo.png', 'pdf')).toBe('photo (merged).pdf')
    expect(unzipFolderName('photos.zip')).toBe('photos')
    expect(zipName(['a.txt', 'b.txt'], false)).toBe('Archive.zip')
    expect(zipName(['a.txt'], false)).toBe('a.zip')
    expect(zipName(['My.Folder'], true)).toBe('My.Folder.zip')
  })
})

describe('atomic commit, never overwrite', () => {
  it('commitFile picks the next free name and keeps existing files intact', async () => {
    await writeFile(join(dir, 'x.txt'), 'original')
    await writeFile(join(dir, 'x (1).txt'), 'also original')
    const temp = join(dir, '.tmp1')
    await writeFile(temp, 'new')
    const final = await commitFile(temp, dir, 'x.txt')
    expect(final).toBe(join(dir, 'x (2).txt'))
    expect(await readFile(join(dir, 'x.txt'), 'utf8')).toBe('original')
    expect(await readFile(final, 'utf8')).toBe('new')
    expect(await readdir(dir)).not.toContain('.tmp1')
  })

  it('commitDir never merges into an existing folder', async () => {
    await mkdir(join(dir, 'pages'))
    await writeFile(join(dir, 'pages', 'keep.txt'), 'k')
    const temp = join(dir, '.tmpdir')
    await mkdir(temp)
    await writeFile(join(temp, 'p1.png'), 'p')
    const final = await commitDir(temp, dir, 'pages')
    expect(final).toBe(join(dir, 'pages (1)'))
    expect(await readdir(join(dir, 'pages'))).toEqual(['keep.txt'])
  })

  it('commitFile falls back to an exclusive copy whatever error link() gives (FAT/exFAT/network drives)', async () => {
    const sub = join(dir, 'nolinks')
    await mkdir(sub)
    await writeFile(join(sub, 'y.txt'), 'original')
    // Windows reports CreateHardLink on FAT/exFAT (ERROR_INVALID_FUNCTION) as EISDIR; Linux vfat
    // says EPERM, macOS msdosfs ENOTSUP, some SMB servers something else again.
    for (const code of ['EISDIR', 'EPERM', 'ENOTSUP', 'EINVAL', 'UNKNOWN']) {
      const temp = join(sub, `.tmp-${code}`)
      await writeFile(temp, code)
      let calls = 0
      const noLinks = async (): Promise<void> => {
        calls++
        throw Object.assign(new Error(`link failed: ${code}`), { code })
      }
      const final = await commitFile(temp, sub, 'y.txt', noLinks)
      expect(calls).toBe(1) // not retried once we know hard links don't work here
      expect(await readFile(final, 'utf8')).toBe(code)
      expect(await readdir(sub)).not.toContain(`.tmp-${code}`)
    }
    expect(await readFile(join(sub, 'y.txt'), 'utf8')).toBe('original')
    expect((await readdir(sub)).sort()).toEqual(['y (1).txt', 'y (2).txt', 'y (3).txt', 'y (4).txt', 'y (5).txt', 'y.txt'])
  })

  it('commitFile still reports OUTPUT_NOT_WRITABLE when the copy fails too', async () => {
    const noLinks = async (): Promise<void> => {
      throw Object.assign(new Error('nope'), { code: 'EPERM' })
    }
    await expect(commitFile(join(dir, 'no-such-temp'), join(dir, 'no-such-dir'), 'z.txt', noLinks)).rejects.toMatchObject({ code: 'OUTPUT_NOT_WRITABLE' })
  })

  it('renameRetrying retries transient Windows sharing violations only', async () => {
    let n = 0
    const flaky = async (): Promise<void> => {
      if (++n < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
    }
    await renameRetrying('a', 'b', 'win32', flaky)
    expect(n).toBe(3)
    n = 0
    await expect(renameRetrying('a', 'b', 'linux', flaky)).rejects.toMatchObject({ code: 'EBUSY' })
    expect(n).toBe(1)
    const gone = async (): Promise<void> => {
      n++
      throw Object.assign(new Error('gone'), { code: 'ENOENT' })
    }
    n = 0
    await expect(renameRetrying('a', 'b', 'win32', gone)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(n).toBe(1)
  })

  it('OutputStager: temp files are hidden, committed in order, the rest cleaned up', async () => {
    const sub = join(dir, 'stager')
    await mkdir(sub)
    const s = new OutputStager()
    const a = await s.tempFile(sub, 'png')
    const b = await s.tempFile(sub, 'png')
    expect(a).toMatch(/[\\/]\.lud-[0-9a-f]{12}\.tmp\.png$/)
    await writeFile(a, 'a')
    s.stage(a, sub, 'out.png')
    const finals = await s.commitAll()
    expect(finals).toEqual([join(sub, 'out.png')])
    await s.cleanup()
    expect(await readdir(sub)).toEqual(['out.png'])
    expect(b).not.toBe(a)
  })

  it('cleanup() removes everything when a job fails', async () => {
    const sub = join(dir, 'failed')
    await mkdir(sub)
    const s = new OutputStager()
    const t = await s.tempFile(sub, 'mp4')
    await writeFile(t, 'partial')
    const d = await s.tempDir(sub)
    await writeFile(join(d, 'page.png'), 'x')
    s.stage(t, sub, 'video.mp4')
    await s.cleanup()
    expect(await readdir(sub)).toEqual([])
  })

  it('OUTPUT_NOT_WRITABLE when the target folder is not a writable directory', async () => {
    const notADir = join(dir, 'file-not-dir')
    await writeFile(notADir, 'x')
    await expect(new OutputStager().tempFile(notADir, 'png')).rejects.toMatchObject({ code: 'OUTPUT_NOT_WRITABLE' })
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('OUTPUT_NOT_WRITABLE for a read-only folder (POSIX, non-root)', async () => {
    const { chmod } = await import('node:fs/promises')
    const ro = join(dir, 'readonly')
    await mkdir(ro)
    await chmod(ro, 0o555)
    try {
      await expect(new OutputStager().tempFile(ro, 'png')).rejects.toMatchObject({ code: 'OUTPUT_NOT_WRITABLE' })
    } finally {
      await chmod(ro, 0o755)
    }
  })
})
