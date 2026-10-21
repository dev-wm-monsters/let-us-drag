// ZIP / Unzip with yazl / yauzl.
// Unzip safety (docs/security/CHECKLIST.md SEC-100…104): yauzl with strict names and size
// validation; every entry name is checked (traversal, absolute, drive letters, control characters,
// over-long components) and made portable (Windows-reserved names and characters, trailing dots and
// spaces) on every OS; case-insensitive duplicates get "name (n)"; symlinks are never created;
// modes are fixed; files are created with O_EXCL; entry count, total size, per-entry ratio and free
// disk space are checked BEFORE anything is written, and actual bytes are counted while writing.
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readdir, stat, statfs } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Entry } from 'yauzl'
import { EngineError, cancelledOrTimeout, invalidInput, isAbortError, throwIfAborted } from '../errors'
import {
  MAX_ZIP_CREATE_BYTES,
  MAX_ZIP_CREATE_ENTRIES,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_RATIO,
  MAX_ZIP_TOTAL_BYTES,
  ZIP_FREE_DISK_MARGIN,
  ZIP_RATIO_MIN_BYTES,
  formatBytes
} from '../limits'
import { numberedName, splitName } from '../output'

export const MAX_ENTRIES = MAX_ZIP_ENTRIES
export const MAX_TOTAL_UNCOMPRESSED = MAX_ZIP_TOTAL_BYTES

const ZIP_BOMB = `This zip would unpack to more than ${formatBytes(MAX_ZIP_TOTAL_BYTES)}. That looks like a zip bomb, so I refused.`
const ZIP_RATIO = 'Something in this zip expands far too much to be a normal file. That looks like a zip bomb, so I refused.'
const UNSAFE_PATHS = 'This zip contains files with unsafe paths (they would land outside the folder), so I refused to unpack it.'
const S_IFMT = 0o170000
const S_IFLNK = 0o120000
const S_IFDIR = 0o040000
/** Fixed modes for everything we extract (SEC-102): no setuid/exec bits from the archive. */
export const EXTRACTED_FILE_MODE = 0o644
export const EXTRACTED_DIR_MODE = 0o755

/** Characters Windows refuses in file names (control characters are rejected outright). */
const WIN_INVALID = /[<>:"|?*]/g
/** Windows reserved device names, with or without an extension (CON, CON.txt, com1.log, LPT¹ …). */
const WIN_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const MAX_COMPONENT_BYTES = 255

/** Make one path component portable: no reserved device names, no ":*?…", no trailing dot/space. */
export function portableComponent(segment: string): string {
  let s = segment.replace(WIN_INVALID, '_').replace(/[. ]+$/, '_')
  if (WIN_RESERVED.test(s)) s = `_${s}`
  return s
}

/**
 * Resolve an entry name inside `dest`, or return undefined if it is unsafe: absolute path, drive
 * letter, ".." segment, control characters, a component longer than 255 bytes, or anything
 * resolving outside `dest`. Names are made portable on EVERY platform (SEC-101: the same archive
 * gives the same result everywhere); `_platform` is kept for API compatibility.
 */
export function safeEntryPath(dest: string, entryName: string, _platform: NodeJS.Platform = process.platform): string | undefined {
  if (CONTROL_CHARS.test(entryName)) return undefined
  const name = entryName.replace(/\\/g, '/')
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return undefined
  const segments = name.split('/').filter((s) => s !== '' && s !== '.')
  if (segments.length === 0) return undefined
  if (segments.some((s) => s === '..' || Buffer.byteLength(s, 'utf8') > MAX_COMPONENT_BYTES)) return undefined
  const clean = segments.map(portableComponent)
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

/** Zip-bomb test for one entry: large AND expanding by more than the ratio cap. */
export function isBombEntry(uncompressedSize: number, compressedSize: number): boolean {
  return uncompressedSize > ZIP_RATIO_MIN_BYTES && uncompressedSize / Math.max(1, compressedSize) > MAX_ZIP_ENTRY_RATIO
}

/**
 * Case-insensitive de-duplication of extraction targets: a second "A.txt" next to "a.txt" (or an
 * exact duplicate entry) becomes "A (1).txt" instead of clashing with the first on macOS/Windows.
 */
export function dedupeTarget(target: string, used: Set<string>): string {
  const dir = dirname(target)
  const { base, ext } = splitName(basename(target))
  for (let n = 0; ; n++) {
    const candidate = join(dir, numberedName(base, ext, n))
    const key = candidate.toLowerCase()
    if (!used.has(key)) {
      used.add(key)
      return candidate
    }
  }
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
  if (/invalid relative path|absolute path|invalid characters in fileName/i.test(String(err))) return invalidInput(UNSAFE_PATHS, err)
  return invalidInput("I couldn't unpack this zip file. It may be damaged or use an unsupported format.", err)
}

async function freeBytes(dir: string): Promise<number | undefined> {
  try {
    const st = await statfs(dir)
    return Number(st.bavail) * Number(st.bsize)
  } catch {
    return undefined // not supported here: the ENOSPC mapping still catches a full disk
  }
}

/** Extract `zipPath` into the (empty) folder `dest`. Returns the number of files written. */
export async function unzipTo(zipPath: string, dest: string, signal: AbortSignal, onProgress: (p: number) => void): Promise<number> {
  const yauzl = await import('yauzl')
  let zip
  try {
    // SEC-100. strictFileNames: backslashes in names are an error (never silently re-interpreted).
    zip = await yauzl.openPromise(zipPath, { autoClose: false, lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true })
  } catch (err) {
    throw invalidInput("I couldn't open this zip file. It may be damaged.", err)
  }
  try {
    if (zip.entryCount > MAX_ZIP_ENTRIES) {
      throw invalidInput(`This zip has more than ${MAX_ZIP_ENTRIES.toLocaleString('en-US')} files. That's too many for me to unpack safely.`)
    }
    // Pass 1: read the whole central directory and validate everything BEFORE writing anything.
    const plan: { entry: Entry; target: string; dir: boolean }[] = []
    const used = new Set<string>()
    let declared = 0
    try {
      for await (const entry of zip.eachEntry()) {
        throwIfAborted(signal)
        if (isSymlinkEntry(entry)) continue // never materialise links (SEC-102)
        const target = safeEntryPath(dest, entry.fileName)
        if (!target) throw invalidInput(UNSAFE_PATHS, entry.fileName)
        if (isDirectoryEntry(entry)) {
          plan.push({ entry, target, dir: true })
          continue
        }
        if (entry.isEncrypted()) throw invalidInput('This zip is password-protected, so I cannot unpack it.')
        if (isBombEntry(entry.uncompressedSize, entry.compressedSize)) throw invalidInput(ZIP_RATIO, entry.fileName)
        declared += entry.uncompressedSize
        if (declared > MAX_ZIP_TOTAL_BYTES) throw invalidInput(ZIP_BOMB)
        plan.push({ entry, target: dedupeTarget(target, used), dir: false })
      }
    } catch (err) {
      throw mapUnzipError(err, signal)
    }
    const free = await freeBytes(dest)
    if (free !== undefined && declared + ZIP_FREE_DISK_MARGIN > free) {
      throw new EngineError('OUTPUT_NOT_WRITABLE', `There isn't enough free disk space to unpack this zip (it needs ${formatBytes(declared)}).`)
    }
    // Pass 2: extract. Actual bytes are counted too (yauzl also checks declared sizes).
    let written = 0
    let files = 0
    const fileCount = plan.filter((p) => !p.dir).length
    try {
      for (const { entry, target, dir } of plan) {
        throwIfAborted(signal)
        if (dir) {
          await mkdir(target, { recursive: true, mode: EXTRACTED_DIR_MODE })
          continue
        }
        await mkdir(dirname(target), { recursive: true, mode: EXTRACTED_DIR_MODE })
        const stream = await zip.openReadStreamPromise(entry)
        await pipeline(
          stream,
          counting((n) => {
            written += n
            if (written > MAX_ZIP_TOTAL_BYTES) stream.destroy(new EngineError('INPUT_INVALID', ZIP_BOMB))
          }),
          // 'wx': never replace anything, even inside our own fresh folder.
          createWriteStream(target, { flags: 'wx', mode: EXTRACTED_FILE_MODE }),
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
  let total = 0
  const roots = uniqueRootNames(inputs.map((i) => i.path))
  const walk = async (real: string, meta: string, top = false): Promise<void> => {
    throwIfAborted(signal)
    // A link the user dropped is what they meant to zip (QA ERR-11); links INSIDE folders are
    // never followed (loops, escaping the folder, SEC-106).
    const st = top ? await stat(real) : await lstat(real)
    if (st.isSymbolicLink()) return
    if (st.isDirectory()) {
      const children = (await readdir(real)).sort()
      if (children.length === 0) out.push({ meta: `${meta}/`, dir: true, size: 0, mtime: st.mtime, mode: st.mode })
      for (const c of children) await walk(join(real, c), `${meta}/${c}`)
      return
    }
    // Regular files only: FIFOs, sockets and devices are skipped (SEC-106).
    if (st.isFile()) {
      out.push({ real, meta, dir: false, size: st.size, mtime: st.mtime, mode: st.mode })
      total += st.size
      if (total > MAX_ZIP_CREATE_BYTES) throw invalidInput(`That's more than ${formatBytes(MAX_ZIP_CREATE_BYTES)} in total. Too much for one zip.`)
    }
    if (out.length > MAX_ZIP_CREATE_ENTRIES) throw invalidInput(`That's more than ${MAX_ZIP_CREATE_ENTRIES.toLocaleString('en-US')} files. Too many for one zip.`)
  }
  for (let i = 0; i < inputs.length; i++) await walk(inputs[i]!.path, roots[i]!, true)
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
