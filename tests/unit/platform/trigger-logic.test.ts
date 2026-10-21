import { describe, expect, it } from 'vitest'
import {
  initialTriggerState,
  NO_MODIFIERS,
  triggerReducer,
  type ModifierFlags,
  type TriggerAction,
  type TriggerInput,
  type TriggerState
} from '../../../src/main/platform/trigger-logic'
import type { TriggerKey } from '../../../src/shared/types'

// Test steps model a real OS: key steps change the "physical" keyboard and emit an abstract
// modifier event; mouse steps carry the modifier mask of that keyboard (like uiohook does).
type Step =
  | { kind: 'key'; key: TriggerKey; held: boolean }
  | { kind: 'down' | 'up'; button: 'left' | 'other'; x: number; y: number; mask?: ModifierFlags }
  | { kind: 'move'; x: number; y: number; mask?: ModifierFlags }
  | { kind: 'raw'; input: TriggerInput }

function run(steps: Step[], start: TriggerState = initialTriggerState('shift')): { state: TriggerState; actions: TriggerAction[] } {
  let state = start
  let keyboard: ModifierFlags = { ...NO_MODIFIERS }
  const actions: TriggerAction[] = []
  for (const s of steps) {
    let input: TriggerInput
    if (s.kind === 'key') {
      keyboard = { ...keyboard, [s.key]: s.held }
      input = { type: 'modifier', key: s.key, held: s.held }
    } else if (s.kind === 'move') input = { type: 'move', x: s.x, y: s.y, modifiers: s.mask ?? keyboard }
    else if (s.kind === 'raw') input = s.input
    else input = { type: s.kind, button: s.button, x: s.x, y: s.y, modifiers: s.mask ?? keyboard }
    const r = triggerReducer(state, input)
    state = r.state
    actions.push(r.action)
  }
  return { state, actions }
}

const kd = (key: TriggerKey = 'shift'): Step => ({ kind: 'key', key, held: true })
const ku = (key: TriggerKey = 'shift'): Step => ({ kind: 'key', key, held: false })
const down = (x = 100, y = 100, button: 'left' | 'other' = 'left'): Step => ({ kind: 'down', button, x, y })
const up = (button: 'left' | 'other' = 'left'): Step => ({ kind: 'up', button, x: 0, y: 0 })
const move = (x: number, y: number, mask?: ModifierFlags): Step => ({ kind: 'move', x, y, mask })

const arms = (actions: TriggerAction[]) => actions.filter((a) => a === 'arm').length
const disarms = (actions: TriggerAction[]) => actions.filter((a) => a === 'disarm').length

describe('trigger-logic', () => {
  it('arms when key is held before the drag starts', () => {
    const { state, actions } = run([kd(), down(), move(103, 100), move(110, 100)])
    expect(actions).toEqual([null, null, null, 'arm'])
    expect(state.armed).toBe(true)
  })

  it('arms when the key is pressed after the drag started (pointer still)', () => {
    const { actions } = run([down(), move(150, 150), kd()])
    expect(actions).toEqual([null, null, 'arm'])
  })

  it('arms from the mouse modifier mask alone (no key events at all)', () => {
    const shift = { ...NO_MODIFIERS, shift: true }
    const { actions } = run([down(), move(150, 150, shift)])
    expect(actions).toEqual([null, 'arm'])
  })

  it('does not arm without movement beyond the threshold', () => {
    const { actions, state } = run([kd(), down(100, 100), move(104, 104), move(100, 106)])
    expect(arms(actions)).toBe(0)
    expect(state.dragging).toBe(false)
  })

  it('threshold is strictly greater than 6px', () => {
    expect(arms(run([kd(), down(0, 0), move(6, 0)]).actions)).toBe(0)
    expect(arms(run([kd(), down(0, 0), move(7, 0)]).actions)).toBe(1)
  })

  it('does not arm without the trigger key', () => {
    const { actions } = run([down(), move(300, 300), move(400, 400), up()])
    expect(actions.every((a) => a === null)).toBe(true)
  })

  it('does not arm when the key is pressed without a mouse button', () => {
    const { actions } = run([move(0, 0), kd(), move(500, 500)])
    expect(arms(actions)).toBe(0)
  })

  it('disarms on left button release and resets', () => {
    const { actions, state } = run([kd(), down(), move(200, 200), up()])
    expect(actions.at(-1)).toBe('disarm')
    expect(state.armed).toBe(false)
    expect(state.leftDown).toBe(false)
  })

  it('does not emit disarm on release when it was never armed', () => {
    const { actions } = run([down(), move(200, 200), up()])
    expect(disarms(actions)).toBe(0)
  })

  it('arms at most once per drag', () => {
    const { actions } = run([kd(), down(), move(200, 200), move(300, 300), ku(), kd(), move(310, 310)])
    expect(arms(actions)).toBe(1)
  })

  it('stays armed when the key is released mid-drag, until mouse up', () => {
    const { actions, state } = run([kd(), down(), move(200, 200), ku(), move(300, 300)])
    expect(arms(actions)).toBe(1)
    expect(state.armed).toBe(true)
    expect(run([up()], state).actions).toEqual(['disarm'])
  })

  it('ignores right / middle / extra buttons', () => {
    const { actions, state } = run([kd(), down(100, 100, 'other'), move(300, 300), down(100, 100, 'other'), move(400, 400), up('other'), up('other')])
    expect(actions.every((a) => a === null)).toBe(true)
    expect(state.leftDown).toBe(false)
  })

  it('other buttons do not disarm an armed drag', () => {
    const { state } = run([kd(), down(), move(200, 200), down(0, 0, 'other'), up('other')])
    expect(state.armed).toBe(true)
  })

  it('handles key repeat (repeated modifier events) without side effects', () => {
    const { state, actions } = run([kd(), kd(), kd(), down(), move(200, 200), kd(), kd()])
    expect(arms(actions)).toBe(1)
    expect(state.modifiers.shift).toBe(true)
    expect(run([ku()], state).state.modifiers.shift).toBe(false)
  })

  it('only the configured trigger key arms', () => {
    expect(arms(run([kd('shift'), down(), move(200, 200)], initialTriggerState('alt')).actions)).toBe(0)
    for (const key of ['alt', 'ctrl', 'meta'] as TriggerKey[]) {
      expect(arms(run([kd(key), down(), move(200, 200)], initialTriggerState(key)).actions), key).toBe(1)
    }
  })

  it('extra modifiers held together with the trigger key still arm (Q-22)', () => {
    expect(arms(run([kd('shift'), kd('ctrl'), down(), move(200, 200)]).actions)).toBe(1)
  })

  it('changing the trigger key to one that is held mid-drag arms', () => {
    const { actions, state } = run([kd('alt'), down(), move(200, 200), { kind: 'raw', input: { type: 'setTriggerKey', key: 'alt' } }])
    expect(actions.at(-1)).toBe('arm')
    expect(state.triggerKey).toBe('alt')
  })

  it('mouse-event modifier flags repair a missed key-down', () => {
    const shift = { ...NO_MODIFIERS, shift: true }
    const { actions } = run([down(0, 0), move(50, 0, shift)])
    expect(actions).toEqual([null, 'arm'])
  })

  it('mouse-event modifier flags repair a missed key-up', () => {
    // The key-up was missed: the keyboard model still says "shift", but the OS mask says no.
    const { state } = run([kd(), { kind: 'down', button: 'left', x: 0, y: 0, mask: NO_MODIFIERS }, move(50, 0, NO_MODIFIERS)])
    expect(state.modifiers.shift).toBe(false)
    expect(state.armed).toBe(false)
  })

  it('reset clears everything and disarms when armed', () => {
    const armed = run([kd(), down(), move(200, 200)]).state
    const r = triggerReducer(armed, { type: 'reset' })
    expect(r.action).toBe('disarm')
    expect(r.state).toEqual(initialTriggerState('shift'))
    expect(triggerReducer(initialTriggerState(), { type: 'reset' }).action).toBe(null)
  })

  it('a second drag after a release can arm again', () => {
    const { actions } = run([kd(), down(), move(200, 200), up(), down(10, 10), move(100, 100)])
    expect(arms(actions)).toBe(2)
    expect(disarms(actions)).toBe(1)
  })

  it('movement threshold is measured from the press position', () => {
    const { actions } = run([kd(), move(500, 500), down(500, 500), move(503, 503), move(505, 505)])
    expect(arms(actions)).toBe(1) // 5,5 → distance 7.07 > 6
  })

  it('state holds only abstract modifier flags (no key codes)', () => {
    const { state } = run([kd(), down(), move(200, 200)])
    expect(Object.keys(state).sort()).toEqual(['armed', 'dragging', 'leftDown', 'modifiers', 'pressX', 'pressY', 'triggerKey'])
    expect(state.modifiers).toEqual({ shift: true, alt: false, ctrl: false, meta: false })
  })

  it('does not mutate the previous state', () => {
    const s0 = initialTriggerState()
    const frozen = JSON.stringify(s0)
    triggerReducer(s0, { type: 'modifier', key: 'shift', held: true })
    triggerReducer(s0, { type: 'down', button: 'left', x: 1, y: 1, modifiers: { ...NO_MODIFIERS, shift: true } })
    expect(JSON.stringify(s0)).toBe(frozen)
  })
})
