// Paging for the options ring (D31): a ring holds at most RING_CAPACITY bubbles. Longer option lists
// show the first (capacity - 1) options plus a "More…" bubble; the last page shows the rest plus a
// "Back" bubble in the same spot. Pure (no DOM), shared by the reducer, the session hook and Stage.
import type { ConversionOption, OptionId } from '../../shared/types'
import { hitTest, type Point, ringLayout, type RingSlot } from './geometry'

/** Most bubbles one ring shows (the full-circle layout); beyond that the ring pages. */
export const RING_CAPACITY = 8
/** Smallest capacity the dev/test override accepts (2 options + the More bubble). */
const MIN_CAPACITY = 3

/** Hover target id of the More / Back bubble (never a real option id: options use `to-…`-style ids). */
export const NAV_ID = 'ring-nav' as const
export type NavId = typeof NAV_ID
/** Anything on the ring the pointer can be over: an option or the More / Back bubble. */
export type RingTarget = OptionId | NavId

/** During a drag (no clicks possible) the pointer has to rest on More / Back this long to turn the page. */
export const PAGE_DWELL_MS = 400

/**
 * Ring capacity. 8, unless a test or the dev harness lowered it through `globalThis.__ludRingCapacity`
 * (an integer 3..8), e.g. to try three-page rings (D31). Nothing in the app sets it.
 */
export function ringCapacity(): number {
  const v = (globalThis as { __ludRingCapacity?: unknown }).__ludRingCapacity
  if (typeof v === 'number' && Number.isInteger(v) && v >= MIN_CAPACITY && v <= RING_CAPACITY) return v
  return RING_CAPACITY
}

export function isNav(t: RingTarget | 'mouth' | null | undefined): t is NavId {
  return t === NAV_ID
}

export interface RingEntry {
  option: ConversionOption
  /** Slot index in ringLayout(slotCount). */
  slot: number
}

export interface RingNav {
  kind: 'more' | 'back'
  slot: number
  /** Page the bubble turns to. */
  to: number
  /** 'more': options on the following pages; 'back': options on the first page. */
  count: number
}

export interface RingPage {
  page: number
  pageCount: number
  /** Number of slots the ring is laid out with (paged rings always use the full capacity). */
  slotCount: number
  entries: RingEntry[]
  nav: RingNav | null
  /**
   * A lone guess bubble (ZIP during a drag of unknown types): it sits at GUESS_ANGLE, beside his
   * "Feed me, or ZIP it!" speech bubble instead of right above it.
   */
  guess?: boolean
}

/** Where the lone guess bubble sits (degrees, 0 = right, -90 = up): beside his head, clear of the speech bubble. */
export const GUESS_ANGLE = -5

export function pageCount(total: number, capacity: number = RING_CAPACITY): number {
  if (total <= capacity) return 1
  return Math.ceil(total / (capacity - 1))
}

export function clampPage(page: number, total: number, capacity: number = RING_CAPACITY): number {
  const n = pageCount(total, capacity)
  if (!Number.isFinite(page) || page < 0) return 0
  return Math.min(Math.floor(page), n - 1)
}

/**
 * The bubbles of one page. Up to `capacity` options: one page, laid out as before (an arc over the
 * head for few options, the full circle for `capacity`). More: every page uses the full-circle
 * layout so the More / Back bubble keeps its spot (the last slot, just left of the top), and the
 * options fill the slots clockwise from the top.
 */
export function ringPage(
  options: readonly ConversionOption[],
  page: number,
  capacity: number = RING_CAPACITY,
  guess = false
): RingPage {
  const total = options.length
  const count = pageCount(total, capacity)
  if (count === 1) {
    const entries = options.map((option, slot) => ({ option, slot }))
    return { page: 0, pageCount: 1, slotCount: total, entries, nav: null, ...(guess && total === 1 ? { guess: true } : {}) }
  }
  const per = capacity - 1
  const p = clampPage(page, total, capacity)
  const start = p * per
  const shown = options.slice(start, start + per)
  const last = p === count - 1
  const nav: RingNav = last
    ? { kind: 'back', slot: capacity - 1, to: 0, count: Math.min(per, total) }
    : { kind: 'more', slot: capacity - 1, to: p + 1, count: total - (start + shown.length) }
  return { page: p, pageCount: count, slotCount: capacity, entries: shown.map((option, slot) => ({ option, slot })), nav }
}

/** Page an option is on (-1 when it is not offered). */
export function pageOfOption(options: readonly ConversionOption[], id: OptionId, capacity: number = RING_CAPACITY): number {
  const i = options.findIndex((o) => o.id === id)
  if (i < 0) return -1
  return options.length <= capacity ? 0 : Math.floor(i / (capacity - 1))
}

/** Slot of a target on this page (-1 when it is not shown). */
export function slotOf(page: RingPage, target: RingTarget | null | undefined): number {
  if (!target) return -1
  if (isNav(target)) return page.nav ? page.nav.slot : -1
  return page.entries.find((e) => e.option.id === target)?.slot ?? -1
}

/** Target shown in a slot (null for an empty slot). */
export function targetInSlot(page: RingPage, slot: number): RingTarget | null {
  if (page.nav && page.nav.slot === slot) return NAV_ID
  return page.entries.find((e) => e.slot === slot)?.option.id ?? null
}

/** Every slot of this page's layout (shown or empty), `index` = slot index. */
export function pageLayout(page: RingPage, radius: number): RingSlot[] {
  if (page.guess) {
    const a = (GUESS_ANGLE * Math.PI) / 180
    return [{ index: 0, angle: GUESS_ANGLE, x: Math.round(Math.cos(a) * radius * 100) / 100, y: Math.round(Math.sin(a) * radius * 100) / 100 }]
  }
  return ringLayout(page.slotCount, radius)
}

/** Positions of the bubbles shown on this page (options, then More / Back), `index` = slot index. */
export function visibleSlots(page: RingPage, radius: number): RingSlot[] {
  const all = pageLayout(page, radius)
  const out = page.entries.map((e) => all[e.slot]!)
  if (page.nav) out.push(all[page.nav.slot]!)
  return out
}

/** Centre of a shown target, relative to the ring centre (null when it is not on this page). */
export function targetCenter(page: RingPage, target: RingTarget | null | undefined, radius: number): Point | null {
  const slot = slotOf(page, target)
  if (slot < 0) return null
  const s = pageLayout(page, radius)[slot]
  return s ? { x: s.x, y: s.y } : null
}

export interface RingHitInput {
  /** Point relative to the ring centre, in the ring's (unscaled) px. */
  p: Point
  page: RingPage
  radius: number
  hitRadius: number
  mouthRadius: number
  hovered: RingTarget | null
  hysteresis?: number
}

/** What a drag point is over on this page: an option, the More / Back bubble, the mouth, or nothing. */
export function ringTargetAt(i: RingHitInput): RingTarget | 'mouth' | null {
  const slots = visibleSlots(i.page, i.radius)
  const hoveredSlot = slotOf(i.page, i.hovered)
  const hit = hitTest({
    p: i.p,
    slots,
    hitRadius: i.hitRadius,
    hoveredIndex: hoveredSlot >= 0 ? hoveredSlot : null,
    hysteresis: i.hysteresis ?? 12,
    mouthRadius: i.mouthRadius
  })
  if (hit.kind === 'option') return targetInSlot(i.page, hit.index)
  if (hit.kind === 'mouth') return 'mouth'
  return null
}
