import { describe, expect, it } from 'vitest'
import {
  initialTriggerState,
  triggerReducer,
  TRIGGER_KEYCODES,
  type TriggerAction,
  type TriggerInput,
  type TriggerState
} from '../../../src/main/platform/trigger-logic'
import type { TriggerKey } from '../../../src/shared/types'

const SHIFT = 42
const SHIFT_R = 54
const ALT = 56
const CTRL_R = 3613
const META = 3675

function run(inputs: TriggerInput[], start: TriggerState = initialTriggerState('shift')): { state: TriggerState; actions: TriggerAction[] } {
  let state = start
  const actions: TriggerAction[] = []
  for (const i of inputs) {
    const r = triggerReducer(state, i)
    state = r.state
    actions.push(r.action)
  }
  return { state, actions }
}

const down = (x = 100, y = 100, button = 1): TriggerInput => ({ type: 'mouseDown', button, x, y })
const up = (button = 1): TriggerInput => ({ type: 'mouseUp', button, x: 0, y: 0 })
const move = (x: number, y: number): TriggerInput => ({ type: 'mouseMove', x, y })
const kd = (keycode: number): TriggerInput => ({ type: 'keyDown', keycode })
const ku = (keycode: number): TriggerInput => ({ type: 'keyUp', keycode })

const arms = (actions: TriggerAction[]) => actions.filter((a) => a === 'arm').length
const disarms = (actions: TriggerAction[]) => actions.filter((a) => a === 'disarm').length

describe('trigger-logic', () => {
  it('arms when key is held before the drag starts', () => {
    const { state, actions } = run([kd(SHIFT), down(), move(103, 100), move(110, 100)])
    expect(actions).toEqual([null, null, null, 'arm'])
    expect(state.armed).toBe(true)
  })

  it('arms when the key is pressed after the drag started', () => {
    const { actions } = run([down(), move(150, 150), kd(SHIFT)])
    expect(actions).toEqual([null, null, 'arm'])
  })

  it('does not arm without movement beyond the threshold', () => {
    const { actions, state } = run([kd(SHIFT), down(100, 100), move(104, 104), move(100, 106)])
    expect(arms(actions)).toBe(0)
    expect(state.dragging).toBe(false)
  })

  it('threshold is strictly greater than 6px', () => {
    expect(arms(run([kd(SHIFT), down(0, 0), move(6, 0)]).actions)).toBe(0)
    expect(arms(run([kd(SHIFT), down(0, 0), move(7, 0)]).actions)).toBe(1)
  })

  it('does not arm without the trigger key', () => {
    const { actions } = run([down(), move(300, 300), move(400, 400), up()])
    expect(actions.every((a) => a === null)).toBe(true)
  })

  it('does not arm when the key is pressed without a mouse button', () => {
    const { actions } = run([move(0, 0), kd(SHIFT), move(500, 500)])
    expect(arms(actions)).toBe(0)
  })

  it('disarms on left button release and resets', () => {
    const { actions, state } = run([kd(SHIFT), down(), move(200, 200), up()])
    expect(actions.at(-1)).toBe('disarm')
    expect(state.armed).toBe(false)
    expect(state.leftDown).toBe(false)
  })

  it('does not emit disarm on release when it was never armed', () => {
    const { actions } = run([down(), move(200, 200), up()])
    expect(disarms(actions)).toBe(0)
  })

  it('arms at most once per drag', () => {
    const { actions } = run([kd(SHIFT), down(), move(200, 200), move(300, 300), ku(SHIFT), kd(SHIFT), move(310, 310)])
    expect(arms(actions)).toBe(1)
  })

  it('stays armed when the key is released mid-drag, until mouse up', () => {
    const { actions, state } = run([kd(SHIFT), down(), move(200, 200), ku(SHIFT), move(300, 300)])
    expect(arms(actions)).toBe(1)
    expect(state.armed).toBe(true)
    expect(run([up()], state).actions).toEqual(['disarm'])
  })

  it('ignores right / middle / extra buttons', () => {
    const { actions, state } = run([kd(SHIFT), down(100, 100, 2), move(300, 300), down(100, 100, 3), move(400, 400), up(2), up(3)])
    expect(actions.every((a) => a === null)).toBe(true)
    expect(state.leftDown).toBe(false)
  })

  it('other buttons do not disarm an armed drag', () => {
    const { state } = run([kd(SHIFT), down(), move(200, 200), down(0, 0, 2), up(2)])
    expect(state.armed).toBe(true)
  })

  it('handles key repeat (repeated keydown) without side effects', () => {
    const { state, actions } = run([kd(SHIFT), kd(SHIFT), kd(SHIFT), down(), move(200, 200), kd(SHIFT), kd(SHIFT)])
    expect(arms(actions)).toBe(1)
    expect(state.keysDown).toEqual([SHIFT])
    // A single keyup releases it.
    expect(run([ku(SHIFT)], state).state.keysDown).toEqual([])
  })

  it('accepts the right-hand variant of each modifier', () => {
    for (const key of Object.keys(TRIGGER_KEYCODES) as TriggerKey[]) {
      const right = TRIGGER_KEYCODES[key][1]!
      const { actions } = run([kd(right), down(), move(200, 200)], initialTriggerState(key))
      expect(arms(actions), key).toBe(1)
    }
  })

  it('keeps the key held while one of the two variants is still down', () => {
    const { state } = run([kd(SHIFT), kd(SHIFT_R), ku(SHIFT), down(), move(200, 200)])
    expect(state.armed).toBe(true)
  })

  it('only the configured trigger key arms', () => {
    const start = initialTriggerState('alt')
    expect(arms(run([kd(SHIFT), down(), move(200, 200)], start).actions)).toBe(0)
    expect(arms(run([kd(ALT), down(), move(200, 200)], start).actions)).toBe(1)
    expect(arms(run([kd(CTRL_R), down(), move(200, 200)], initialTriggerState('ctrl')).actions)).toBe(1)
    expect(arms(run([kd(META), down(), move(200, 200)], initialTriggerState('meta')).actions)).toBe(1)
  })

  it('ignores unrelated keys', () => {
    const { state } = run([kd(30), kd(57), down(), move(200, 200)])
    expect(state.keysDown).toEqual([])
    expect(state.armed).toBe(false)
  })

  it('changing the trigger key to one that is held mid-drag arms', () => {
    const { actions, state } = run([kd(ALT), down(), move(200, 200), { type: 'setTriggerKey', key: 'alt' }])
    expect(actions.at(-1)).toBe('arm')
    expect(state.triggerKey).toBe('alt')
  })

  it('uses mouse-event modifier flags to recover a missed keydown', () => {
    const mods = { shift: true, alt: false, ctrl: false, meta: false }
    const { actions } = run([{ type: 'mouseDown', button: 1, x: 0, y: 0, modifiers: mods }, { type: 'mouseMove', x: 50, y: 0, modifiers: mods }])
    expect(actions).toEqual([null, 'arm'])
  })

  it('uses mouse-event modifier flags to recover a missed keyup', () => {
    const none = { shift: false, alt: false, ctrl: false, meta: false }
    const { state } = run([kd(SHIFT), { type: 'mouseDown', button: 1, x: 0, y: 0, modifiers: none }, { type: 'mouseMove', x: 50, y: 0, modifiers: none }])
    expect(state.keysDown).toEqual([])
    expect(state.armed).toBe(false)
  })

  it('reset clears everything and disarms when armed', () => {
    const armed = run([kd(SHIFT), down(), move(200, 200)]).state
    const r = triggerReducer(armed, { type: 'reset' })
    expect(r.action).toBe('disarm')
    expect(r.state).toEqual(initialTriggerState('shift'))
    expect(triggerReducer(initialTriggerState(), { type: 'reset' }).action).toBe(null)
  })

  it('a second drag after a release can arm again', () => {
    const { actions } = run([kd(SHIFT), down(), move(200, 200), up(), down(10, 10), move(100, 100)])
    expect(arms(actions)).toBe(2)
    expect(disarms(actions)).toBe(1)
  })

  it('movement threshold is measured from the press position', () => {
    const { actions } = run([kd(SHIFT), move(500, 500), down(500, 500), move(503, 503), move(505, 505)])
    expect(arms(actions)).toBe(1) // 5,5 → distance 7.07 > 6
  })

  it('does not mutate the previous state', () => {
    const s0 = initialTriggerState()
    const frozen = JSON.stringify(s0)
    triggerReducer(s0, kd(SHIFT))
    triggerReducer(s0, down())
    expect(JSON.stringify(s0)).toBe(frozen)
  })
})
