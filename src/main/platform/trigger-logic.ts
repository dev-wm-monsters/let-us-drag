// Pure state machine for the global drag gesture (docs/PLAN.md §3, decision 3).
// No electron / uiohook imports: it is fed ABSTRACT input events and returns what to do.
//
// Privacy (SEC-30..33): the machine only ever sees
//   - the left-button state and pointer movement (for the drag threshold), and
//   - which modifier keys are held (shift / alt / ctrl / meta), never key codes or characters.
// The uiohook adapter (trigger.ts) converts raw hook events into these abstract events and
// drops everything else on the spot. Nothing here is stored beyond the current gesture.
//
// Arms when ALL of these hold at the same time:
//   - the left mouse button is held,
//   - the pointer moved more than MOVE_THRESHOLD_PX since the press,
//   - the configured trigger modifier is held.
// The order does not matter (key first, or drag first then key).
// Disarms when the left button is released (only if it was armed).
// Once armed it stays armed until the left button is released, even if the key is let go.

import type { TriggerKey } from '../../shared/types'

/** Movement (in hook pixels) needed before a press counts as a drag. */
export const MOVE_THRESHOLD_PX = 6

export interface ModifierFlags {
  shift: boolean
  alt: boolean
  ctrl: boolean
  meta: boolean
}

export const NO_MODIFIERS: ModifierFlags = Object.freeze({ shift: false, alt: false, ctrl: false, meta: false })

export type MouseButton = 'left' | 'other'

export type TriggerInput =
  /** Mouse events carry the OS modifier mask; it is authoritative for the modifier state. */
  | { type: 'down'; button: MouseButton; x: number; y: number; modifiers: ModifierFlags }
  | { type: 'up'; button: MouseButton; x: number; y: number; modifiers: ModifierFlags }
  | { type: 'move'; x: number; y: number; modifiers: ModifierFlags }
  /** A modifier key went down/up (the adapter maps modifier key codes to this; all other keys are dropped). */
  | { type: 'modifier'; key: TriggerKey; held: boolean }
  | { type: 'setTriggerKey'; key: TriggerKey }
  | { type: 'reset' }

export type TriggerAction = 'arm' | 'disarm' | null

export interface TriggerState {
  readonly triggerKey: TriggerKey
  /** Modifiers currently held (as last reported). */
  readonly modifiers: ModifierFlags
  readonly leftDown: boolean
  readonly pressX: number
  readonly pressY: number
  /** Pointer moved beyond the threshold since the current press. */
  readonly dragging: boolean
  readonly armed: boolean
}

export function initialTriggerState(triggerKey: TriggerKey = 'shift'): TriggerState {
  return { triggerKey, modifiers: NO_MODIFIERS, leftDown: false, pressX: 0, pressY: 0, dragging: false, armed: false }
}

export function isTriggerKeyHeld(state: TriggerState): boolean {
  return state.modifiers[state.triggerKey]
}

function movedBeyondThreshold(state: TriggerState, x: number, y: number): boolean {
  const dx = x - state.pressX
  const dy = y - state.pressY
  return dx * dx + dy * dy > MOVE_THRESHOLD_PX * MOVE_THRESHOLD_PX
}

function sameModifiers(a: ModifierFlags, b: ModifierFlags): boolean {
  return a.shift === b.shift && a.alt === b.alt && a.ctrl === b.ctrl && a.meta === b.meta
}

function normalizeModifiers(m: ModifierFlags | undefined): ModifierFlags {
  if (!m) return NO_MODIFIERS
  return { shift: m.shift === true, alt: m.alt === true, ctrl: m.ctrl === true, meta: m.meta === true }
}

function withModifiers(state: TriggerState, m: ModifierFlags | undefined): TriggerState {
  const modifiers = normalizeModifiers(m)
  return sameModifiers(modifiers, state.modifiers) ? state : { ...state, modifiers }
}

function withArming(state: TriggerState): { state: TriggerState; action: TriggerAction } {
  if (!state.armed && state.leftDown && state.dragging && isTriggerKeyHeld(state)) {
    return { state: { ...state, armed: true }, action: 'arm' }
  }
  return { state, action: null }
}

export function triggerReducer(state: TriggerState, input: TriggerInput): { state: TriggerState; action: TriggerAction } {
  switch (input.type) {
    case 'down': {
      const s = withModifiers(state, input.modifiers)
      if (input.button !== 'left') return { state: s, action: null }
      // A new press starts a fresh gesture (a stray press while armed cannot normally happen;
      // if it does, keep the current armed state until the release).
      return { state: { ...s, leftDown: true, pressX: input.x, pressY: input.y, dragging: false }, action: null }
    }
    case 'up': {
      const s = withModifiers(state, input.modifiers)
      if (input.button !== 'left') return { state: s, action: null }
      const wasArmed = s.armed
      return { state: { ...s, leftDown: false, dragging: false, armed: false }, action: wasArmed ? 'disarm' : null }
    }
    case 'move': {
      let next = withModifiers(state, input.modifiers)
      if (next.leftDown && !next.dragging && movedBeyondThreshold(next, input.x, input.y)) {
        next = { ...next, dragging: true }
      }
      return withArming(next)
    }
    case 'modifier': {
      if (state.modifiers[input.key] === input.held) return withArming(state)
      return withArming({ ...state, modifiers: { ...state.modifiers, [input.key]: input.held } })
    }
    case 'setTriggerKey': {
      if (input.key === state.triggerKey) return { state, action: null }
      return withArming({ ...state, triggerKey: input.key })
    }
    case 'reset': {
      return { state: initialTriggerState(state.triggerKey), action: state.armed ? 'disarm' : null }
    }
  }
}
