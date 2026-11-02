// Licence state owner in main (TPM D26). No electron import: the client, store, clock and timers
// are injected (app.ts wires Electron's safeStorage / powerMonitor; tests use fakes).
//
// Rules (docs/TPM_DECISIONS.md D26):
// - Conversions need status 'active'. Only a definite answer from Dodo changes an active licence.
// - Background re-check: at most once per 24 h, after a random start-up delay (never blocks
//   start-up), and after waking from sleep when more than 24 h have passed. Silent.
// - Offline, timeouts, 5xx and unexpected answers never lock and never nag; they retry later.

import {
  LICENCE_MESSAGES,
  maskLicenceKey,
  MAX_LICENCE_KEY_LENGTH,
  normaliseLicenceKey,
  type LicenceActionResult,
  type LicenceErrorCode,
  type LicenceStatus,
  type LicenceView
} from '../../shared/licence'
import type { LicenceConfig } from './config'
import type { DodoClient } from './dodo-client'
import {
  activateErrorMessage,
  DEFAULT_TIMINGS,
  mapActivate,
  mapDeactivate,
  nextCheckDelay,
  retryDelay,
  runRecheck,
  shouldRecheck,
  statusAfterRecheck,
  type RecheckOutcome,
  type ScheduleTimings
} from './logic'
import type { StoredLicence } from './store'

export interface LicenceStoreLike {
  load(): Promise<StoredLicence | null>
  save(rec: StoredLicence): Promise<void>
  clear(): Promise<void>
}

export type TimerHandle = { cancel(): void }

export interface LicenceManagerDeps {
  config: Pick<LicenceConfig, 'environment' | 'productId'>
  client: Pick<DodoClient, 'activate' | 'validate' | 'deactivate'>
  store: LicenceStoreLike
  deviceLabel: string
  now?: () => number
  random?: () => number
  /** Schedule a callback (default: unref'd setTimeout). */
  setTimer?: (fn: () => void, ms: number) => TimerHandle
  sleep?: (ms: number) => Promise<void>
  /** Delay before the confirming re-check of a definite "not valid" (default 60 s). */
  confirmDelayMs?: number
  timings?: ScheduleTimings
  log?: (message: string) => void
}

export const DEFAULT_CONFIRM_DELAY_MS = 60_000
/** Longest single timer (setTimeout overflows above ~24.8 days; we never need more than ~1 day). */
const MAX_TIMER_MS = 2 ** 31 - 1

function defaultTimer(fn: () => void, ms: number): TimerHandle {
  const t = setTimeout(fn, Math.min(MAX_TIMER_MS, Math.max(0, ms)))
  t.unref?.()
  return { cancel: () => clearTimeout(t) }
}

export type LicenceListener = (view: LicenceView) => void

export class LicenceManager {
  private rec: StoredLicence | null = null
  /** Bumped on every local change; a re-check started before a change is discarded. */
  private generation = 0
  private busy = false
  private checking: Promise<RecheckOutcome | null> | null = null
  private timer: TimerHandle | null = null
  private failures = 0
  private started = false
  private readonly listeners = new Set<LicenceListener>()
  private readonly now: () => number
  private readonly random: () => number
  private readonly setTimer: (fn: () => void, ms: number) => TimerHandle
  private readonly sleep: (ms: number) => Promise<void>
  private readonly timings: ScheduleTimings
  private readonly log: (message: string) => void

  constructor(private readonly deps: LicenceManagerDeps) {
    this.now = deps.now ?? Date.now
    this.random = deps.random ?? Math.random
    this.setTimer = deps.setTimer ?? defaultTimer
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.timings = deps.timings ?? DEFAULT_TIMINGS
    this.log = deps.log ?? (() => undefined)
  }

  /** Load the stored licence. A licence made for the other Dodo environment is ignored. */
  async init(): Promise<void> {
    const rec = await this.deps.store.load().catch(() => null)
    if (rec && rec.environment !== this.deps.config.environment) {
      this.log(`licence: stored licence is for the ${rec.environment} environment, this build uses ${this.deps.config.environment}; ignoring it`)
      this.rec = null
    } else {
      this.rec = rec
    }
    this.log(`licence: ${this.status}`)
  }

  get status(): LicenceStatus {
    return this.rec?.status ?? 'unlicensed'
  }

  isUnlocked(): boolean {
    return this.status === 'active'
  }

  view(): LicenceView {
    const r = this.rec
    return {
      status: this.status,
      maskedKey: r ? maskLicenceKey(r.licenseKey) : null,
      activatedAt: r?.activatedAt ?? null,
      lastCheckedAt: r?.lastCheckedAt ?? null,
      environment: this.deps.config.environment,
      testMode: this.deps.config.environment === 'test'
    }
  }

  onChange(listener: LicenceListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // ——— user actions ———————————————————————————————————————————————————————————————————

  async activate(raw: unknown): Promise<LicenceActionResult> {
    const fail = (code: LicenceErrorCode): LicenceActionResult => ({ ok: false, code, message: activateErrorMessage(code), view: this.view() })
    const typed = normaliseLicenceKey(raw)
    // "Activate again" (reactivate) may send an empty field: reuse the stored key.
    const key = typed || (this.status === 'reactivate' ? (this.rec?.licenseKey ?? '') : '')
    if (!key) return fail('EMPTY_KEY')
    if (key.length > MAX_LICENCE_KEY_LENGTH) return fail('NOT_FOUND')
    if (this.status === 'active') {
      return this.rec?.licenseKey === key ? { ok: true, message: LICENCE_MESSAGES.activated, view: this.view() } : fail('ALREADY_ACTIVE')
    }
    if (this.busy) return fail('BUSY')
    this.busy = true
    try {
      const call = await this.deps.client.activate(key, this.deps.deviceLabel)
      const outcome = mapActivate(call, this.deps.config.productId)
      if (!outcome.ok) {
        this.log(`licence: activation failed (${outcome.code})`)
        if (outcome.code === 'WRONG_PRODUCT' && call.kind === 'ok') {
          // A seat of another product was taken by mistake: free it again (best effort).
          await this.deps.client.deactivate(key, call.data.instanceId).catch(() => undefined)
        }
        return fail(outcome.code)
      }
      const at = new Date(this.now()).toISOString()
      await this.setRecord({
        v: 1,
        licenseKey: key,
        instanceId: outcome.instanceId,
        environment: this.deps.config.environment,
        activatedAt: at,
        lastCheckedAt: at,
        lastResult: 'activated',
        status: 'active'
      })
      this.log('licence: activated')
      this.failures = 0
      this.schedule()
      return { ok: true, message: LICENCE_MESSAGES.activated, view: this.view() }
    } finally {
      this.busy = false
    }
  }

  async deactivate(): Promise<LicenceActionResult> {
    const rec = this.rec
    if (!rec) return { ok: false, code: 'NO_LICENCE', message: LICENCE_MESSAGES.noLicence, view: this.view() }
    if (this.busy) return { ok: false, code: 'BUSY', message: LICENCE_MESSAGES.busy, view: this.view() }
    this.busy = true
    try {
      const outcome = mapDeactivate(await this.deps.client.deactivate(rec.licenseKey, rec.instanceId))
      this.log(`licence: deactivate → ${outcome}`)
      if (outcome === 'offline') return { ok: false, code: 'NETWORK', message: LICENCE_MESSAGES.deactivateOffline, view: this.view() }
      if (outcome === 'error') return { ok: false, code: 'UNKNOWN', message: LICENCE_MESSAGES.deactivateGeneric, view: this.view() }
      await this.setRecord(null)
      this.cancelTimer()
      return { ok: true, message: LICENCE_MESSAGES.deactivated, view: this.view() }
    } finally {
      this.busy = false
    }
  }

  /** Development builds only (tray "Reset licence"), and E2E: forget the licence locally, no network. */
  async resetLocal(): Promise<void> {
    await this.setRecord(null)
    this.cancelTimer()
  }

  /** E2E only: start as if activated (no network). In memory only: nothing is written to disk. */
  seedActive(): void {
    const at = new Date(this.now()).toISOString()
    this.generation++
    this.rec = {
      v: 1,
      licenseKey: 'E2E-TEST-KEY-0000-0000',
      instanceId: 'lki_e2e_seed',
      environment: this.deps.config.environment,
      activatedAt: at,
      lastCheckedAt: at,
      lastResult: 'activated',
      status: 'active'
    }
  }

  // ——— background re-check ————————————————————————————————————————————————————————————

  /** Start background checking (after start-up). */
  start(): void {
    this.started = true
    this.schedule()
  }

  stop(): void {
    this.started = false
    this.cancelTimer()
  }

  /** powerMonitor 'resume': check again (after a short random delay) if the 24 h are over. */
  onResume(): void {
    if (this.started) this.schedule()
  }

  /**
   * Run one re-check now (the timer's callback; E2E calls it directly). Resolves with the outcome,
   * or null when there was nothing to check or a local change made the answer stale.
   */
  recheckNow(): Promise<RecheckOutcome | null> {
    if (this.checking) return this.checking
    const p = this.doRecheck().finally(() => {
      this.checking = null
    })
    this.checking = p
    return p
  }

  private async doRecheck(): Promise<RecheckOutcome | null> {
    const rec = this.rec
    if (!rec || !shouldRecheck(rec.status)) return null
    const gen = this.generation
    let outcome: RecheckOutcome
    try {
      outcome = await runRecheck(
        {
          validate: (k, i) => this.deps.client.validate(k, i),
          sleep: this.sleep,
          confirmDelayMs: this.deps.confirmDelayMs ?? DEFAULT_CONFIRM_DELAY_MS,
          productId: this.deps.config.productId
        },
        rec.licenseKey,
        rec.instanceId
      )
    } catch (err) {
      this.log(`licence: re-check failed (${String(err)})`)
      outcome = 'transient'
    }
    if (gen !== this.generation || this.rec !== rec) return null
    this.log(`licence: re-check → ${outcome}`)
    const next = statusAfterRecheck(outcome)
    if (next === null) {
      this.failures++
    } else {
      this.failures = 0
      await this.setRecord({
        ...rec,
        status: next as StoredLicence['status'],
        lastCheckedAt: new Date(this.now()).toISOString(),
        lastResult: outcome === 'valid' ? 'valid' : outcome === 'reactivate' ? 'instance-missing' : 'invalid'
      }).catch((err: unknown) => this.log(`licence: saving the re-check result failed (${String(err)})`))
    }
    if (this.started) this.schedule()
    return outcome
  }

  private schedule(): void {
    this.cancelTimer()
    if (!this.started) return
    const rec = this.rec
    if (!rec || !shouldRecheck(rec.status)) return
    let ms: number
    if (this.failures > 0) {
      ms = retryDelay(this.failures, this.random(), this.timings)
    } else {
      const last = rec.lastCheckedAt ? Date.parse(rec.lastCheckedAt) : null
      ms = nextCheckDelay(Number.isFinite(last) ? last : null, this.now(), this.random(), this.timings)
    }
    this.timer = this.setTimer(() => {
      this.timer = null
      void this.recheckNow()
    }, ms)
  }

  private cancelTimer(): void {
    this.timer?.cancel()
    this.timer = null
  }

  private async setRecord(rec: StoredLicence | null): Promise<void> {
    this.generation++
    this.rec = rec
    try {
      if (rec) await this.deps.store.save(rec)
      else await this.deps.store.clear()
    } catch (err) {
      // Not persisted: keep the state for this session (activation succeeded at Dodo) and say so.
      this.log(`licence: saving failed (${String(err)})`)
    }
    const v = this.view()
    for (const l of this.listeners) {
      try {
        l(v)
      } catch {
        // a listener must never break the licence flow
      }
    }
  }
}
