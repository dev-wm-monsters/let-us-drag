// Safe output naming and atomic writes (docs/PLAN.md §3 decision 7).
// - Outputs go next to the source and never overwrite anything: "name (1).ext", "name (2).ext", ...
// - Every output is first written to a hidden temp file/folder in the SAME directory and only
//   committed (link / exclusive copy / reserved folder) once the whole job succeeded, so a failed
//   job leaves no half-written files and nothing that already exists is ever replaced.
import { randomBytes } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { copyFile, link, mkdir, open, readdir, rename, rm, rmdir, unlink } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { EngineError, errnoCode } from './errors'

const MAX_COLLISIONS = 10_000

/** Split "photo.final.png" into { base: "photo.final", ext: "png" }. Dotfiles have no extension. */
export function splitName(fileName: string): { base: string; ext: string } {
  const name = basename(fileName)
  const ext = extname(name)
  if (!ext || ext === name) return { base: name, ext: '' }
  return { base: name.slice(0, -ext.length), ext: ext.slice(1) }
}

/** n = 0 → "base.ext"; n ≥ 1 → "base (n).ext". An empty ext yields no dot (folders). */
export function numberedName(base: string, ext: string, n: number): string {
  const stem = n === 0 ? base : `${base} (${n})`
  return ext ? `${stem}.${ext}` : stem
}

/** "photo.png" → "photo.jpg" */
export function convertedName(inputName: string, newExt: string): string {
  return `${splitName(inputName).base}.${newExt}`
}

/** "photo.png", "-nobg", "png" → "photo-nobg.png" */
export function suffixedName(inputName: string, suffix: string, newExt?: string): string {
  const { base, ext } = splitName(inputName)
  const e = newExt ?? ext
  return e ? `${base}${suffix}.${e}` : `${base}${suffix}`
}

/** Folder for multi-output conversions: "doc.pdf" → "doc (pages)". */
export function pagesFolderName(inputName: string): string {
  return `${splitName(inputName).base} (pages)`
}

/** Merge outputs are named after the first input: "photo.png" → "photo (merged).pdf". */
export function mergedName(firstInputName: string, ext: string): string {
  return `${splitName(firstInputName).base} (merged).${ext}`
}

/** Unzip target folder: "photos.zip" → "photos". */
export function unzipFolderName(zipName: string): string {
  return splitName(zipName).base || 'Archive'
}

/** ZIP name: a single input "photo.png"/"Folder" → "photo.zip"/"Folder.zip"; several → "Archive.zip". */
export function zipName(inputNames: readonly string[], firstIsDirectory: boolean): string {
  if (inputNames.length !== 1) return 'Archive.zip'
  const only = inputNames[0]!
  const base = firstIsDirectory ? basename(only) : splitName(only).base
  return `${base || 'Archive'}.zip`
}

function writeError(err: unknown, dir: string): EngineError {
  const code = errnoCode(err)
  if (code === 'ENOSPC') {
    return new EngineError('OUTPUT_NOT_WRITABLE', 'The disk is full, so I could not save the result.', String(err))
  }
  if (code === 'ENOENT') {
    return new EngineError('OUTPUT_NOT_WRITABLE', 'The folder of the original file is gone, so I could not save the result.', String(err))
  }
  return new EngineError('OUTPUT_NOT_WRITABLE', undefined, `${dir}: ${String(err)}`)
}

/**
 * Commit a finished temp file under a unique final name without ever replacing an existing file
 * (SEC-110). link() fails with EEXIST instead of replacing: an atomic "create if absent". On
 * filesystems without hard links (FAT/exFAT, some network shares) copyFile(COPYFILE_EXCL) is the
 * equally race-safe fallback (O_EXCL). rename() is never used for files: it silently replaces.
 */
export async function commitFile(tempPath: string, dir: string, name: string): Promise<string> {
  const { base, ext } = splitName(name)
  let linkWorks = true
  for (let n = 0; n < MAX_COLLISIONS; n++) {
    const finalPath = join(dir, numberedName(base, ext, n))
    if (linkWorks) {
      try {
        await link(tempPath, finalPath)
        await unlink(tempPath).catch(() => undefined)
        return finalPath
      } catch (err) {
        const code = errnoCode(err)
        if (code === 'EEXIST') continue
        if (!LINK_UNSUPPORTED.has(code ?? '')) throw writeError(err, dir)
        linkWorks = false
      }
    }
    try {
      await copyFile(tempPath, finalPath, fsConstants.COPYFILE_EXCL)
      await unlink(tempPath).catch(() => undefined)
      return finalPath
    } catch (err) {
      if (errnoCode(err) === 'EEXIST') continue
      throw writeError(err, dir)
    }
  }
  throw new EngineError('OUTPUT_NOT_WRITABLE', 'Too many files with the same name already exist here.')
}

/** Errors from link() that mean "no hard links here", not "no permission". */
const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EMLINK', 'EINVAL'])

async function moveChildren(from: string, to: string): Promise<void> {
  for (const child of await readdir(from)) {
    // `to` was created empty by us a moment ago, so these names cannot clash with user files.
    await rename(join(from, child), join(to, child))
  }
  await rm(from, { recursive: true, force: true })
}

/**
 * Commit a finished temp folder under a unique final name (SEC-104/110). The final folder is first
 * reserved with a non-recursive mkdir (fails with EEXIST if anything has that name). The temp
 * folder then replaces that EMPTY folder of ours (POSIX rename onto an empty directory; it fails
 * with ENOTEMPTY if anything appeared inside meanwhile), or, where directories cannot be renamed
 * onto each other (Windows), its children are moved in.
 */
export async function commitDir(tempDir: string, parent: string, name: string): Promise<string> {
  for (let n = 0; n < MAX_COLLISIONS; n++) {
    const finalPath = join(parent, numberedName(name, '', n))
    try {
      await mkdir(finalPath)
    } catch (err) {
      if (errnoCode(err) === 'EEXIST') continue
      throw writeError(err, parent)
    }
    try {
      await rename(tempDir, finalPath)
      return finalPath
    } catch (err) {
      const code = errnoCode(err)
      if (code === 'ENOTEMPTY' || code === 'EEXIST') {
        if (process.platform !== 'win32') continue // someone wrote into our reserved folder: leave it, take the next name
      }
      try {
        await moveChildren(tempDir, finalPath)
        return finalPath
      } catch (err2) {
        await rmdir(finalPath).catch(() => undefined) // only succeeds while it is still empty
        throw writeError(err2, parent)
      }
    }
  }
  throw new EngineError('OUTPUT_NOT_WRITABLE', 'Too many folders with the same name already exist here.')
}

interface PendingCommit {
  temp: string
  dir: string
  name: string
  kind: 'file' | 'dir'
}

function tempToken(): string {
  return randomBytes(6).toString('hex')
}

/**
 * Per-job bookkeeping for temp outputs. Create temps with tempFile/tempDir, register finished
 * outputs with stage(), then commitAll() on success or cleanup() on failure/cancel.
 */
export class OutputStager {
  private readonly temps = new Set<string>()
  private readonly pending: PendingCommit[] = []

  /** Create (and reserve) an empty hidden temp file in `dir`. Throws OUTPUT_NOT_WRITABLE if impossible. */
  async tempFile(dir: string, ext: string): Promise<string> {
    const p = join(dir, `.lud-${tempToken()}.tmp${ext ? `.${ext}` : ''}`)
    try {
      const fh = await open(p, 'wx')
      await fh.close()
    } catch (err) {
      throw writeError(err, dir)
    }
    this.temps.add(p)
    return p
  }

  /** Create a hidden temp folder in `dir`. */
  async tempDir(dir: string): Promise<string> {
    const p = join(dir, `.lud-${tempToken()}.tmp`)
    try {
      await mkdir(p)
    } catch (err) {
      throw writeError(err, dir)
    }
    this.temps.add(p)
    return p
  }

  /** Track a temp path created elsewhere (so cleanup() removes it). */
  track(p: string): void {
    this.temps.add(p)
  }

  /** Mark a finished temp output to be committed as `dir/name` (made unique) at the end. */
  stage(temp: string, dir: string, name: string, kind: 'file' | 'dir' = 'file'): void {
    this.pending.push({ temp, dir, name, kind })
  }

  get stagedCount(): number {
    return this.pending.length
  }

  /** Rename all staged outputs into place. Returns the final paths in staging order. */
  async commitAll(): Promise<string[]> {
    const out: string[] = []
    for (const p of this.pending) {
      const finalPath = p.kind === 'dir' ? await commitDir(p.temp, p.dir, p.name) : await commitFile(p.temp, p.dir, p.name)
      this.temps.delete(p.temp)
      out.push(finalPath)
    }
    this.pending.length = 0
    return out
  }

  /** Remove every temp file/folder that was not committed. Never throws. */
  async cleanup(): Promise<void> {
    const all = [...this.temps]
    this.temps.clear()
    this.pending.length = 0
    await Promise.all(all.map((p) => rm(p, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)))
  }
}
