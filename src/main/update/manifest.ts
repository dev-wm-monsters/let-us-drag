// The update manifest (TPM D29): format, validation and the download allow-list. Pure; unit tested.
// Format (documented in docs/update.json.example and src/main/README.md "Updates"):
//
//   { "latest": "0.2.0", "minimum": "0.1.0", "releasedAt": "2026-11-10",
//     "notes": ["New: …", "Fixed: …"],
//     "downloads": { "mac-arm64": "https://…dmg", "mac-x64": "…", "win-x64": "…", "linux-x64": "…",
//                    "page": "https://letsdrag.wakeupmonster.com/#download" } }
//
// - `latest` (required) and `minimum` (optional) are semantic versions; `minimum` > `latest` is
//   inconsistent and rejects the whole manifest (the previous state is kept).
// - `releasedAt`, `notes` and `downloads` are optional and cleaned up rather than rejected: a bad
//   date is dropped, notes are trimmed to MAX_NOTES short plain-text lines, and only https links on
//   the website host are kept (anything else falls back to the download page).
// - Unknown fields are ignored, so the format can grow without breaking older apps.

import { z } from 'zod'
import { DOWNLOAD_PAGE_URL, PLATFORM_KEYS, UPDATE_DOWNLOAD_HOST, type PlatformKey } from './config'
import { compareSemver, formatSemver, parseSemver } from './semver'

export const MAX_MANIFEST_CHARS = 64 * 1024
export const MAX_NOTES = 8
export const MAX_NOTE_CHARS = 160
const MAX_URL_CHARS = 2048

export type DownloadKey = PlatformKey | 'page'

export interface UpdateManifest {
  latest: string
  minimum: string | null
  releasedAt: string | null
  notes: string[]
  /** Only allow-listed links (https on the website host). */
  downloads: Partial<Record<DownloadKey, string>>
}

const semverString = z.string().max(64).refine((s) => parseSemver(s) !== null, 'not a semantic version')

const manifestShape = z.object({
  latest: semverString,
  minimum: semverString.nullable().optional(),
  releasedAt: z.unknown().optional(),
  notes: z.unknown().optional(),
  downloads: z.unknown().optional()
})

/** https, on the website host, default port, no credentials. */
export function isAllowedDownloadUrl(raw: unknown, host: string = UPDATE_DOWNLOAD_HOST): raw is string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_CHARS) return false
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  return u.protocol === 'https:' && u.hostname === host && u.port === '' && u.username === '' && u.password === ''
}

function cleanDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  if (!m) return null
  const month = Number(m[2])
  const day = Number(m[3])
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? raw.trim() : null
}

function cleanNotes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const n of raw) {
    if (typeof n !== 'string') continue
    // Plain text, one line: control characters and runs of whitespace become one space.
    const t = n.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (!t) continue
    out.push(t.length > MAX_NOTE_CHARS ? `${t.slice(0, MAX_NOTE_CHARS - 1).trimEnd()}…` : t)
    if (out.length >= MAX_NOTES) break
  }
  return out
}

function cleanDownloads(raw: unknown): Partial<Record<DownloadKey, string>> {
  const out: Partial<Record<DownloadKey, string>> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const rec = raw as Record<string, unknown>
  for (const key of [...PLATFORM_KEYS, 'page'] as const) {
    const v = Object.prototype.hasOwnProperty.call(rec, key) ? rec[key] : undefined
    if (isAllowedDownloadUrl(v)) out[key] = new URL(v).href
  }
  return out
}

/** A validated, normalised manifest, or null (wrong shape, bad versions, minimum above latest). */
export function parseManifest(raw: unknown): UpdateManifest | null {
  const r = manifestShape.safeParse(raw)
  if (!r.success) return null
  const latest = parseSemver(r.data.latest)!
  const minimum = r.data.minimum ? parseSemver(r.data.minimum)! : null
  if (minimum && compareSemver(minimum, latest) > 0) return null
  return {
    latest: formatSemver(latest),
    minimum: minimum ? formatSemver(minimum) : null,
    releasedAt: cleanDate(r.data.releasedAt),
    notes: cleanNotes(r.data.notes),
    downloads: cleanDownloads(r.data.downloads)
  }
}

/** Parse the response body (size-limited JSON). */
export function parseManifestText(text: string): UpdateManifest | null {
  if (text.length > MAX_MANIFEST_CHARS) return null
  let json: unknown
  try {
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    return null
  }
  return parseManifest(json)
}

/** The installer for this computer, else the manifest's download page, else our download page. */
export function downloadUrlFor(manifest: UpdateManifest | null, key: PlatformKey | null): string {
  const d = manifest?.downloads ?? {}
  // Checked again here: the stored manifest may have been edited on disk.
  const candidates = [key ? d[key] : undefined, d.page]
  for (const c of candidates) if (isAllowedDownloadUrl(c)) return c
  return DOWNLOAD_PAGE_URL
}
