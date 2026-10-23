// Owns the global gesture lifecycle + the PlatformStatus report.
// Decides whether the hook may start (gesture-env.ts), starts/stops it, handles pause.

import type { PlatformStatus, TriggerKey } from '../../shared/types'
import { decideGestureEnv, normalizePlatform } from './gesture-env'
import { ModifierProbe } from './modifier-probe'
import { GestureTrigger, type GestureTriggerDeps } from './trigger'

export interface GestureManagerDeps {
  platform: NodeJS.Platform
  env: Readonly<Record<string, string | undefined>>
  /** Under E2E the hook is never started (status still reflects the environment). */
  neverStartHook: boolean
  isAccessibilityTrusted(): boolean
  triggerKey: TriggerKey
  onArm(): void
  onDisarm(): void
  onStatusChanged(status: PlatformStatus): void
  log?: (message: string) => void
  /** Field diagnostics only (see GestureTriggerDeps.debug). */
  debug?: (message: string) => void
  /**
   * macOS: path of the lud-modifiers helper (paths.ts modifierHelperPath). Polled mid-drag so a
   * trigger key pressed during a Finder drag arms (modifier-probe.ts). Ignored on other platforms.
   */
  modifierHelperPath?: string
  /** Tests only: replaces the default ModifierProbe factory (still darwin-only). */
  createModifierProbe?: GestureTriggerDeps['createModifierProbe']
}

export class GestureManager {
  private readonly trigger: GestureTrigger
  private paused = false
  private hookError = false
  private status: PlatformStatus

  constructor(private readonly deps: GestureManagerDeps) {
    const helperPath = deps.modifierHelperPath
    const createModifierProbe: GestureTriggerDeps['createModifierProbe'] =
      deps.platform !== 'darwin'
        ? undefined
        : (deps.createModifierProbe ??
          (helperPath ? (onModifiers) => new ModifierProbe({ helperPath, onModifiers, debug: deps.debug }) : undefined))
    this.trigger = new GestureTrigger({
      createModifierProbe,
      onArm: deps.onArm,
      onDisarm: deps.onDisarm,
      triggerKey: deps.triggerKey,
      log: deps.log,
      debug: deps.debug
    })
    this.status = this.computeStatus()
  }

  getStatus(): PlatformStatus {
    return { ...this.status }
  }

  get isPaused(): boolean {
    return this.paused
  }

  get isHookRunning(): boolean {
    return this.trigger.isRunning
  }

  setTriggerKey(key: TriggerKey): void {
    this.trigger.setTriggerKey(key)
  }

  /** Re-evaluate the environment (e.g. after Accessibility was granted) and start if possible. */
  async refresh(): Promise<PlatformStatus> {
    const decision = this.decide()
    if (decision.canStart && !this.paused && !this.deps.neverStartHook && !this.trigger.isRunning) {
      const r = await this.trigger.start()
      this.hookError = !r.ok
      if (r.ok) this.deps.log?.('input hook started')
    }
    if (!decision.canStart && this.trigger.isRunning) this.trigger.stop()
    this.deps.debug?.(
      `gesture refresh: canStart=${decision.canStart}${decision.canStart ? '' : ` reason=${decision.reason}`} paused=${this.paused} ` +
        `hookRunning=${this.trigger.isRunning} hookError=${this.hookError}`
    )
    this.publish()
    return this.getStatus()
  }

  async setPaused(paused: boolean): Promise<void> {
    this.paused = paused
    if (paused) {
      this.trigger.stop()
      this.publish()
      return
    }
    await this.refresh()
  }

  stop(): void {
    this.trigger.stop()
  }

  private decide() {
    const trusted = this.deps.platform === 'darwin' ? this.deps.isAccessibilityTrusted() : undefined
    return decideGestureEnv({ platform: this.deps.platform, env: this.deps.env, accessibilityTrusted: trusted })
  }

  private computeStatus(): PlatformStatus {
    const platform = normalizePlatform(this.deps.platform)
    const decision = this.decide()
    const status: PlatformStatus = { platform, gestureAvailable: decision.canStart && !this.hookError }
    if (!decision.canStart) status.gestureUnavailableReason = decision.reason
    else if (this.hookError) status.gestureUnavailableReason = 'hook-failed'
    if (platform === 'darwin') status.accessibilityTrusted = this.deps.isAccessibilityTrusted()
    return status
  }

  private publish(): void {
    const next = this.computeStatus()
    const changed = JSON.stringify(next) !== JSON.stringify(this.status)
    this.status = next
    if (changed) this.deps.onStatusChanged(this.getStatus())
  }
}
