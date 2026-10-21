import { describe, expect, it } from 'vitest'
import { clamp, damp, lerp, spring, springStep } from './spring'
import { mulberry32, randRange } from './prng'

describe('springStep (critically damped)', () => {
  it('converges to the target without overshoot from rest', () => {
    const s = spring(0)
    let max = -Infinity
    for (let i = 0; i < 240; i++) {
      springStep(s, 100, 10, 1 / 60)
      max = Math.max(max, s.x)
    }
    expect(max).toBeLessThanOrEqual(100)
    expect(s.x).toBeCloseTo(100, 3)
  })

  it('is frame-rate independent (exact solution)', () => {
    const a = spring(3, -2)
    const b = spring(3, -2)
    springStep(a, 10, 7, 0.1)
    for (let i = 0; i < 10; i++) springStep(b, 10, 7, 0.01)
    expect(b.x).toBeCloseTo(a.x, 9)
    expect(b.v).toBeCloseTo(a.v, 9)
  })

  it('stays stable for huge dt and ignores invalid dt', () => {
    const s = spring(0)
    springStep(s, 5, 30, 10)
    expect(s.x).toBe(5)
    expect(Number.isFinite(s.v)).toBe(true)
    const t = spring(1, 1)
    springStep(t, 5, 30, 0)
    springStep(t, 5, 30, Number.NaN)
    springStep(t, 5, 30, -1)
    expect(t).toEqual({ x: 1, v: 1 })
  })

  it('snaps when settled', () => {
    const s = spring(0)
    for (let i = 0; i < 600; i++) springStep(s, 1, 12, 1 / 60)
    expect(s).toEqual({ x: 1, v: 0 })
  })

  it('does not jitter: monotonic approach for a constant target', () => {
    const s = spring(0)
    let prev = s.x
    for (let i = 0; i < 120; i++) {
      springStep(s, 1, 9, 1 / 60)
      expect(s.x).toBeGreaterThanOrEqual(prev)
      prev = s.x
    }
  })
})

describe('helpers', () => {
  it('damp moves towards target and is dt-independent', () => {
    const one = damp(0, 10, 5, 0.2)
    let two = 0
    two = damp(two, 10, 5, 0.1)
    two = damp(two, 10, 5, 0.1)
    expect(two).toBeCloseTo(one, 9)
    expect(damp(3, 10, 5, 0)).toBe(3)
  })
  it('lerp and clamp', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5)
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-5, 0, 1)).toBe(0)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })
})

describe('mulberry32', () => {
  it('is deterministic and in [0,1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 1000; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
    const r = mulberry32(1)
    const v = randRange(r, 2, 4)
    expect(v).toBeGreaterThanOrEqual(2)
    expect(v).toBeLessThan(4)
  })
})
