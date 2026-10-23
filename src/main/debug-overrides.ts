// Field diagnostics (src/main/README.md "Field diagnostics"): runtime-switchable overlay variants.
// Pure; no electron import (app.ts passes process.env and the parsed debug-overrides.json).
//
// Every key can come from the environment (main only: the engine worker's LUD_* stripping in
// worker-env.ts is unchanged) or from `debug-overrides.json` in userData, so a user can try a
// variant without Terminal. The environment wins over the file. Unknown / invalid values are
// ignored (default kept) and reported as warnings. With nothing set, the result is exactly
// DEFAULT_OVERLAY_OVERRIDES (today's behaviour).

export const OVERLAY_LEVELS = ['screen-saver', 'pop-up-menu', 'floating', 'normal'] as const
export type OverlayLevel = (typeof OVERLAY_LEVELS)[number]

export interface OverlayOverrides {
  /** LUD_OVERLAY_LEVEL: level for setAlwaysOnTop(true, level). */
  level: OverlayLevel
  /** LUD_SENSOR_FOLLOW: the armed sensor follows the cursor until engaged (false: placed once at arm). */
  sensorFollow: boolean
  /** LUD_OVERLAY_FOCUSABLE: the overlay window is focusable outside feedMe too (never focused by us). */
  focusable: boolean
  /** LUD_OVERLAY_PANEL: macOS only, BrowserWindow `type: 'panel'` (NSPanel-style, non-activating). */
  panel: boolean
}

export const DEFAULT_OVERLAY_OVERRIDES: Readonly<OverlayOverrides> = Object.freeze({
  level: 'screen-saver',
  sensorFollow: true,
  focusable: false,
  panel: false
})

/** The keys read from the environment and from debug-overrides.json. */
export const OVERRIDE_KEYS = ['LUD_OVERLAY_LEVEL', 'LUD_SENSOR_FOLLOW', 'LUD_OVERLAY_FOCUSABLE', 'LUD_OVERLAY_PANEL'] as const

export const OVERRIDES_FILE_NAME = 'debug-overrides.json'
export const DEBUG_FLAG_FILE_NAME = 'debug.flag'

export interface ParsedOverrides {
  overrides: OverlayOverrides
  /** Which keys were set, and from where (for the debug log). */
  sources: Partial<Record<(typeof OVERRIDE_KEYS)[number], 'env' | 'file'>>
  warnings: string[]
}

/** '1'/'0', 'true'/'false', 'yes'/'no', 'on'/'off', numbers 1/0, booleans. null = invalid. */
export function parseFlag(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw === 1 ? true : raw === 0 ? false : null
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false
  return null
}

export function parseLevel(raw: unknown): OverlayLevel | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  return (OVERLAY_LEVELS as readonly string[]).includes(v) ? (v as OverlayLevel) : null
}

/**
 * Effective overrides. `env` is process.env; `file` is the parsed JSON of debug-overrides.json
 * (undefined when there is none; anything that is not a plain object is ignored with a warning).
 * Empty strings in the environment count as "not set".
 */
export function parseOverlayOverrides(env: Readonly<Record<string, string | undefined>>, file?: unknown): ParsedOverrides {
  const warnings: string[] = []
  const sources: ParsedOverrides['sources'] = {}
  let fileObj: Record<string, unknown> = {}
  if (file !== undefined) {
    if (file !== null && typeof file === 'object' && !Array.isArray(file)) fileObj = file as Record<string, unknown>
    else warnings.push(`${OVERRIDES_FILE_NAME}: not a JSON object, ignored`)
    for (const k of Object.keys(fileObj)) {
      if (!(OVERRIDE_KEYS as readonly string[]).includes(k)) warnings.push(`${OVERRIDES_FILE_NAME}: unknown key ${JSON.stringify(k)} ignored`)
    }
  }

  const pick = <T>(key: (typeof OVERRIDE_KEYS)[number], parse: (raw: unknown) => T | null, fallback: T): T => {
    const envRaw = env[key]
    if (envRaw !== undefined && envRaw.trim() !== '') {
      const v = parse(envRaw)
      if (v !== null) {
        sources[key] = 'env'
        return v
      }
      warnings.push(`${key}=${JSON.stringify(envRaw)} (env) is invalid, ignored`)
    }
    if (Object.prototype.hasOwnProperty.call(fileObj, key)) {
      const v = parse(fileObj[key])
      if (v !== null) {
        sources[key] = 'file'
        return v
      }
      warnings.push(`${key}=${JSON.stringify(fileObj[key])} (${OVERRIDES_FILE_NAME}) is invalid, ignored`)
    }
    return fallback
  }

  const d = DEFAULT_OVERLAY_OVERRIDES
  const overrides: OverlayOverrides = {
    level: pick('LUD_OVERLAY_LEVEL', parseLevel, d.level),
    sensorFollow: pick('LUD_SENSOR_FOLLOW', parseFlag, d.sensorFollow),
    focusable: pick('LUD_OVERLAY_FOCUSABLE', parseFlag, d.focusable),
    panel: pick('LUD_OVERLAY_PANEL', parseFlag, d.panel)
  }
  return { overrides, sources, warnings }
}

/** Field diagnostics are on with LUD_DEBUG=1 or when userData/debug.flag exists. */
export function diagnosticsEnabled(env: Readonly<Record<string, string | undefined>>, flagFileExists: boolean): boolean {
  return env['LUD_DEBUG'] === '1' || flagFileExists
}
