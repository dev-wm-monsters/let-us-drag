// Settings persistence: a JSON file in app.getPath('userData') (the directory is injected so this
// module has no electron import and can be unit tested).
// - zod validation; unknown keys dropped; each invalid/missing field falls back to its default.
// - corrupt / unreadable file → defaults (the file is rewritten on the next change).
// - atomic writes: write a temp file in the same directory, then rename over the target.

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { DEFAULT_SETTINGS, type Settings } from '../shared/types'

export const SETTINGS_FILE_NAME = 'settings.json'

const triggerKeySchema = z.enum(['shift', 'alt', 'ctrl', 'meta'])

/** Full settings object as stored on disk / returned to renderers. */
const fieldSchemas = {
  triggerKey: triggerKeySchema,
  sounds: z.boolean(),
  hungryMode: z.boolean(),
  plainMode: z.boolean(),
  launchAtLogin: z.boolean(),
  firstRunDone: z.boolean()
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
        await rename(tmp, this.path)
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
