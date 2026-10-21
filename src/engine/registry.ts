// Input description + request validation against the shared option catalog (PLAN §5).
import { stat } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'
import { categoryForExt, combinedCategory, normalizeExt, optionsFor } from '../shared/catalog'
import type { Category, DroppedItem, JobRequest, OptionId } from '../shared/types'
import { EngineError, errnoCode } from './errors'

/** Lower-case extension without the dot; '' for folders and extension-less names. */
export function extOf(path: string, isDirectory: boolean): string {
  if (isDirectory) return ''
  const name = basename(path)
  const e = extname(name)
  return e && e !== name ? normalizeExt(e) : ''
}

/** stat() each absolute path. Relative paths are rejected (never resolved against the cwd). */
export async function describePaths(paths: readonly string[]): Promise<DroppedItem[]> {
  if (!Array.isArray(paths)) throw new TypeError('paths must be an array')
  return Promise.all(
    paths.map(async (p) => {
      if (typeof p !== 'string' || p.length === 0 || !isAbsolute(p) || p.includes('\0')) {
        throw new EngineError('UNSUPPORTED', 'I can only work with files from your disk.', `not an absolute path: ${String(p)}`)
      }
      let st
      try {
        st = await stat(p)
      } catch (err) {
        const code = errnoCode(err)
        if (code === 'ENOENT' || code === 'ENOTDIR') throw new EngineError('INPUT_NOT_FOUND', undefined, p)
        if (code === 'EACCES' || code === 'EPERM') throw new EngineError('INPUT_NOT_FOUND', "I'm not allowed to read that file.", p)
        throw err
      }
      const isDirectory = st.isDirectory()
      // SEC-43: FIFOs, sockets and devices are never opened (reading a FIFO would block forever).
      // stat() follows symlinks, so a link to a regular file is fine (QA ERR-11) and a link to a
      // FIFO is refused like the FIFO itself.
      if (!isDirectory && !st.isFile()) throw new EngineError('INPUT_INVALID', "That's not a regular file, so I won't touch it.", p)
      return { path: p, name: basename(p), ext: extOf(p, isDirectory), isDirectory, sizeBytes: isDirectory ? 0 : st.size }
    })
  )
}

export function categoriesOf(items: readonly DroppedItem[]): Category[] {
  return items.map((i) => (i.isDirectory ? 'unknown' : categoryForExt(i.ext)))
}

/** The category whose handler runs this request, or an UNSUPPORTED error. */
export function validateRequest(req: Pick<JobRequest, 'optionId'>, items: readonly DroppedItem[]): Category {
  if (items.length === 0) throw new EngineError('UNSUPPORTED', 'There was nothing to convert.')
  const categories = categoriesOf(items)
  const hasDirectory = items.some((i) => i.isDirectory)
  const category = combinedCategory(categories, hasDirectory)
  if (category === 'blocked') throw new EngineError('UNSUPPORTED', 'Nope, not eating that.')
  const allowed = optionsFor({ categories, exts: items.filter((i) => !i.isDirectory).map((i) => i.ext), count: items.length, hasDirectory })
  if (!allowed.some((o) => o.id === req.optionId)) {
    throw new EngineError('UNSUPPORTED', undefined, `option ${req.optionId} not offered for ${category} (${items.map((i) => i.ext || '<dir>').join(',')})`)
  }
  return category
}

/** Basic shape check for requests that arrive over IPC. */
export function assertJobRequest(req: unknown): asserts req is JobRequest {
  const r = req as Partial<JobRequest> | null
  if (
    !r ||
    typeof r.id !== 'string' ||
    r.id.length === 0 ||
    typeof r.optionId !== 'string' ||
    !Array.isArray(r.inputPaths) ||
    r.inputPaths.length === 0 ||
    !r.inputPaths.every((p) => typeof p === 'string')
  ) {
    throw new EngineError('UNSUPPORTED', undefined, 'malformed job request')
  }
}

export type { OptionId }
