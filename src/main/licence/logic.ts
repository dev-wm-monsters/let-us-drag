// Pure licence logic (TPM D26): error mapping, re-check classification + procedure, scheduling,
// device label. No electron import, no I/O of its own (everything is injected). Unit tested.

import { LICENCE_MESSAGES, type LicenceErrorCode, type LicenceStatus } from '../../shared/licence'
import type { ActivateData, DodoCall, ValidateData } from './dodo-client'

// ——— activation ————————————————————————————————————————————————————————————————————————

export type ActivateOutcome = { ok: true; instanceId: string } | { ok: false; code: LicenceErrorCode }

/** Map Dodo's answer to /licenses/activate. `expectedProductId`: a key for another product is refused. */
export function mapActivate(call: DodoCall<ActivateData>, expectedProductId: string): ActivateOutcome {
  switch (call.kind) {
    case 'network':
      return { ok: false, code: 'NETWORK' }
    case 'http':
      if (call.status === 404) return { ok: false, code: 'NOT_FOUND' }
      if (call.status === 403) return { ok: false, code: 'NOT_ACTIVE' }
      if (call.status === 422) return { ok: false, code: 'LIMIT_REACHED' }
      return { ok: false, code: 'UNKNOWN' }
    case 'ok':
      if (call.data.productId !== null && call.data.productId !== expectedProductId) return { ok: false, code: 'WRONG_PRODUCT' }
      return { ok: true, instanceId: call.data.instanceId }
  }
}

export function activateErrorMessage(code: LicenceErrorCode): string {
  switch (code) {
    case 'NETWORK':
      return LICENCE_MESSAGES.network
    case 'NOT_FOUND':
      return LICENCE_MESSAGES.notFound
    case 'NOT_ACTIVE':
      return LICENCE_MESSAGES.notActive
    case 'LIMIT_REACHED':
      return LICENCE_MESSAGES.limit
    case 'WRONG_PRODUCT':
      return LICENCE_MESSAGES.wrongProduct
    case 'EMPTY_KEY':
      return LICENCE_MESSAGES.emptyKey
    case 'NO_LICENCE':
      return LICENCE_MESSAGES.noLicence
    case 'ALREADY_ACTIVE':
      return LICENCE_MESSAGES.alreadyActive
    case 'BUSY':
      return LICENCE_MESSAGES.busy
    case 'UNKNOWN':
      return LICENCE_MESSAGES.generic
  }
}

// ——— deactivation ——————————————————————————————————————————————————————————————————————

/**
 * - freed: Dodo freed the seat → clear the local licence.
 * - gone: 403/404, the instance or key no longer exists, so no seat is held → clear as well.
 * - offline: no answer → KEEP the licence (the seat would stay taken otherwise).
 * - error: Dodo answered with something else (5xx…) → keep the licence.
 */
export type DeactivateOutcome = 'freed' | 'gone' | 'offline' | 'error'

export function mapDeactivate(call: DodoCall<true>): DeactivateOutcome {
  if (call.kind === 'ok') return 'freed'
  if (call.kind === 'network') return 'offline'
  if (call.status === 403 || call.status === 404) return 'gone'
  return 'error'
}

// ——— background re-check ———————————————————————————————————————————————————————————————

/**
 * - valid: Dodo said valid.
 * - invalid: a DEFINITE "no" from Dodo: HTTP 2xx with valid:false, or 403 / 404.
 * - transient: everything else (offline, timeout, DNS, captive portal, 5xx, 429, unexpected body,
 *   other statuses). Never locks (website promise: offline never locks the app).
 */
export type CheckClass = 'valid' | 'invalid' | 'transient'

export function classifyValidate(call: DodoCall<ValidateData>, expectedProductId: string): CheckClass {
  if (call.kind === 'network') return 'transient'
  if (call.kind === 'http') return call.status === 403 || call.status === 404 ? 'invalid' : 'transient'
  if (!call.data.valid) return 'invalid'
  if (call.data.productId !== null && call.data.productId !== expectedProductId) return 'invalid'
  return 'valid'
}

/**
 * Result of one background re-check:
 * - valid → (stay / become) active
 * - transient → keep the current state, retry later
 * - disabled → the key itself is not valid any more (refunded / disabled) → lock
 * - reactivate → the key is valid but this computer's activation instance is gone → ask to activate again
 */
export type RecheckOutcome = 'valid' | 'transient' | 'disabled' | 'reactivate'

export interface RecheckDeps {
  validate(licenseKey: string, instanceId: string | null): Promise<DodoCall<ValidateData>>
  sleep(ms: number): Promise<void>
  /** Wait before the confirming re-check (rules out a glitch). */
  confirmDelayMs: number
  productId: string
}

/**
 * Validate the key with this computer's instance. A definite "no" is confirmed by a second check
 * after `confirmDelayMs`; then the key is checked without the instance to tell "disabled" from
 * "activation removed". Any transient answer along the way keeps the current state.
 */
export async function runRecheck(deps: RecheckDeps, licenseKey: string, instanceId: string): Promise<RecheckOutcome> {
  const first = classifyValidate(await deps.validate(licenseKey, instanceId), deps.productId)
  if (first !== 'invalid') return first
  await deps.sleep(deps.confirmDelayMs)
  const second = classifyValidate(await deps.validate(licenseKey, instanceId), deps.productId)
  if (second !== 'invalid') return second
  const keyOnly = classifyValidate(await deps.validate(licenseKey, null), deps.productId)
  if (keyOnly === 'valid') return 'reactivate'
  if (keyOnly === 'transient') return 'transient'
  return 'disabled'
}

/** New status after a re-check outcome (null = unchanged). */
export function statusAfterRecheck(outcome: RecheckOutcome): LicenceStatus | null {
  switch (outcome) {
    case 'valid':
      return 'active'
    case 'disabled':
      return 'disabled'
    case 'reactivate':
      return 'reactivate'
    case 'transient':
      return null
  }
}

/** Which stored statuses are re-checked in the background (a disabled key may be re-enabled). */
export function shouldRecheck(status: LicenceStatus): boolean {
  return status === 'active' || status === 'disabled'
}

// ——— scheduling ———————————————————————————————————————————————————————————————————————

export const HOUR_MS = 60 * 60 * 1000
export const RECHECK_INTERVAL_MS = 24 * HOUR_MS

export interface ScheduleTimings {
  /** Random delay after start-up / wake before a due check: min + rand × spread. */
  startupMinMs: number
  startupSpreadMs: number
  /** Extra random spread added to a not-yet-due check. */
  jitterMs: number
  /** Retry delays after a transient failure (the last one repeats). */
  retryMs: readonly number[]
}

export const DEFAULT_TIMINGS: ScheduleTimings = {
  startupMinMs: 45_000,
  startupSpreadMs: 120_000,
  jitterMs: 15 * 60_000,
  retryMs: [1 * HOUR_MS, 3 * HOUR_MS, 6 * HOUR_MS, 12 * HOUR_MS]
}

function clamp01(r: number): number {
  return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0.5
}

/** Is a check due (never checked, last check ≥ 24 h ago, or a clock that went backwards)? */
export function isCheckDue(lastCheckedAt: number | null, now: number): boolean {
  if (lastCheckedAt === null || !Number.isFinite(lastCheckedAt)) return true
  const age = now - lastCheckedAt
  return age >= RECHECK_INTERVAL_MS || age < -HOUR_MS
}

/**
 * Delay until the next background check, on start-up or after waking from sleep: a random
 * start-up delay when a check is due (never blocks start-up), else when the 24 h are over (+ jitter).
 */
export function nextCheckDelay(lastCheckedAt: number | null, now: number, rand: number, t: ScheduleTimings = DEFAULT_TIMINGS): number {
  const r = clamp01(rand)
  if (isCheckDue(lastCheckedAt, now)) return Math.round(t.startupMinMs + r * t.startupSpreadMs)
  const due = (lastCheckedAt as number) + RECHECK_INTERVAL_MS - now
  return Math.round(Math.max(t.startupMinMs, due) + r * t.jitterMs)
}

/** Delay before retrying after `failures` consecutive transient results (1-based), with jitter (±10 %). */
export function retryDelay(failures: number, rand: number, t: ScheduleTimings = DEFAULT_TIMINGS): number {
  const list = t.retryMs.length > 0 ? t.retryMs : [HOUR_MS]
  const base = list[Math.min(Math.max(1, Math.floor(failures)), list.length) - 1]!
  return Math.round(base * (0.9 + clamp01(rand) * 0.2))
}

// ——— device label ———————————————————————————————————————————————————————————————————————

/**
 * The activation `name` Dodo stores for this computer: generic and non-personal, plus the start of
 * the anonymous install ID so seats can be told apart in the dashboard. Never the hostname or user.
 * e.g. "macOS · Apple silicon · 3f9a2c", "Windows 11 · x64 · 3f9a2c", "Linux · x64 · 3f9a2c".
 */
export function deviceLabel(platform: NodeJS.Platform, arch: string, osRelease: string, installId: string): string {
  const short = installId.replace(/[^0-9a-f]/gi, '').slice(0, 6).toLowerCase() || '000000'
  let os: string
  let cpu = /^[a-z0-9_]{1,16}$/i.test(arch) ? arch : 'unknown'
  switch (platform) {
    case 'darwin':
      os = 'macOS'
      cpu = arch === 'arm64' ? 'Apple silicon' : arch === 'x64' ? 'Intel' : cpu
      break
    case 'win32': {
      // os.release() is "10.0.<build>" on Windows 10 and 11; 11 starts at build 22000.
      const build = Number(osRelease.split('.')[2])
      os = Number.isFinite(build) && build >= 22000 ? 'Windows 11' : 'Windows 10'
      break
    }
    case 'linux':
      os = 'Linux'
      break
    default:
      os = 'Desktop'
  }
  return `${os} · ${cpu} · ${short}`
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function isInstallId(v: unknown): v is string {
  return typeof v === 'string' && UUID_V4_RE.test(v)
}
