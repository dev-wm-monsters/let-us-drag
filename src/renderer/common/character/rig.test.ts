import { describe, expect, it } from 'vitest'
import { OVERLAY_CHARACTER_SCALE, overlayCharacterWidth, uncleWidthFor } from '../layout'
import { type Mood, settle } from '../uncle/pose'
import { BEHIND_PARTS, blinkAmount, compose, lidTransform, mouthOpen, partTransforms, prefixIds, rootAttrs } from './rig'

const calm = { hamster: false, struggle: false }

describe('generic character rig', () => {
  it('mouth: open while eating / waiting / hovering, closed when idle, appearing or reacting', () => {
    for (const m of ['eat', 'feedMe', 'hover'] as Mood[]) expect(mouthOpen(m, 1.3, calm, false), m).toBe(true)
    for (const m of ['idle', 'appear', 'choke', 'refuse', 'leave', 'hidden'] as Mood[]) expect(mouthOpen(m, 1.3, calm, false), m).toBe(false)
    expect(mouthOpen('spit', 0.1, calm, false)).toBe(true)
    expect(mouthOpen('spit', 1, calm, false)).toBe(false)
  })

  it('chew alternates open/closed at ~4 Hz (slower with reduced motion or when struggling)', () => {
    const flips = (reduced: boolean, mods = calm) => {
      let n = 0
      let prev = mouthOpen('chew', 0, mods, reduced)
      for (let t = 0.001; t < 1; t += 0.001) {
        const o = mouthOpen('chew', t, mods, reduced)
        if (o !== prev) n++
        prev = o
      }
      return n
    }
    expect(mouthOpen('chew', 0, calm, false)).toBe(true)
    expect(flips(false)).toBe(7) // 4 cycles = 8 edges, minus the one at t = 1
    expect(flips(true)).toBe(3)
    expect(flips(false, { hamster: false, struggle: true })).toBeLessThan(flips(false))
  })

  it('blink only kicks in for real blinks (resting / chew lids keep the drawn eyes)', () => {
    expect(blinkAmount(0.1)).toBe(0)
    expect(blinkAmount(0.55)).toBe(0)
    expect(blinkAmount(1)).toBe(1)
    expect(blinkAmount(0.8)).toBeGreaterThan(0)
  })

  it('lid stretches from its top edge down to the bottom of the eye', () => {
    const lid = { y: -63, height: 13 }
    const eye = { y: -55, height: 42 } // bottom at -13
    expect(lidTransform(0, lid, eye)).toBe('')
    const t = lidTransform(1, lid, eye)
    const k = Number(/scale\(1 ([\d.]+)\)/.exec(t)?.[1])
    expect(-63 + 13 * k).toBeCloseTo(-13, 0)
    expect(t.startsWith('translate(0 -63)')).toBe(true)
  })

  it('part transforms are finite for every mood, and the face turns toward the target', () => {
    for (const mood of ['idle', 'appear', 'hover', 'feedMe', 'eat', 'chew', 'spit', 'choke', 'refuse', 'leave', 'cancel'] as Mood[]) {
      const x = partTransforms(settle(mood, 0.7, { x: 150, y: -40 }))
      for (const [k, v] of Object.entries(x)) expect(v, `${mood} ${k}`).not.toMatch(/NaN|Infinity/)
      expect(Object.values(rootAttrs(settle(mood, 0.7, null))).join(' ')).not.toMatch(/NaN|Infinity/)
    }
    const right = partTransforms(settle('idle', 1.5, { x: 400, y: 0 }))
    const left = partTransforms(settle('idle', 1.5, { x: -400, y: 0 }))
    const dx = (s: string) => Number(/translate\((-?[\d.]+)/.exec(s)?.[1])
    expect(dx(right.face)).toBeGreaterThan(0)
    expect(dx(left.face)).toBeLessThan(0)
    // Hair / ears / hats move against the turn (behind the face plane).
    for (const k of BEHIND_PARTS) expect(dx(right[k])).toBeLessThan(0)
    expect(dx(right.pupilR)).toBeGreaterThan(0)
  })

  it('compose keeps the drawing’s own transform innermost', () => {
    expect(compose('translate(1 2)', 'rotate(3)')).toBe('translate(1 2) rotate(3)')
    expect(compose('translate(1 2)', null)).toBe('translate(1 2)')
    expect(compose('', 'rotate(3)')).toBe('rotate(3)')
  })

  it('prefixIds makes ids and their references unique per instance', () => {
    const out = prefixIds('<clipPath id="a"/><g clip-path="url(#a)"><use href="#a"/></g><g data-id="x"/>', 'p1')
    expect(out).toBe('<clipPath id="p1-a"/><g clip-path="url(#p1-a)"><use href="#p1-a"/></g><g data-id="x"/>')
  })

  it('overlay draws the character 15 % smaller (one constant), ring untouched', () => {
    expect(OVERLAY_CHARACTER_SCALE).toBe(0.85)
    expect(overlayCharacterWidth(190)).toBe(Math.round(uncleWidthFor(190, 250) * 0.85))
    expect(overlayCharacterWidth(190)).toBeLessThan(uncleWidthFor(190, 250))
  })
})
