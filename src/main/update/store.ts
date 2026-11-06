// Update notices storage (TPM D29): one small JSON file in userData, `update-state.json`, holding the
// last valid manifest (so a forced update survives an offline restart), the version the user put off
// with "Later", and the version the Uncle already announced. Separate from settings.json on purpose.
// No electron import. Anything unreadable or invalid reads as "nothing known" (never blocks, never crashes).

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { renameWithRetry } from '../settings-store'
import { EMPTY_MEMORY, type UpdateMemory } from './logic'
import { parseManifest } from './manifest'
import { isSemver } from './semver'

export const UPDATE_STATE_FILE = 'update-state.json'

const versionOrNull = z
  .unknown()
  .transform((v) => (isSemver(v) ? v : null))
  .optional()

const isoOrNull = z
  .unknown()
  .transform((v) => (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : null))
  .optional()

const fileSchema = z.object({
  v: z.literal(1),
  manifest: z.unknown().optional(),
  fetchedAt: isoOrNull,
  dismissedVersion: versionOrNull,
  hintShownVersion: versionOrNull
})

export function parseUpdateState(raw: unknown): UpdateMemory {
  const r = fileSchema.safeParse(raw)
  if (!r.success) return { ...EMPTY_MEMORY }
  // The cached manifest goes through the same validation as a fresh download.
  const manifest = r.data.manifest == null ? null : parseManifest(r.data.manifest)
  return {
    manifest,
    fetchedAt: manifest ? (r.data.fetchedAt ?? null) : null,
    dismissedVersion: r.data.dismissedVersion ?? null,
    hintShownVersion: r.data.hintShownVersion ?? null
  }
}

export interface UpdateStoreLike {
  load(): Promise<UpdateMemory>
  save(mem: UpdateMemory): Promise<void>
}

export class UpdateStore implements UpdateStoreLike {
  constructor(private readonly opts: { dir: string; log?: (message: string) => void }) {}

  get path(): string {
    return join(this.opts.dir, UPDATE_STATE_FILE)
  }

  /** Never throws. */
  async load(): Promise<UpdateMemory> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch {
      return { ...EMPTY_MEMORY }
    }
    try {
      return parseUpdateState(JSON.parse(text))
    } catch {
      this.opts.log?.(`update: ${UPDATE_STATE_FILE} is not valid JSON; ignoring it`)
      return { ...EMPTY_MEMORY }
    }
  }

  async save(mem: UpdateMemory): Promise<void> {
    const json = `${JSON.stringify({ v: 1, ...mem }, null, 2)}\n`
    await mkdir(this.opts.dir, { recursive: true })
    const tmp = `${this.path}.${process.pid}.${Math.random().toString(16).slice(2, 10)}.tmp`
    try {
      await writeFile(tmp, json)
      await renameWithRetry(tmp, this.path)
    } catch (err) {
      await rm(tmp, { force: true })
      throw err
    }
  }
}
