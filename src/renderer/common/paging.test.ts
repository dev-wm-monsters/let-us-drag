import { afterEach, describe, expect, it } from 'vitest'
import type { ConversionOption, OptionId } from '../../shared/types'
import { heldChipTop, ringLayout } from './geometry'
import {
  clampPage,
  GUESS_ANGLE,
  NAV_ID,
  pageCount,
  pageLayout,
  pageOfOption,
  RING_CAPACITY,
  ringCapacity,
  ringPage,
  ringTargetAt,
  slotOf,
  targetCenter,
  targetInSlot,
  visibleSlots
} from './paging'

const opts = (n: number): ConversionOption[] =>
  Array.from({ length: n }, (_, i) => ({ id: `o${i}` as OptionId, label: `O${i}`, hint: `Option ${i}`, batch: 'each', minInputs: 1 }))
const ids = (p: ReturnType<typeof ringPage>) => p.entries.map((e) => e.option.id)

describe('ring paging (D31)', () => {
  const g = globalThis as { __ludRingCapacity?: unknown }
  afterEach(() => {
    delete g.__ludRingCapacity
  })

  it('page counts: up to 8 on one ring, then 7 per page + More / Back', () => {
    expect(RING_CAPACITY).toBe(8)
    expect([0, 1, 7, 8].map((n) => pageCount(n))).toEqual([1, 1, 1, 1])
    expect([9, 12, 14].map((n) => pageCount(n))).toEqual([2, 2, 2])
    expect(pageCount(15)).toBe(3)
    expect(pageCount(8, 5)).toBe(2)
  })

  it('up to 8 options: one page laid out exactly as before (no More)', () => {
    for (const n of [1, 4, 8]) {
      const p = ringPage(opts(n), 0)
      expect(p.pageCount).toBe(1)
      expect(p.nav).toBeNull()
      expect(p.slotCount).toBe(n)
      expect(p.entries.map((e) => e.slot)).toEqual(Array.from({ length: n }, (_, i) => i))
      expect(pageLayout(p, 190)).toEqual(ringLayout(n, 190))
    }
  })

  it('12 options: 7 + More (+5) on page 1, 5 + Back on page 2, More / Back in the same slot', () => {
    const list = opts(12)
    const p1 = ringPage(list, 0)
    expect(ids(p1)).toEqual(['o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6'])
    expect(p1.nav).toEqual({ kind: 'more', slot: 7, to: 1, count: 5 })
    expect(p1.slotCount).toBe(8)
    const p2 = ringPage(list, 1)
    expect(ids(p2)).toEqual(['o7', 'o8', 'o9', 'o10', 'o11'])
    expect(p2.entries.map((e) => e.slot)).toEqual([0, 1, 2, 3, 4])
    expect(p2.nav).toEqual({ kind: 'back', slot: 7, to: 0, count: 7 })
    expect(targetCenter(p1, NAV_ID, 190)).toEqual(targetCenter(p2, NAV_ID, 190))
  })

  it('9 and 14 options; three pages show More twice, then Back', () => {
    expect(ids(ringPage(opts(9), 1))).toEqual(['o7', 'o8'])
    expect(ids(ringPage(opts(14), 1))).toHaveLength(7)
    const list = opts(15)
    expect(ringPage(list, 0).nav).toMatchObject({ kind: 'more', to: 1, count: 8 })
    expect(ringPage(list, 1).nav).toMatchObject({ kind: 'more', to: 2, count: 1 })
    expect(ringPage(list, 2).nav).toMatchObject({ kind: 'back', to: 0 })
    expect(ids(ringPage(list, 2))).toEqual(['o14'])
  })

  it('clamps pages and finds the page of an option', () => {
    expect(clampPage(5, 12)).toBe(1)
    expect(clampPage(-1, 12)).toBe(0)
    expect(clampPage(Number.NaN, 12)).toBe(0)
    expect(clampPage(1, 8)).toBe(0)
    expect(ringPage(opts(12), 9).page).toBe(1)
    const list = opts(12)
    expect(pageOfOption(list, 'o6' as OptionId)).toBe(0)
    expect(pageOfOption(list, 'o7' as OptionId)).toBe(1)
    expect(pageOfOption(list, 'nope' as OptionId)).toBe(-1)
    expect(pageOfOption(opts(8), 'o7' as OptionId)).toBe(0)
  })

  it('slots: only what the page shows; empty slots map to nothing', () => {
    const p2 = ringPage(opts(12), 1)
    expect(slotOf(p2, 'o8' as OptionId)).toBe(1)
    expect(slotOf(p2, 'o1' as OptionId)).toBe(-1)
    expect(slotOf(p2, NAV_ID)).toBe(7)
    expect(slotOf(ringPage(opts(3), 0), NAV_ID)).toBe(-1)
    expect(targetInSlot(p2, 5)).toBeNull()
    expect(targetInSlot(p2, 7)).toBe(NAV_ID)
    expect(visibleSlots(p2, 190).map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 7])
  })

  it('hit-testing a page-2 drag point finds the page-2 option, More / Back and the mouth', () => {
    const p2 = ringPage(opts(12), 1)
    const base = { page: p2, radius: 190, hitRadius: 46, mouthRadius: 99, hovered: null }
    const all = ringLayout(8, 190)
    expect(ringTargetAt({ ...base, p: { x: all[2]!.x + 10, y: all[2]!.y - 8 } })).toBe('o9')
    expect(ringTargetAt({ ...base, p: { x: all[7]!.x, y: all[7]!.y } })).toBe(NAV_ID)
    // Empty slot (no option on this page there): nothing.
    expect(ringTargetAt({ ...base, p: { x: all[5]!.x, y: all[5]!.y } })).toBeNull()
    expect(ringTargetAt({ ...base, p: { x: 10, y: 20 } })).toBe('mouth')
    // Hysteresis keeps the hovered bubble a little longer.
    const edge = { x: all[7]!.x + 52, y: all[7]!.y }
    expect(ringTargetAt({ ...base, p: edge })).toBeNull()
    expect(ringTargetAt({ ...base, p: edge, hovered: NAV_ID })).toBe(NAV_ID)
  })

  it('paged rings never reach the held-files chip (it sits below every 1..8 layout)', () => {
    for (const radius of [120, 150, 190]) {
      const top = heldChipTop(radius, 56)
      for (const s of visibleSlots(ringPage(opts(12), 0), radius)) expect(s.y + 50).toBeLessThan(top)
    }
  })

  it('a lone guess bubble (ZIP for unknown drags) sits beside the head, not over it', () => {
    const p = ringPage(opts(1), 0, RING_CAPACITY, true)
    expect(p.guess).toBe(true)
    const [s] = pageLayout(p, 190)
    expect(s!.angle).toBe(GUESS_ANGLE)
    expect(s!.x).toBeGreaterThan(150)
    expect(Math.abs(s!.y)).toBeLessThan(30)
    expect(ringTargetAt({ page: p, radius: 190, hitRadius: 46, mouthRadius: 99, hovered: null, p: { x: s!.x, y: s!.y } })).toBe('o0')
    // Only a single option can be a guess.
    expect(ringPage(opts(2), 0, RING_CAPACITY, true).guess).toBeUndefined()
  })

  it('ring capacity: 8, or the dev/test override (integers 3..8 only)', () => {
    expect(ringCapacity()).toBe(8)
    g.__ludRingCapacity = 5
    expect(ringCapacity()).toBe(5)
    for (const bad of [2, 9, 4.5, '5', null]) {
      g.__ludRingCapacity = bad
      expect(ringCapacity()).toBe(8)
    }
  })
})
