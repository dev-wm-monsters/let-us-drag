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
 * (SEC-110). link() fails with EEXIST instead of replacing: an atomic "create if absent". When
 * link() fails for any other reason, copyFile(COPYFILE_EXCL) is the equally race-safe fallback
 * (O_EXCL), and ITS error is what gets reported. There is deliberately no allow-list of "no hard
 * links here" codes: FAT/exFAT and network drives answer differently per OS (Linux vfat: EPERM;
 * macOS msdosfs/smbfs: ENOTSUP; Windows FAT/exFAT: ERROR_INVALID_FUNCTION, which libuv reports as
 * EISDIR; some SMB servers: EINVAL/EACCES/UNKNOWN), and a real permission problem makes the copy
 * fail too. rename() is never used for files: it silently replaces.
 */
export async function commitFile(tempPath: string, dir: string, name: string, linkFile: typeof link = link): Promise<string> {
  const { base, ext } = splitName(name)
  let linkWorks = true
  for (let n = 0; n < MAX_COLLISIONS; n++) {
    const finalPath = join(dir, numberedName(base, ext, n))
    if (linkWorks) {
      try {
        await linkFile(tempPath, finalPath)
        await unlink(tempPath).catch(() => undefined)
        return finalPath
      } catch (err) {
        if (errnoCode(err) === 'EEXIST') continue
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

/** Error codes Windows reports while a virus scanner or the indexer briefly holds a fresh file. */
const TRANSIENT_WIN_RENAME = new Set(['EPERM', 'EACCES', 'EBUSY'])

/**
 * rename() that retries a few times on Windows for transient sharing violations (the same idea as
 * graceful-fs). Only used for children of our own temp folder, so retrying cannot touch user files.
 */
export async function renameRetrying(
  from: string,
  to: string,
  platform: NodeJS.Platform = process.platform,
  renameFn: typeof rename = rename
): Promise<void> {
  const attempts = platform === 'win32' ? 6 : 1
  for (let i = 1; ; i++) {
    try {
      await renameFn(from, to)
      return
    } catch (err) {
      if (i >= attempts || !TRANSIENT_WIN_RENAME.has(errnoCode(err) ?? '')) throw err
      await new Promise((r) => setTimeout(r, 40 * i))
    }
  }
}

async function moveChildren(from: string, to: string): Promise<void> {
  for (const child of await readdir(from)) {
    // `to` was created empty by us a moment ago (and checked empty right before), so these names
    // cannot clash with user files.
    await renameRetrying(join(from, child), join(to, child))
  }
  await rm(from, { recursive: true, force: true, maxRetries: 3 })
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
      // Windows' rename() replaces existing FILES, so never move into a folder that is no longer
      // empty (someone wrote into our reserved name meanwhile): leave it and take the next name.
      if ((await readdir(finalPath).catch(() => [])).length > 0) continue
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
