// Pure state machine for the global drag gesture (docs/PLAN.md §3, decision 3).
// No electron / uiohook imports: it is fed plain input events and returns what to do.
//
// Arms when ALL of these hold at the same time:
//   - the left mouse button is held,
//   - the pointer moved more than MOVE_THRESHOLD_PX since the press,
//   - the configured trigger key (either the left or right variant) is held.
// The order does not matter (key first, or drag first then key).
// Disarms when the left button is released (only if it was armed).
// Once armed it stays armed until the left button is released, even if the key is let go.

import type { TriggerKey } from '../../shared/types'

/** Movement (in hook pixels) needed before a press counts as a drag. */
export const MOVE_THRESHOLD_PX = 6

/** libuiohook mouse buttons: 1 = left, 2 = right, 3 = middle, 4/5 = extra. */
export const LEFT_BUTTON = 1

/**
 * libuiohook virtual keycodes for each trigger key (left and right variants).
 * Values verified against node_modules/uiohook-napi/dist/index.d.ts (UiohookKey).
 */
export const TRIGGER_KEYCODES: Readonly<Record<TriggerKey, readonly number[]>> = {
  shift: [42, 54], // Shift, ShiftRight
  alt: [56, 3640], // Alt, AltRight
  ctrl: [29, 3613], // Ctrl, CtrlRight
  meta: [3675, 3676] // Meta, MetaRight
}

export interface ModifierFlags {
  shift: boolean
  alt: boolean
  ctrl: boolean
  meta: boolean
}

export type TriggerInput =
  | { type: 'mouseDown'; button: number; x: number; y: number; modifiers?: ModifierFlags }
  | { type: 'mouseUp'; button: number; x: number; y: number; modifiers?: ModifierFlags }
  | { type: 'mouseMove'; x: number; y: number; modifiers?: ModifierFlags }
  | { type: 'keyDown'; keycode: number }
  | { type: 'keyUp'; keycode: number }
  | { type: 'setTriggerKey'; key: TriggerKey }
  | { type: 'reset' }

export type TriggerAction = 'arm' | 'disarm' | null

export interface TriggerState {
  readonly triggerKey: TriggerKey
  /** Keycodes currently held (only trigger-relevant keycodes are tracked). */
  readonly keysDown: readonly number[]
  readonly leftDown: boolean
  readonly pressX: number
  readonly pressY: number
  /** Pointer moved beyond the threshold since the current press. */
  readonly dragging: boolean
  readonly armed: boolean
}

export function initialTriggerState(triggerKey: TriggerKey = 'shift'): TriggerState {
  return { triggerKey, keysDown: [], leftDown: false, pressX: 0, pressY: 0, dragging: false, armed: false }
}

const ALL_TRACKED: ReadonlySet<number> = new Set(Object.values(TRIGGER_KEYCODES).flat())

export function isTriggerKeyHeld(state: TriggerState): boolean {
  const codes = TRIGGER_KEYCODES[state.triggerKey]
  return state.keysDown.some((k) => codes.includes(k))
}

function movedBeyondThreshold(state: TriggerState, x: number, y: number): boolean {
  const dx = x - state.pressX
  const dy = y - state.pressY
  return dx * dx + dy * dy > MOVE_THRESHOLD_PX * MOVE_THRESHOLD_PX
}

/**
 * Mouse events carry the OS modifier mask. Use it to repair the key set when a key event was
 * missed (e.g. key pressed before the hook started, or released while another app had focus).
 */
function syncModifiers(keysDown: readonly number[], triggerKey: TriggerKey, modifiers?: ModifierFlags): readonly number[] {
  if (!modifiers) return keysDown
  const codes = TRIGGER_KEYCODES[triggerKey]
  const held = keysDown.some((k) => codes.includes(k))
  const reported = modifiers[triggerKey]
  if (reported && !held) return [...keysDown, codes[0]!]
  if (!reported && held) return keysDown.filter((k) => !codes.includes(k))
  return keysDown
}

function withArming(state: TriggerState): { state: TriggerState; action: TriggerAction } {
  if (!state.armed && state.leftDown && state.dragging && isTriggerKeyHeld(state)) {
    return { state: { ...state, armed: true }, action: 'arm' }
  }
  return { state, action: null }
}

export function triggerReducer(state: TriggerState, input: TriggerInput): { state: TriggerState; action: TriggerAction } {
  switch (input.type) {
    case 'mouseDown': {
      if (input.button !== LEFT_BUTTON) return { state, action: null }
      const keysDown = syncModifiers(state.keysDown, state.triggerKey, input.modifiers)
      // A new press starts a fresh gesture (a stray press while armed cannot normally happen;
      // if it does, keep the current armed state until the release).
      return {
        state: { ...state, keysDown, leftDown: true, pressX: input.x, pressY: input.y, dragging: false },
        action: null
      }
    }
    case 'mouseUp': {
      if (input.button !== LEFT_BUTTON) return { state, action: null }
      const wasArmed = state.armed
      const next: TriggerState = { ...state, leftDown: false, dragging: false, armed: false }
      return { state: next, action: wasArmed ? 'disarm' : null }
    }
    case 'mouseMove': {
      const keysDown = syncModifiers(state.keysDown, state.triggerKey, input.modifiers)
      let next: TriggerState = keysDown === state.keysDown ? state : { ...state, keysDown }
      if (next.leftDown && !next.dragging && movedBeyondThreshold(next, input.x, input.y)) {
        next = { ...next, dragging: true }
      }
      return withArming(next)
    }
    case 'keyDown': {
      if (!ALL_TRACKED.has(input.keycode)) return { state, action: null }
      // Key repeat: the code is already held → nothing changes.
      if (state.keysDown.includes(input.keycode)) return withArming(state)
      return withArming({ ...state, keysDown: [...state.keysDown, input.keycode] })
    }
    case 'keyUp': {
      if (!state.keysDown.includes(input.keycode)) return { state, action: null }
      return { state: { ...state, keysDown: state.keysDown.filter((k) => k !== input.keycode) }, action: null }
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
