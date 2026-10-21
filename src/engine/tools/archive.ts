// ZIP / Unzip with yazl / yauzl.
// Unzip safety: rejects entries that would land outside the target folder (zip-slip), skips
// symlinks, refuses encrypted entries and caps entry count / total uncompressed size (zip bombs).
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readdir } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Entry } from 'yauzl'
import { EngineError, cancelledOrTimeout, invalidInput, isAbortError, throwIfAborted } from '../errors'
import { numberedName, splitName } from '../output'

export const MAX_ENTRIES = 50_000
export const MAX_TOTAL_UNCOMPRESSED = 4 * 1024 ** 3

const ZIP_BOMB = 'This zip would unpack to more than 4 GB. That looks like a zip bomb, so I refused.'
const UNSAFE_PATHS = 'This zip contains files with unsafe paths (they would land outside the folder), so I refused to unpack it.'
const S_IFMT = 0o170000
const S_IFLNK = 0o120000
const S_IFDIR = 0o040000

/** Characters Windows refuses in file names. */
const WIN_INVALID = /[<>:"|?*\u0000-\u001f]/g

/**
 * Resolve an entry name inside `dest`, or return undefined if it is unsafe (absolute path, drive
 * letter, ".." segment, or anything resolving outside `dest`).
 */
export function safeEntryPath(dest: string, entryName: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const name = entryName.replace(/\\/g, '/')
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return undefined
  const segments = name.split('/').filter((s) => s !== '' && s !== '.')
  if (segments.length === 0) return undefined
  if (segments.some((s) => s === '..')) return undefined
  const clean = platform === 'win32' ? segments.map((s) => s.replace(WIN_INVALID, '_').replace(/[. ]+$/, '_')) : segments
  const root = resolve(dest)
  const target = resolve(root, ...clean)
  if (target !== root && !target.startsWith(root.endsWith(sep) ? root : root + sep)) return undefined
  return target
}

export interface EntryInfo {
  fileName: string
  externalFileAttributes: number
  versionMadeBy: number
}

/** True for entries created on Unix with a symlink mode. */
export function isSymlinkEntry(e: EntryInfo): boolean {
  const unixMadeBy = e.versionMadeBy >> 8 === 3
  return unixMadeBy && ((e.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK
}

export function isDirectoryEntry(e: EntryInfo): boolean {
  if (e.fileName.endsWith('/') || e.fileName.endsWith('\\')) return true
  return e.versionMadeBy >> 8 === 3 && ((e.externalFileAttributes >>> 16) & S_IFMT) === S_IFDIR
}

function counting(onBytes: (n: number) => void): Transform {
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      onBytes(chunk.length)
      cb(null, chunk)
    }
  })
}

function mapUnzipError(err: unknown, signal: AbortSignal): EngineError {
  if (err instanceof EngineError) return err
  if (isAbortError(err) || signal.aborted) return cancelledOrTimeout(signal)
  if (/invalid relative path|absolute path/i.test(String(err))) return invalidInput(UNSAFE_PATHS, err)
  return invalidInput("I couldn't unpack this zip file. It may be damaged or use an unsupported format.", err)
}

/** Extract `zipPath` into the (empty) folder `dest`. Returns the number of files written. */
export async function unzipTo(zipPath: string, dest: string, signal: AbortSignal, onProgress: (p: number) => void): Promise<number> {
  const yauzl = await import('yauzl')
  let zip
  try {
    zip = await yauzl.openPromise(zipPath, { autoClose: false, decodeStrings: true, validateEntrySizes: true, strictFileNames: false })
  } catch (err) {
    throw invalidInput("I couldn't open this zip file. It may be damaged.", err)
  }
  try {
    if (zip.entryCount > MAX_ENTRIES) {
      throw invalidInput(`This zip has more than ${MAX_ENTRIES.toLocaleString('en-US')} files. That's too many for me to unpack safely.`)
    }
    // Pass 1: read the whole central directory and validate everything BEFORE writing anything.
    const plan: { entry: Entry; target: string; dir: boolean }[] = []
    let declared = 0
    try {
      for await (const entry of zip.eachEntry()) {
        throwIfAborted(signal)
        if (isSymlinkEntry(entry)) continue // never materialise links
        const target = safeEntryPath(dest, entry.fileName)
        if (!target) throw invalidInput(UNSAFE_PATHS, entry.fileName)
        if (isDirectoryEntry(entry)) {
          plan.push({ entry, target, dir: true })
          continue
        }
        if (entry.isEncrypted()) throw invalidInput('This zip is password-protected, so I cannot unpack it.')
        declared += entry.uncompressedSize
        if (declared > MAX_TOTAL_UNCOMPRESSED) throw invalidInput(ZIP_BOMB)
        plan.push({ entry, target, dir: false })
      }
    } catch (err) {
      throw mapUnzipError(err, signal)
    }
    // Pass 2: extract. Actual bytes are counted too (yauzl also checks declared sizes).
    let written = 0
    let files = 0
    const fileCount = plan.filter((p) => !p.dir).length
    try {
      for (const { entry, target, dir } of plan) {
        throwIfAborted(signal)
        if (dir) {
          await mkdir(target, { recursive: true })
          continue
        }
        await mkdir(resolve(target, '..'), { recursive: true })
        const stream = await zip.openReadStreamPromise(entry)
        await pipeline(
          stream,
          counting((n) => {
            written += n
            if (written > MAX_TOTAL_UNCOMPRESSED) stream.destroy(new EngineError('INPUT_INVALID', ZIP_BOMB))
          }),
          createWriteStream(target),
          { signal }
        )
        files++
        onProgress(files / Math.max(1, fileCount))
      }
    } catch (err) {
      throw mapUnzipError(err, signal)
    }
    return files
  } finally {
    zip.close()
  }
}

export interface ZipInput {
  path: string
  isDirectory: boolean
}

interface PlannedEntry {
  real?: string
  meta: string
  dir: boolean
  size: number
  mtime: Date
  mode: number
}

/** Unique top-level names inside the archive ("a.txt", "a (1).txt" for collisions). */
export function uniqueRootNames(paths: readonly string[]): string[] {
  const used = new Set<string>()
  return paths.map((p) => {
    const name = basename(p) || 'item'
    const { base, ext } = splitName(name)
    for (let n = 0; ; n++) {
      const candidate = numberedName(base, ext, n)
      if (!used.has(candidate.toLowerCase())) {
        used.add(candidate.toLowerCase())
        return candidate
      }
    }
  })
}

async function planEntries(inputs: readonly ZipInput[], signal: AbortSignal): Promise<PlannedEntry[]> {
  const out: PlannedEntry[] = []
  const roots = uniqueRootNames(inputs.map((i) => i.path))
  const walk = async (real: string, meta: string): Promise<void> => {
    throwIfAborted(signal)
    const st = await lstat(real)
    if (st.isSymbolicLink()) return // never follow links (loops, escaping the folder)
    if (st.isDirectory()) {
      const children = (await readdir(real)).sort()
      if (children.length === 0) out.push({ meta: `${meta}/`, dir: true, size: 0, mtime: st.mtime, mode: st.mode })
      for (const c of children) await walk(join(real, c), `${meta}/${c}`)
      if (out.length > MAX_ENTRIES) throw invalidInput(`That's more than ${MAX_ENTRIES.toLocaleString('en-US')} files. Too many for one zip.`)
      return
    }
    if (st.isFile()) out.push({ real, meta, dir: false, size: st.size, mtime: st.mtime, mode: st.mode })
  }
  for (let i = 0; i < inputs.length; i++) await walk(inputs[i]!.path, roots[i]!)
  return out
}

/** Zip files and folders (relative structure preserved) into `outFile`. Returns the entry count. */
export async function zipTo(inputs: readonly ZipInput[], outFile: string, signal: AbortSignal, onProgress: (p: number) => void): Promise<number> {
  const yazl = await import('yazl')
  const entries = await planEntries(inputs, signal)
  const total = entries.reduce((n, e) => n + e.size, 0)
  let done = 0
  const zip = new yazl.ZipFile()
  for (const e of entries) {
    if (e.dir) {
      zip.addEmptyDirectory(e.meta, { mtime: e.mtime, mode: e.mode })
      continue
    }
    const real = e.real!
    zip.addReadStreamLazy(e.meta, { mtime: e.mtime, mode: e.mode }, (cb) => {
      const rs = createReadStream(real)
      rs.on('data', (chunk) => {
        done += chunk.length
        onProgress(total > 0 ? done / total : -1)
      })
      cb(null, rs)
    })
  }
  zip.end()
  try {
    await pipeline(zip.outputStream, createWriteStream(outFile), { signal })
  } catch (err) {
    if (isAbortError(err)) throw cancelledOrTimeout(signal)
    throw err
  }
  return entries.length
}
