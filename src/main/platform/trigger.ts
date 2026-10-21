// uiohook-napi adapter → trigger-logic (pure). The native module is loaded lazily, only when the
// hook is actually started (never under LUD_E2E=1, never on macOS without Accessibility, never
// on Wayland — the caller decides via gesture-env.ts).
//
// uiohook-napi API verified in node_modules/uiohook-napi/dist/index.d.ts (v1.5.5):
//   uIOhook.on('mousedown'|'mouseup'|'mousemove'|'keydown'|'keyup', cb); uIOhook.start(); uIOhook.stop()
//   mouse events: { button, x, y, shiftKey, altKey, ctrlKey, metaKey }; key events: { keycode }
//   Dragging is reported as 'mousemove' (src/lib/addon.c maps EVENT_MOUSE_DRAGGED → MOVED).
//   start() throws a JS Error (e.g. UIOHOOK_ERROR_AXAPI_DISABLED / X_OPEN_DISPLAY) on failure.
// Coordinates from uiohook are physical pixels; they are only used for the movement threshold.
// The overlay is positioned with screen.getCursorScreenPoint() (PLAN §3 decision 4).

import type { TriggerKey } from '../../shared/types'
import { initialTriggerState, triggerReducer, type ModifierFlags, type TriggerInput, type TriggerState } from './trigger-logic'

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

export interface GestureTriggerDeps {
  onArm(): void
  onDisarm(): void
  triggerKey: TriggerKey
  /** Loads the hook (default: require uiohook-napi). Injected in tests. */
  loadHook?: () => Promise<HookLike>
  log?: (message: string) => void
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

export class GestureTrigger {
  private hook: HookLike | null = null
  private listening = false
  private running = false
  private state: TriggerState

  constructor(private readonly deps: GestureTriggerDeps) {
    this.state = initialTriggerState(deps.triggerKey)
  }

  get isRunning(): boolean {
    return this.running
  }

  /** Feed one input (exposed for tests). */
  feed(input: TriggerInput): void {
    const r = triggerReducer(this.state, input)
    this.state = r.state
    if (r.action === 'arm') this.deps.onArm()
    else if (r.action === 'disarm') this.deps.onDisarm()
  }

  setTriggerKey(key: TriggerKey): void {
    this.feed({ type: 'setTriggerKey', key })
  }

  /** Start the global hook. Resolves to an error message on failure (never throws). */
  async start(): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.running) return { ok: true }
    try {
      const hook = this.hook ?? (await (this.deps.loadHook ?? defaultLoadHook)())
      this.hook = hook
      if (!this.listening) {
        this.listening = true
        hook.on('mousedown', (e) => this.feed({ type: 'mouseDown', button: Number(e.button), x: e.x, y: e.y, modifiers: modifiers(e) }))
        hook.on('mouseup', (e) => this.feed({ type: 'mouseUp', button: Number(e.button), x: e.x, y: e.y, modifiers: modifiers(e) }))
        hook.on('mousemove', (e) => this.feed({ type: 'mouseMove', x: e.x, y: e.y, modifiers: modifiers(e) }))
        hook.on('keydown', (e) => this.feed({ type: 'keyDown', keycode: e.keycode }))
        hook.on('keyup', (e) => this.feed({ type: 'keyUp', keycode: e.keycode }))
      }
      hook.start()
      this.running = true
      return { ok: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      this.deps.log?.(`input hook failed to start: ${error}`)
      return { ok: false, error }
    }
  }

  stop(): void {
    if (!this.running || !this.hook) return
    try {
      this.hook.stop()
    } catch (err) {
      this.deps.log?.(`input hook failed to stop: ${String(err)}`)
    }
    this.running = false
    // Forget held keys/buttons; disarm if a gesture was in progress.
    this.feed({ type: 'reset' })
  }
}
