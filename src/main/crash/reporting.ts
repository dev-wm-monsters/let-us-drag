// Crash reporting controller (TPM D28). No electron / Sentry import here: the SDK module is loaded
// through an injected `load()` (app.ts passes a dynamic import of ./sdk), so this decides
// everything in a unit-testable way.
//
// - `mode` (config.ts) says whether reporting is possible at all in this run (packaged + DSN, or an
//   explicit test switch). Not possible → nothing is loaded, no flag reaches renderers / the engine.
// - The SDK starts only while the user's `crashReports` setting is on: at launch, or later when they
//   turn it on (live). Turning it off stops sending at once (beforeSend and the transport check the
//   setting on every event); the loaded SDK stays in memory but sends nothing.
// - Renderers get CRASH_REPORTS_ARG whenever reporting is possible (their SDK only forwards to main
//   over IPC; main drops everything while the SDK is not started or the setting is off).
// - The engine gets the flag only when the main SDK is running at fork time (its SDK needs main's
//   MessagePort). Turned on later → the engine is covered from its next start.

import { CRASH_REPORTS_ARG } from '../../shared/crash'
import { crashTags, releaseName, shouldSend, type CrashReportingMode, type CrashTagInput } from './config'
import type { SentryHandle, SentryInitOptions } from './sdk'
import type { ScrubContext } from './scrub'

export interface CrashReportingDeps {
  mode: CrashReportingMode
  /** The user's `crashReports` setting, read live. */
  consent(): boolean
  /** Loads the SDK module (`() => import('./sdk')` in app.ts). */
  load(): Promise<{ initSentry(opts: SentryInitOptions): SentryHandle }>
  tagInput: CrashTagInput
  scrub: ScrubContext
  os: { name: string; version: string }
  /** sentry-test.flag in userData: exists? / delete it. */
  testFlag?: { exists(): boolean; remove(): void }
  log(message: string): void
}

export class CrashReporting {
  private handle: SentryHandle | null = null
  private starting: Promise<boolean> | null = null

  constructor(private readonly deps: CrashReportingDeps) {}

  /** Reporting is possible in this run (independent of the setting). */
  get available(): boolean {
    return this.deps.mode.enabled
  }

  /** The main SDK is running (it may still drop events if the setting is off). */
  get active(): boolean {
    return this.handle !== null
  }

  /** Extra arguments for our renderer windows. */
  rendererArgs(): string[] {
    return this.available ? [CRASH_REPORTS_ARG] : []
  }

  /** Extra argv for the engine utility process (per fork). */
  engineArgs(): string[] {
    return this.active ? [CRASH_REPORTS_ARG] : []
  }

  /** At launch: start the SDK if possible and wanted; then honour sentry-test.flag (one test event). */
  async start(): Promise<void> {
    const mode = this.deps.mode
    if (!mode.enabled) {
      this.deps.log(`crash reports: off in this run (${mode.reason})`)
      return
    }
    if (!(await this.ensureStarted())) return
    const flag = this.deps.testFlag
    if (flag?.exists()) {
      // One event per flag file: delete it first, so a crash while sending cannot loop.
      try {
        flag.remove()
      } catch (err) {
        this.deps.log(`crash reports: could not delete the test flag: ${String(err)}`)
        return
      }
      void this.sendTestEvent('sentry-test.flag')
    }
  }

  /** The `crashReports` setting changed (live). */
  async setConsent(on: boolean): Promise<void> {
    if (on) await this.ensureStarted()
    this.deps.log(`crash reports: ${on ? 'on' : 'off'}`)
  }

  setCharacter(id: string): void {
    this.handle?.setTag('character', id)
  }

  /** Send one test event now (developer tray item, sentry-test.flag). False when nothing could be sent. */
  async sendTestEvent(source: string): Promise<boolean> {
    if (!shouldSend(this.deps.mode, this.deps.consent())) {
      this.deps.log(
        this.deps.mode.enabled
          ? 'crash reports: test event not sent (the "Send crash reports" setting is off)'
          : 'crash reports: test event not sent (crash reporting is off in this run; unpackaged builds need LUD_SENTRY_DEV=1)'
      )
      return false
    }
    if (!(await this.ensureStarted()) || !this.handle) return false
    const ok = await this.handle.sendTestEvent(source)
    this.deps.log(`crash reports: test event ${ok ? 'sent' : 'not confirmed'} (${source})`)
    return ok
  }

  async flush(timeoutMs: number): Promise<void> {
    await this.handle?.flush(timeoutMs)
  }

  private ensureStarted(): Promise<boolean> {
    if (this.handle) return Promise.resolve(true)
    if (this.starting) return this.starting
    const mode = this.deps.mode
    if (!mode.enabled || !this.deps.consent()) return Promise.resolve(false)
    this.starting = this.deps
      .load()
      .then((sdk) => {
        const t = this.deps.tagInput
        this.handle = sdk.initSentry({
          dsn: mode.dsn,
          origin: mode.origin,
          environment: mode.environment,
          release: releaseName(t.version),
          scrub: this.deps.scrub,
          consent: () => this.deps.consent(),
          tags: crashTags(t),
          os: this.deps.os,
          log: this.deps.log
        })
        this.deps.log(`crash reports: on (${mode.environment})`)
        return true
      })
      .catch((err: unknown) => {
        this.deps.log(`crash reports: could not start: ${String(err)}`)
        return false
      })
      .finally(() => {
        this.starting = null
      })
    return this.starting
  }
}
