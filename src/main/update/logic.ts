// Pure update logic (TPM D29): the decision (current / available / required), the view sent to
// renderers, and the check schedule. No electron import, no I/O. Unit tested.

import type { UpdateStatus, UpdateView } from '../../shared/update'
import type { UpdateManifest } from './manifest'
import { compareVersions } from './semver'

/**
 * - No manifest was ever fetched → current (never block).
 * - This version does not parse (should not happen) → current (never block on our own bug).
 * - current < minimum → required; current < latest → available; else current.
 */
export function decideStatus(currentVersion: string, manifest: UpdateManifest | null): UpdateStatus {
  if (!manifest) return 'current'
  if (manifest.minimum) {
    const c = compareVersions(currentVersion, manifest.minimum)
    if (c === null) return 'current'
    if (c < 0) return 'required'
  }
  const c = compareVersions(currentVersion, manifest.latest)
  return c !== null && c < 0 ? 'available' : 'current'
}

export interface UpdateMemory {
  manifest: UpdateManifest | null
  /** ISO time of the last successful fetch. */
  fetchedAt: string | null
  /** "Later" was pressed for this latest version. */
  dismissedVersion: string | null
  /** The Uncle already announced this latest version (the once-per-version bubble). */
  hintShownVersion: string | null
}

export const EMPTY_MEMORY: UpdateMemory = { manifest: null, fetchedAt: null, dismissedVersion: null, hintShownVersion: null }

export function makeView(currentVersion: string, mem: UpdateMemory): UpdateView {
  const status = decideStatus(currentVersion, mem.manifest)
  const latest = mem.manifest?.latest ?? null
  const soft = status === 'available'
  const dismissed = soft && latest !== null && mem.dismissedVersion === latest
  return {
    status,
    currentVersion,
    latestVersion: latest,
    releasedAt: mem.manifest?.releasedAt ?? null,
    notes: status === 'current' ? [] : [...(mem.manifest?.notes ?? [])],
    dismissed,
    hint: soft && !dismissed && mem.hintShownVersion !== latest,
    lastCheckedAt: mem.fetchedAt
  }
}

// ——— schedule ——————————————————————————————————————————————————————————————————————————

export interface UpdateTimings {
  /** First check after start-up: a random delay in [firstMinMs, firstMaxMs] (never during start-up, D22 exception). */
  firstMinMs: number
  firstMaxMs: number
  /** Then every intervalMs while running; after waking from sleep when more than that has passed. */
  intervalMs: number
  /** Delay after a resume (the network usually needs a moment after waking). */
  resumeMinMs: number
  resumeMaxMs: number
}

export const DEFAULT_UPDATE_TIMINGS: UpdateTimings = {
  firstMinMs: 20_000,
  firstMaxMs: 60_000,
  intervalMs: 6 * 60 * 60 * 1000,
  resumeMinMs: 20_000,
  resumeMaxMs: 60_000
}

/** Per request. */
export const UPDATE_TIMEOUT_MS = 10_000

function between(min: number, max: number, random: number): number {
  const r = Number.isFinite(random) ? Math.min(1, Math.max(0, random)) : 0.5
  return Math.round(min + (max - min) * r)
}

export function firstCheckDelay(random: number, t: UpdateTimings = DEFAULT_UPDATE_TIMINGS): number {
  return between(t.firstMinMs, t.firstMaxMs, random)
}

/** After waking from sleep: a check (after a short random delay) only when the interval is over. */
export function resumeCheckDelay(lastAttemptAt: number | null, now: number, random: number, t: UpdateTimings = DEFAULT_UPDATE_TIMINGS): number | null {
  if (lastAttemptAt !== null && now - lastAttemptAt < t.intervalMs) return null
  return between(t.resumeMinMs, t.resumeMaxMs, random)
}
