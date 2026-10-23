// Settings persistence: a JSON file in app.getPath('userData') (the directory is injected so this
// module has no electron import and can be unit tested).
// - zod validation; unknown keys dropped; each invalid/missing field falls back to its default.
// - corrupt / unreadable file → defaults (the file is rewritten on the next change).
// - atomic writes: write a temp file in the same directory, then rename over the target.
//   On Windows the rename fails with EPERM/EACCES/EBUSY while another process (antivirus, search
//   indexer, backup/sync tools) briefly holds settings.json open; it is retried a few times.

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { CHARACTER_IDS, type CharacterId } from '../shared/characters'
import { DEFAULT_SETTINGS, type Settings } from '../shared/types'

export const SETTINGS_FILE_NAME = 'settings.json'

/** Error codes of a rename blocked by a transient lock on the target (mostly Windows). */
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
/** Waits between rename attempts (ms); ~1.5 s in total. */
export const RENAME_RETRY_DELAYS_MS: readonly number[] = [50, 100, 200, 400, 800]

/** rename(), retried after the given delays while it fails with a transient lock error. */
export async function renameWithRetry(
  from: string,
  to: string,
  deps: { rename?: (from: string, to: string) => Promise<void>; delaysMs?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {}
): Promise<void> {
  const doRename = deps.rename ?? rename
  const delays = deps.delaysMs ?? RENAME_RETRY_DELAYS_MS
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let attempt = 0; ; attempt++) {
    try {
      await doRename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | null)?.code
      const delay = delays[attempt]
      if (delay === undefined || code === undefined || !TRANSIENT_RENAME_CODES.has(code)) throw err
      await sleep(delay)
    }
  }
}

const triggerKeySchema = z.enum(['shift', 'alt', 'ctrl', 'meta'])
/** Known character ids only. On disk an unknown id (e.g. a removed character) falls back to the default. */
const characterSchema = z.enum(CHARACTER_IDS as [CharacterId, ...CharacterId[]])

/** Full settings object as stored on disk / returned to renderers. */
const fieldSchemas = {
  triggerKey: triggerKeySchema,
  sounds: z.boolean(),
  hungryMode: z.boolean(),
  plainMode: z.boolean(),
  launchAtLogin: z.boolean(),
  firstRunDone: z.boolean(),
  character: characterSchema
} as const satisfies Record<keyof Settings, z.ZodType>

/** A patch sent by a renderer: any subset of fields, nothing else. */
export const settingsPatchSchema = z.object(fieldSchemas).partial().strict()

/** Parse anything (e.g. JSON from disk) into valid Settings, field by field. */
export function parseSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  const obj = raw as Record<string, unknown>
  for (const key of Object.keys(fieldSchemas) as (keyof Settings)[]) {
    const r = fieldSchemas[key].safeParse(obj[key])
    if (r.success) (out as unknown as Record<string, unknown>)[key] = r.data
  }
  return out
}

export function applySettingsPatch(current: Settings, patch: unknown): Settings {
  const p = settingsPatchSchema.parse(patch)
  return { ...current, ...p }
}

export type SettingsListener = (next: Settings, prev: Settings) => void

export class SettingsStore {
  private current: Settings = { ...DEFAULT_SETTINGS }
  private readonly listeners = new Set<SettingsListener>()
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly dir: string) {}

  get path(): string {
    return join(this.dir, SETTINGS_FILE_NAME)
  }

  get(): Settings {
    return { ...this.current }
  }

  async load(): Promise<Settings> {
    try {
      const text = await readFile(this.path, 'utf8')
      this.current = parseSettings(JSON.parse(text))
    } catch {
      // Missing or corrupt file: start from defaults.
      this.current = { ...DEFAULT_SETTINGS }
    }
    return this.get()
  }

  /** Validate + apply a patch, persist it, notify listeners. Throws a ZodError on invalid input. */
  async update(patch: unknown): Promise<Settings> {
    const prev = this.current
    const next = applySettingsPatch(prev, patch)
    this.current = next
    await this.save()
    for (const l of this.listeners) l({ ...next }, { ...prev })
    return this.get()
  }

  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Serialized atomic write of the current settings. */
  save(): Promise<void> {
    const snapshot = JSON.stringify(this.current, null, 2)
    const run = async (): Promise<void> => {
      await mkdir(this.dir, { recursive: true })
      const tmp = join(this.dir, `${SETTINGS_FILE_NAME}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`)
      try {
        await writeFile(tmp, snapshot, 'utf8')
        await renameWithRetry(tmp, this.path)
      } catch (err) {
        await rm(tmp, { force: true })
        throw err
      }
    }
    const p = this.writeChain.then(run, run)
    this.writeChain = p.catch(() => undefined)
    return p
  }
}
