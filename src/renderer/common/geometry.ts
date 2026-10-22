// Pure geometry for the options ring, hit-testing and eye tracking.

export interface Point {
  x: number
  y: number
}

export interface RingSlot {
  index: number
  /** Angle in degrees (0 = right, -90 = up). */
  angle: number
  /** Offset from the ring centre in CSS px. */
  x: number
  y: number
}

/** Angular step between bubbles (deg) used for small rings; large rings use the full circle. */
const ARC_STEP_DEG = 50

/**
 * Lay out `count` bubbles around a centre. Few options sit on an arc over the Uncle's head
 * (never hidden behind his body); 8 options use the full circle. Starts at the top (-90°).
 */
export function ringLayout(count: number, radius: number): RingSlot[] {
  if (count <= 0) return []
  if (count === 1) return [{ index: 0, angle: -90, x: 0, y: -radius }]
  const full = (360 * (count - 1)) / count
  const arc = (count - 1) * ARC_STEP_DEG
  // Full circle: first bubble just left of the top, clockwise. Arc: centred on the top.
  const span = Math.min(full, arc)
  const step = span / (count - 1)
  const start = arc >= full ? -90 - 180 / count : -90 - span / 2
  return Array.from({ length: count }, (_, index) => {
    const angle = start + step * index
    const rad = (angle * Math.PI) / 180
    return { index, angle, x: round2(Math.cos(rad) * radius), y: round2(Math.sin(rad) * radius) }
  })
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export type HitTarget = { kind: 'option'; index: number } | { kind: 'mouth' } | { kind: 'none' }

export interface HitTestInput {
  /** Point relative to the ring centre. */
  p: Point
  slots: readonly RingSlot[]
  /** Hit radius of a bubble (>= 32 so the area is >= 64 px). */
  hitRadius: number
  /** Currently hovered index (gets a bonus radius = hysteresis, prevents flicker at edges). */
  hoveredIndex: number | null
  hysteresis: number
  /** Radius of the central "mouth" target. */
  mouthRadius: number
}

export function hitTest(i: HitTestInput): HitTarget {
  let best: { index: number; d: number } | null = null
  for (const s of i.slots) {
    const d = Math.hypot(i.p.x - s.x, i.p.y - s.y)
    const r = i.hitRadius + (s.index === i.hoveredIndex ? i.hysteresis : 0)
    if (d <= r && (!best || d < best.d)) best = { index: s.index, d }
  }
  if (best) return { kind: 'option', index: best.index }
  if (Math.hypot(i.p.x, i.p.y) <= i.mouthRadius) return { kind: 'mouth' }
  return { kind: 'none' }
}

/** Smoothly saturating normalisation: maps (-inf, inf) to (-1, 1), ~linear near 0. */
export function softNorm(d: number, k: number): number {
  return d / Math.sqrt(d * d + k * k)
}

/**
 * Pupil offset for an eye at `eye` looking at `target` (same coordinate space).
 * Direction is exact; magnitude saturates smoothly to `maxR` (pupil stays inside the eye).
 */
export function pupilOffset(eye: Point, target: Point, maxR: number, falloff = 40): Point {
  const dx = target.x - eye.x
  const dy = target.y - eye.y
  const dist = Math.hypot(dx, dy)
  if (dist < 1e-6 || maxR <= 0) return { x: 0, y: 0 }
  const mag = maxR * (1 - Math.exp(-dist / falloff))
  return { x: (dx / dist) * mag, y: (dy / dist) * mag }
}

/** Clamp a vector to a circle of radius r. */
export function clampToCircle(p: Point, r: number): Point {
  const d = Math.hypot(p.x, p.y)
  if (d <= r || d === 0) return p
  return { x: (p.x / d) * r, y: (p.y / d) * r }
}

/** Axis-aligned box (top-left + size), relative to the ring centre. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type HintSide = 'below' | 'above' | 'inner' | 'outer'

export interface HintPlacementInput {
  /** Centre of the hovered bubble. */
  slot: Point
  /** Centres of the other bubbles (must stay uncovered). */
  others: readonly Point[]
  /** Visual radius of the hovered (scaled) bubble. */
  bubbleRadius: number
  /** Visual radius of the other bubbles (incl. their shadow). */
  otherRadius: number
  /** Measured size of the hint pill. */
  size: { w: number; h: number }
  /** Area the hint must stay inside (the window minus a margin), relative to the ring centre. */
  bounds: Box
  /** Space between the hovered bubble and the hint. */
  gap: number
}

export interface HintPlacement extends Box {
  side: HintSide
  /** 0 when the hint covers no other bubble (and not the hovered one either). */
  overlap: number
}

/** How far a circle reaches into a box (0 when they do not touch). */
function circleIntoBox(c: Point, r: number, b: Box): number {
  const nx = Math.max(b.x, Math.min(c.x, b.x + b.w))
  const ny = Math.max(b.y, Math.min(c.y, b.y + b.h))
  return Math.max(0, r - Math.hypot(c.x - nx, c.y - ny))
}

/**
 * Place an option hint pill next to its bubble so it stays inside the window and covers no other
 * bubble (QA3-03): try below, above, the inner side (towards the Uncle) and the outer side, clamp
 * each into the bounds and keep the first one that covers nothing (else the least overlapping).
 */
export function placeHint(i: HintPlacementInput): HintPlacement {
  const { slot, size, bounds, gap } = i
  const r = i.bubbleRadius + gap
  const innerIsRight = slot.x <= 0
  const raw: Record<HintSide, Point> = {
    below: { x: slot.x - size.w / 2, y: slot.y + r },
    above: { x: slot.x - size.w / 2, y: slot.y - r - size.h },
    inner: { x: innerIsRight ? slot.x + r : slot.x - r - size.w, y: slot.y - size.h / 2 },
    outer: { x: innerIsRight ? slot.x - r - size.w : slot.x + r, y: slot.y - size.h / 2 }
  }
  let best: HintPlacement | null = null
  for (const side of ['below', 'above', 'inner', 'outer'] as const) {
    const p = raw[side]
    const box: Box = {
      x: clamp(p.x, bounds.x, Math.max(bounds.x, bounds.x + bounds.w - size.w)),
      y: clamp(p.y, bounds.y, Math.max(bounds.y, bounds.y + bounds.h - size.h)),
      w: size.w,
      h: size.h
    }
    let overlap = circleIntoBox(slot, i.bubbleRadius, box)
    for (const o of i.others) overlap += circleIntoBox(o, i.otherRadius, box)
    const placed: HintPlacement = { ...box, side, overlap: Math.round(overlap * 100) / 100 }
    if (placed.overlap === 0) return placed
    if (!best || placed.overlap < best.overlap) best = placed
  }
  return best!
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
