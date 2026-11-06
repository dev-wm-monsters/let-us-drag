// Update notices state owner in main (TPM D29). No electron import: fetch, store, clock and timers are
// injected (app.ts wires the restricted update session and powerMonitor; tests use fakes).
//
// Rules (docs/TPM_DECISIONS.md D29):
// - Never at start-up itself: the first check runs after a random 20–60 s delay, then every 6 h while
//   the app runs, and after waking from sleep when more than 6 h passed since the last attempt.
// - Silent: any failed check keeps the previous state. A failed check never blocks anything.
// - Force update (this version < manifest.minimum) blocks conversions in main. The last valid manifest
//   is stored, so that survives an offline restart; with no manifest ever fetched nothing is blocked.
//   A newer manifest with a lower minimum unblocks.
// - Same behaviour in team builds (LUD_LICENSING=off) and on every OS. No auto-install.

import type { UpdateCheckResult, UpdateView } from '../../shared/update'
import { fetchManifest, type FetchOutcome, type UpdateFetchLike } from './checker'
import type { PlatformKey } from './config'
import {
  DEFAULT_UPDATE_TIMINGS,
  EMPTY_MEMORY,
  firstCheckDelay,
  makeView,
  resumeCheckDelay,
  UPDATE_TIMEOUT_MS,
  type UpdateMemory,
  type UpdateTimings
} from './logic'
import { downloadUrlFor } from './manifest'
import type { UpdateStoreLike } from './store'

export type UpdateTimerHandle = { cancel(): void }

export interface UpdateManagerDeps {
  currentVersion: string
  manifestUrl: string
  fetchImpl: UpdateFetchLike
  store: UpdateStoreLike
  platformKey: PlatformKey | null
  now?: () => number
  random?: () => number
  setTimer?: (fn: () => void, ms: number) => UpdateTimerHandle
  timings?: UpdateTimings
  timeoutMs?: number
  log?: (message: string) => void
}

function defaultTimer(fn: () => void, ms: number): UpdateTimerHandle {
  const t = setTimeout(fn, Math.min(2 ** 31 - 1, Math.max(0, ms)))
  t.unref?.()
  return { cancel: () => clearTimeout(t) }
}

export type UpdateListener = (view: UpdateView) => void

export class UpdateManager {
  private mem: UpdateMemory = { ...EMPTY_MEMORY }
  private checking: Promise<boolean> | null = null
  private timer: UpdateTimerHandle | null = null
  private started = false
  private lastAttemptAt: number | null = null
  private readonly listeners = new Set<UpdateListener>()
  private readonly now: () => number
  private readonly random: () => number
  private readonly setTimer: (fn: () => void, ms: number) => UpdateTimerHandle
  private readonly timings: UpdateTimings
  private readonly log: (message: string) => void

  constructor(private readonly deps: UpdateManagerDeps) {
    this.now = deps.now ?? Date.now
    this.random = deps.random ?? Math.random
    this.setTimer = deps.setTimer ?? defaultTimer
    this.timings = deps.timings ?? DEFAULT_UPDATE_TIMINGS
    this.log = deps.log ?? (() => undefined)
  }

  /** Load the stored state (cached manifest, "Later", announced version). Never throws, no network. */
  async init(): Promise<void> {
    this.mem = await this.deps.store.load().catch(() => ({ ...EMPTY_MEMORY }))
    const v = this.view()
    this.log(`update: ${v.status} (this ${v.currentVersion}, latest ${v.latestVersion ?? 'unknown'})`)
  }

  view(): UpdateView {
    return makeView(this.deps.currentVersion, this.mem)
  }

  /** Force update: conversions (and the Remove BG model download) are refused in main. */
  isBlocked(): boolean {
    return this.view().status === 'required'
  }

  /** The installer for this computer (allow-listed), else the download page. */
  downloadUrl(): string {
    return downloadUrlFor(this.mem.manifest, this.deps.platformKey)
  }

  onChange(listener: UpdateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // ——— user actions ———————————————————————————————————————————————————————————————————

  /** Settings → "Check for updates". */
  async checkForUpdates(): Promise<UpdateCheckResult> {
    const ok = await this.checkNow()
    return { ok, view: this.view() }
  }

  /** "Later": hide the banner and the bubble for this latest version (soft updates only). */
  async dismiss(): Promise<UpdateView> {
    const v = this.view()
    if (v.status === 'available' && v.latestVersion && !v.dismissed) {
      await this.setMemory({ ...this.mem, dismissedVersion: v.latestVersion })
    }
    return this.view()
  }

  /** The Uncle showed "I learned new tricks!" for this version: not again. */
  async hintSeen(): Promise<void> {
    const v = this.view()
    if (v.hint && v.latestVersion) await this.setMemory({ ...this.mem, hintShownVersion: v.latestVersion })
  }

  // ——— checking ————————————————————————————————————————————————————————————————————————

  /** Background checks: first after a random delay, then every 6 h. */
  start(): void {
    if (this.started) return
    this.started = true
    this.schedule(firstCheckDelay(this.random(), this.timings))
  }

  stop(): void {
    this.started = false
    this.cancelTimer()
  }

  /** powerMonitor 'resume': check again (after a short delay) if more than 6 h passed. */
  onResume(): void {
    if (!this.started) return
    const ms = resumeCheckDelay(this.lastAttemptAt, this.now(), this.random(), this.timings)
    if (ms !== null) this.schedule(ms)
  }

  /** One check now (the timer's callback, Settings, E2E). Resolves true when a valid manifest arrived. */
  checkNow(): Promise<boolean> {
    if (this.checking) return this.checking
    const p = this.doCheck().finally(() => {
      this.checking = null
    })
    this.checking = p
    return p
  }

  private async doCheck(): Promise<boolean> {
    this.lastAttemptAt = this.now()
    let outcome: FetchOutcome
    try {
      outcome = await fetchManifest(this.deps.fetchImpl, this.deps.manifestUrl, this.deps.timeoutMs ?? UPDATE_TIMEOUT_MS)
    } catch (err) {
      outcome = { kind: 'error', reason: 'network' }
      this.log(`update: check failed (${String(err)})`)
    }
    // A failed check (e.g. offline at start-up) retries after 30 min; a good one waits the full 6 h.
    if (this.started) this.schedule(outcome.kind === 'ok' ? this.timings.intervalMs : this.timings.retryMs)
    if (outcome.kind !== 'ok') {
      this.log(`update: check failed (${outcome.reason}${outcome.status ? ` ${outcome.status}` : ''}); keeping the previous state`)
      return false
    }
    await this.setMemory({ ...this.mem, manifest: outcome.manifest, fetchedAt: new Date(this.now()).toISOString() })
    const v = this.view()
    this.log(`update: check → ${v.status} (latest ${v.latestVersion ?? '?'}, minimum ${outcome.manifest.minimum ?? 'none'})`)
    return true
  }

  private schedule(ms: number): void {
    this.cancelTimer()
    if (!this.started) return
    this.timer = this.setTimer(() => {
      this.timer = null
      void this.checkNow()
    }, ms)
  }

  private cancelTimer(): void {
    this.timer?.cancel()
    this.timer = null
  }

  private async setMemory(mem: UpdateMemory): Promise<void> {
    this.mem = mem
    try {
      await this.deps.store.save(mem)
    } catch (err) {
      this.log(`update: saving the state failed (${String(err)})`)
    }
    const v = this.view()
    for (const l of this.listeners) {
      try {
        l(v)
      } catch {
        // a listener must never break the update flow
      }
    }
  }
}
