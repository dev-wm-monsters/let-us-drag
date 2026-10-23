// uiohook-napi adapter → trigger-logic (pure). The native module is loaded lazily, only when the
// hook is actually started (never in E2E mode, never on macOS without Accessibility, never
// on Wayland — the caller decides via gesture-env.ts).
//
// uiohook-napi API verified in node_modules/uiohook-napi/dist/index.d.ts / index.js (v1.5.5):
//   uIOhook.on('mousedown'|'mouseup'|'mousemove'|'keydown'|'keyup', cb); uIOhook.start(); uIOhook.stop()
//   mouse events: { button, x, y, shiftKey, altKey, ctrlKey, metaKey }; key events: { keycode, … }
//   Dragging is reported as 'mousemove' (src/lib/addon.c maps EVENT_MOUSE_DRAGGED → MOVED).
//   start() throws a JS Error (e.g. UIOHOOK_ERROR_AXAPI_DISABLED / X_OPEN_DISPLAY) on failure.
//   The native hook delivers every event to JS (uIOhook.handler) whether or not we listen.
//
// Privacy (docs/security/CHECKLIST.md SEC-30..35):
// - The trigger is derived from the modifier flags that uiohook puts on MOUSE events, plus the
//   left-button state and the movement distance. Nothing else.
// - The key listener exists only so pressing the trigger key while the pointer is still (mid
//   drag) arms at once. It maps the 8 modifier key codes to an abstract { key, held } event and
//   returns immediately for every other key: no key code, character or timestamp is kept,
//   logged, sent over IPC or written anywhere.
// - macOS: during a Finder drag the event tap goes silent until the release, so mid-drag the
//   modifier state comes from the lud-modifiers helper instead (modifier-probe.ts: the four
//   modifier flags only, polled while a drag is in progress and the trigger has not armed).
// - Coordinates are only compared against the press point (movement threshold), never stored
//   beyond the current gesture, logged or sent. The overlay is positioned with
//   screen.getCursorScreenPoint() (PLAN §3 decision 4).
// - This file does no I/O and no logging of events; arm/disarm side effects are deferred out of
//   the hook callback (SEC-35).

import type { TriggerKey } from '../../shared/types'
import type { ModifierProbeLike } from './modifier-probe'
import { describeTriggerTransition, initialTriggerState, triggerReducer, type ModifierFlags, type MouseButton, type TriggerInput, type TriggerState } from './trigger-logic'

interface HookMouseEvent {
  button: unknown
  x: number
  y: number
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}
interface HookKeyEvent {
  keycode: number
}
interface HookLike {
  on(event: 'mousedown' | 'mouseup' | 'mousemove', listener: (e: HookMouseEvent) => void): unknown
  on(event: 'keydown' | 'keyup', listener: (e: HookKeyEvent) => void): unknown
  start(): void
  stop(): void
}

/** libuiohook mouse buttons: 1 = left, 2 = right, 3 = middle, 4/5 = extra. */
export const LEFT_BUTTON = 1

/**
 * libuiohook virtual keycodes of the modifier keys (left and right variants).
 * Values verified against node_modules/uiohook-napi/dist/index.d.ts (UiohookKey).
 */
export const MODIFIER_KEYCODES: Readonly<Record<TriggerKey, readonly number[]>> = {
  shift: [42, 54], // Shift, ShiftRight
  alt: [56, 3640], // Alt, AltRight
  ctrl: [29, 3613], // Ctrl, CtrlRight
  meta: [3675, 3676] // Meta, MetaRight
}

const KEYCODE_TO_MODIFIER: ReadonlyMap<number, TriggerKey> = new Map(
  (Object.entries(MODIFIER_KEYCODES) as [TriggerKey, readonly number[]][]).flatMap(([key, codes]) => codes.map((c) => [c, key] as const))
)

/** The modifier a key code belongs to, or null (every other key is ignored). */
export function modifierForKeycode(keycode: unknown): TriggerKey | null {
  return typeof keycode === 'number' ? (KEYCODE_TO_MODIFIER.get(keycode) ?? null) : null
}

export interface GestureTriggerDeps {
  onArm(): void
  onDisarm(): void
  triggerKey: TriggerKey
  /** Loads the hook (default: require uiohook-napi). Injected in tests. */
  loadHook?: () => Promise<HookLike>
  /** Runs arm/disarm side effects outside the hook callback (default: setImmediate). */
  schedule?: (fn: () => void) => void
  log?: (message: string) => void
  /**
   * Field diagnostics only (LUD_DEBUG=1 / debug.flag): abstract trigger transitions
   * (describeTriggerTransition: left down/up, drag threshold, trigger key down/up, arm/disarm; no
   * coordinates, no other keys). Called through `schedule`, i.e. outside the hook callback (SEC-35).
   */
  debug?: (message: string) => void
  /**
   * macOS only (gesture.ts): creates the mid-drag modifier probe (modifier-probe.ts). It runs while
   * the left button is held past the drag threshold and the trigger has not armed yet; its
   * snapshots are fed as `{ type: 'modifiers' }`. Absent on Windows/Linux: behaviour unchanged.
   */
  createModifierProbe?: (onModifiers: (modifiers: ModifierFlags) => void) => ModifierProbeLike
}

async function defaultLoadHook(): Promise<HookLike> {
  const mod = (await import('uiohook-napi')) as unknown as { uIOhook?: HookLike; default?: { uIOhook?: HookLike } }
  const hook = mod.uIOhook ?? mod.default?.uIOhook
  if (!hook) throw new Error('uiohook-napi: uIOhook export not found')
  return hook
}

function modifiers(e: HookMouseEvent): ModifierFlags {
  return { shift: Boolean(e.shiftKey), alt: Boolean(e.altKey), ctrl: Boolean(e.ctrlKey), meta: Boolean(e.metaKey) }
}

function button(e: HookMouseEvent): MouseButton {
  return Number(e.button) === LEFT_BUTTON ? 'left' : 'other'
}

export class GestureTrigger {
  private hook: HookLike | null = null
  private listening = false
  private running = false
  private state: TriggerState
  private readonly probe: ModifierProbeLike | null
  private probeWanted = false

  constructor(private readonly deps: GestureTriggerDeps) {
    this.state = initialTriggerState(deps.triggerKey)
    this.probe =
      deps.createModifierProbe?.((modifiers) => {
        if (this.running) this.feed({ type: 'modifiers', modifiers })
      }) ?? null
  }

  get isRunning(): boolean {
    return this.running
  }

  /** Feed one abstract input (exposed for tests). */
  feed(input: TriggerInput): void {
    const prev = this.state
    const r = triggerReducer(prev, input)
    this.state = r.state
    const schedule = this.deps.schedule ?? ((f: () => void) => void setImmediate(f))
    const debug = this.deps.debug
    if (debug) {
      const changes = describeTriggerTransition(prev, r.state, r.action)
      if (changes.length > 0) schedule(() => debug(`trigger: ${changes.join(', ')}`))
    }
    this.syncProbe(schedule)
    if (r.action === null) return
    const fn = r.action === 'arm' ? this.deps.onArm : this.deps.onDisarm
    schedule(() => fn())
  }

  /** Start/stop the modifier probe (deferred like arm/disarm) when it becomes (un)needed. */
  private syncProbe(schedule: (fn: () => void) => void): void {
    if (!this.probe) return
    const wanted = this.running && this.state.leftDown && this.state.dragging && !this.state.armed
    if (wanted === this.probeWanted) return
    this.probeWanted = wanted
    const probe = this.probe
    schedule(() => {
      if (this.probeWanted) probe.start()
      else probe.stop()
    })
  }

  setTriggerKey(key: TriggerKey): void {
    this.feed({ type: 'setTriggerKey', key })
  }

  private onKey(e: HookKeyEvent, held: boolean): void {
    if (!this.running) return
    const key = modifierForKeycode(e?.keycode)
    if (key === null) return // not a modifier: dropped, nothing kept
    this.feed({ type: 'modifier', key, held })
  }

  /** Start the global hook. Resolves to an error message on failure (never throws). */
  async start(): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.running) return { ok: true }
    try {
      const hook = this.hook ?? (await (this.deps.loadHook ?? defaultLoadHook)())
      this.hook = hook
      if (!this.listening) {
        this.listening = true
        hook.on('mousedown', (e) => {
          if (this.running) this.feed({ type: 'down', button: button(e), x: e.x, y: e.y, modifiers: modifiers(e) })
        })
        hook.on('mouseup', (e) => {
          if (this.running) this.feed({ type: 'up', button: button(e), x: e.x, y: e.y, modifiers: modifiers(e) })
        })
        hook.on('mousemove', (e) => {
          if (this.running) this.feed({ type: 'move', x: e.x, y: e.y, modifiers: modifiers(e) })
        })
        hook.on('keydown', (e) => this.onKey(e, true))
        hook.on('keyup', (e) => this.onKey(e, false))
      }
      hook.start()
      this.running = true
      this.deps.debug?.(`input hook started (trigger key ${this.state.triggerKey})`)
      return { ok: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      this.deps.log?.(`input hook failed to start: ${error}`)
      return { ok: false, error }
    }
  }

  stop(): void {
    if (!this.running || !this.hook) return
    this.running = false
    this.deps.debug?.('input hook stopping')
    try {
      this.hook.stop()
    } catch (err) {
      this.deps.log?.(`input hook failed to stop: ${String(err)}`)
    }
    // Forget held keys/buttons; disarm if a gesture was in progress.
    this.feed({ type: 'reset' })
    this.probeWanted = false
    this.probe?.stop()
  }
}
