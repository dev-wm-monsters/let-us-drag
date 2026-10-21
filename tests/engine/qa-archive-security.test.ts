// QA security fixtures for Unzip (docs/security/CHECKLIST.md §E: SEC-100..SEC-104).
// Hostile archives are generated at test time (rawZip for names yazl refuses, yazl for compressed
// bombs). Every test checks the observable outcome at JOB level: the job result, what exists in
// the work folder afterwards, and that nothing was written outside the extraction folder.
//
// Tests titled "[needs-p2]" check checklist requirements that the current engine does not meet yet
// (expected to turn green once the phase-2 engine work is merged). They are deliberately active.
import { createWriteStream } from 'node:fs'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { safeEntryPath } from '../../src/engine/tools/archive'
import { runOption } from '../helpers/engine'
import { makeTempDir, rawZip, type RawZipEntry } from '../helpers/fixtures'

let root = ''
let cleanup: () => Promise<void> = async () => undefined

beforeAll(async () => {
  ;({ dir: root, cleanup } = await makeTempDir('lud-qa-zip-'))
})
afterAll(() => cleanup())

let caseCounter = 0
/** A fresh "case" folder: <root>/case-N/work holds the zip; <root>/case-N is the "outside". */
async function freshCase(): Promise<{ outside: string; work: string }> {
  const outside = join(root, `case-${++caseCounter}`)
  const work = join(outside, 'work')
  await mkdir(work, { recursive: true })
  return { outside, work }
}

/** Every path below `dir` (relative, forward slashes), including directories and links. */
async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  const visit = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const full = join(d, e.name)
      out.push(relative(dir, full).split(sep).join('/'))
      if (e.isDirectory()) await visit(full)
    }
  }
  await visit(dir)
  return out.sort()
}

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
/** Windows treats "CON", "con.txt", "Aux.tar.gz" (stem before the first dot, trailing spaces ignored) as devices. */
function isWindowsReservedName(name: string): boolean {
  const stem = name.split('.')[0]!.replace(/[ ]+$/, '')
  return WIN_RESERVED.test(stem)
}

describe('QA unzip: path traversal (zip-slip) — CONV-ZIP-02 / SEC-101', () => {
  const evilNames = ['../evil.txt', 'a/../../evil.txt', '..\\evil.txt', '/abs-evil.txt', 'C:/evil.txt', 'ok/../../../evil.txt']

  for (const evil of evilNames) {
    it(`refuses "${evil}" with INPUT_INVALID and writes nothing anywhere`, async () => {
      const { outside, work } = await freshCase()
      const zipPath = join(work, 'slip.zip')
      // A harmless entry first: a streaming extractor would already have written it.
      await writeFile(zipPath, rawZip([{ name: 'first.txt', data: 'harmless' }, { name: evil, data: 'pwned' }]))
      const res = await runOption('unzip', [zipPath])
      expect(res.error?.code, JSON.stringify(res.error)).toBe('INPUT_INVALID')
      expect(res.outputPaths).toEqual([])
      expect(await walk(outside), 'nothing may be created next to or above the zip').toEqual(['work', 'work/slip.zip'])
    })
  }

  it('absolute path in the entry name never reaches the absolute location', async () => {
    const { work } = await freshCase()
    const target = join(root, 'absolute-target.txt')
    const zipPath = join(work, 'abs.zip')
    await writeFile(zipPath, rawZip([{ name: target.split(sep).join('/'), data: 'pwned' }]))
    const res = await runOption('unzip', [zipPath])
    expect(res.error?.code).toBe('INPUT_INVALID')
    await expect(lstat(target)).rejects.toThrow()
  })
})

describe('QA unzip: symlink entries — CONV-ZIP-03 / SEC-102', () => {
  it('a symlink entry is never materialised as a link; regular files still extract', async () => {
    const { outside, work } = await freshCase()
    const secret = join(outside, 'secret.txt')
    await writeFile(secret, 'TOP-SECRET')
    const zipPath = join(work, 'links.zip')
    const entries: RawZipEntry[] = [
      { name: 'link-to-secret', data: secret, unixMode: 0o120777 },
      { name: 'ok.txt', data: 'fine', unixMode: 0o100644 }
    ]
    await writeFile(zipPath, rawZip(entries))
    const res = await runOption('unzip', [zipPath])
    expect(res.error, JSON.stringify(res.error)).toBeUndefined()
    expect(res.outputPaths).toHaveLength(1)
    const dest = res.outputPaths[0]!
    expect(await readFile(join(dest, 'ok.txt'), 'utf8')).toBe('fine')
    for (const rel of await walk(dest)) {
      const st = await lstat(join(dest, rel))
      expect(st.isSymbolicLink(), `${rel} must not be a symlink`).toBe(false)
      if (st.isFile()) expect(await readFile(join(dest, rel), 'utf8')).not.toContain('TOP-SECRET')
    }
  })

  it('two-step attack (symlink dir entry, then a file "through" it) cannot write outside', async () => {
    const { outside, work } = await freshCase()
    const victimDir = join(outside, 'victim')
    await mkdir(victimDir)
    const zipPath = join(work, 'twostep.zip')
    await writeFile(
      zipPath,
      rawZip([
        { name: 'escape', data: victimDir, unixMode: 0o120777 },
        { name: 'escape/pwned.txt', data: 'pwned', unixMode: 0o100644 }
      ])
    )
    const res = await runOption('unzip', [zipPath])
    // Either refused or extracted as a plain folder — but the victim folder must stay empty.
    expect(await readdir(victimDir)).toEqual([])
    if (!res.error) {
      const dest = res.outputPaths[0]!
      expect((await lstat(join(dest, 'escape'))).isSymbolicLink()).toBe(false)
    }
  })
})

describe('QA unzip: Windows reserved device names — SEC-101', () => {
  const reserved = ['CON', 'con.txt', 'sub/AUX.log', 'LPT1', 'Com3.tar.gz', 'nul ']

  it('[needs-p2] SEC-101 safeEntryPath(win32) never yields a reserved device name', () => {
    const dest = resolve(root, 'dest')
    for (const name of reserved) {
      const target = safeEntryPath(dest, name, 'win32')
      if (target === undefined) continue // refusing is fine
      expect(isWindowsReservedName(basename(target)), `${name} → ${target}`).toBe(false)
    }
  })

  it('[needs-p2] SEC-101 unzip never creates CON/AUX/LPT1/… files (refuses or renames)', async () => {
    const { work } = await freshCase()
    const zipPath = join(work, 'devices.zip')
    await writeFile(zipPath, rawZip([...reserved.map((name) => ({ name, data: 'x' })), { name: 'ok.txt', data: 'fine' }]))
    const res = await runOption('unzip', [zipPath])
    if (res.error) {
      expect(res.error.code).toBe('INPUT_INVALID')
      expect(await walk(work)).toEqual(['devices.zip'])
      return
    }
    const dest = res.outputPaths[0]!
    const created = await walk(dest)
    const bad = created.filter((rel) => isWindowsReservedName(rel.split('/').pop()!))
    expect(bad, `reserved names created: ${bad.join(', ')}`).toEqual([])
  })
})

/** Deflated zip with one entry of `bytes` zero bytes (ratio ≈ 1000:1). */
async function zeroBombZip(path: string, bytes: number, entryName = 'zeros.bin'): Promise<void> {
  const yazl = await import('yazl')
  const zip = new yazl.ZipFile()
  const chunk = Buffer.alloc(1024 * 1024)
  let left = bytes
  const zeros = new Readable({
    read() {
      if (left <= 0) return void this.push(null)
      const n = Math.min(left, chunk.length)
      left -= n
      this.push(n === chunk.length ? chunk : chunk.subarray(0, n))
    }
  })
  zip.addReadStream(zeros, entryName, { compressionLevel: 9 })
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(path))
}

describe('QA unzip: compression-ratio bomb — CONV-ZIP-05 / SEC-103', () => {
  it('[needs-p2] SEC-103 a 256 MiB-of-zeros entry (~1000:1) is refused quickly with INPUT_INVALID', async () => {
    const { outside, work } = await freshCase()
    const zipPath = join(work, 'ratio.zip')
    await zeroBombZip(zipPath, 256 * 1024 * 1024)
    const zipSize = (await lstat(zipPath)).size
    expect(zipSize, 'fixture sanity: the archive itself is tiny').toBeLessThan(1024 * 1024)
    const started = Date.now()
    const res = await runOption('unzip', [zipPath])
    const ms = Date.now() - started
    expect(res.error?.code, `result: ${JSON.stringify(res.error ?? res.outputPaths)}`).toBe('INPUT_INVALID')
    expect(ms, 'must be refused from the central directory, before inflating').toBeLessThan(10_000)
    expect(await walk(outside)).toEqual(['work', 'work/ratio.zip'])
  })
})
