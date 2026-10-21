import { describe, expect, it } from 'vitest'
import { clampToCircle, hitTest, pupilOffset, ringLayout, softNorm } from './geometry'

describe('ringLayout', () => {
  it('returns nothing for 0 and top for 1', () => {
    expect(ringLayout(0, 100)).toEqual([])
    expect(ringLayout(1, 100)).toEqual([{ index: 0, angle: -90, x: 0, y: -100 }])
  })

  it('keeps small rings on an arc centred at the top', () => {
    const s = ringLayout(3, 100)
    expect(s.map((x) => x.angle)).toEqual([-140, -90, -40])
    for (const slot of s) expect(slot.y).toBeLessThan(0)
  })

  it('places 8 options evenly on the full circle', () => {
    const s = ringLayout(8, 190)
    expect(s).toHaveLength(8)
    for (const slot of s) expect(Math.hypot(slot.x, slot.y)).toBeCloseTo(190, 1)
    const step = s[1]!.angle - s[0]!.angle
    expect(step).toBeCloseTo(45, 6)
    // First option sits just left of the top, the second just right of it.
    expect(s[0]!.angle).toBeCloseTo(-112.5, 6)
    expect(s[1]!.angle).toBeCloseTo(-67.5, 6)
  })

  it('never overlaps bubbles of 84px on a 190px ring', () => {
    for (let n = 2; n <= 8; n++) {
      const s = ringLayout(n, 190)
      for (let i = 1; i < s.length; i++) {
        const d = Math.hypot(s[i]!.x - s[i - 1]!.x, s[i]!.y - s[i - 1]!.y)
        expect(d).toBeGreaterThan(84)
      }
    }
  })
})

describe('hitTest', () => {
  const slots = ringLayout(8, 190)
  const base = { slots, hitRadius: 46, hoveredIndex: null, hysteresis: 12, mouthRadius: 95 }

  it('hits the nearest bubble', () => {
    expect(hitTest({ ...base, p: { x: slots[2]!.x + 10, y: slots[2]!.y } })).toEqual({ kind: 'option', index: 2 })
  })
  it('hits the mouth in the centre and nothing in between', () => {
    expect(hitTest({ ...base, p: { x: 0, y: 10 } })).toEqual({ kind: 'mouth' })
    expect(hitTest({ ...base, p: { x: 0, y: -120 } })).toEqual({ kind: 'none' })
  })
  it('applies hysteresis to the hovered bubble', () => {
    const p = { x: slots[0]!.x, y: slots[0]!.y + 52 }
    expect(hitTest({ ...base, p })).toEqual({ kind: 'none' })
    expect(hitTest({ ...base, p, hoveredIndex: 0 })).toEqual({ kind: 'option', index: 0 })
  })
  it('hit area is at least 64px wide', () => {
    expect(base.hitRadius * 2).toBeGreaterThanOrEqual(64)
  })
})

describe('eye tracking helpers', () => {
  it('softNorm saturates to (-1,1)', () => {
    expect(softNorm(0, 100)).toBe(0)
    expect(softNorm(1e9, 100)).toBeCloseTo(1, 5)
    expect(softNorm(-1e9, 100)).toBeCloseTo(-1, 5)
    expect(softNorm(100, 100)).toBeCloseTo(Math.SQRT1_2, 6)
  })

  it('pupil points exactly at the target and stays inside maxR', () => {
    const eye = { x: 10, y: 10 }
    for (const t of [
      { x: 1000, y: 10 },
      { x: 10, y: -500 },
      { x: -300, y: 400 },
      { x: 12, y: 11 }
    ]) {
      const o = pupilOffset(eye, t, 9)
      expect(Math.hypot(o.x, o.y)).toBeLessThanOrEqual(9 + 1e-9)
      const ang = Math.atan2(o.y, o.x)
      const want = Math.atan2(t.y - eye.y, t.x - eye.x)
      expect(ang).toBeCloseTo(want, 6)
    }
    expect(pupilOffset(eye, eye, 9)).toEqual({ x: 0, y: 0 })
  })

  it('clampToCircle', () => {
    expect(clampToCircle({ x: 3, y: 4 }, 10)).toEqual({ x: 3, y: 4 })
    const c = clampToCircle({ x: 30, y: 40 }, 10)
    expect(c.x).toBeCloseTo(6)
    expect(c.y).toBeCloseTo(8)
  })
})
