// Ring/Uncle sizing for the overlay and the Feed Window (pure, unit tested).
import type { RingGeometry } from './useUncleSession'

const BASE_RADIUS = 190
const BASE_HIT = 46

/** Overlay: ring radius ~190 px when the window is large enough, never below 120. */
export function overlayRing(w: number, h: number): RingGeometry {
  const radius = Math.max(120, Math.min(BASE_RADIUS, Math.min(w, h) / 2 - 58))
  return { radius, hitRadius: BASE_HIT, mouthRadius: Math.round(radius * 0.52), scale: 1 }
}

/** Room a Feed Window bubble needs around its slot: the 92 px button / hovered bubble + its shadow. */
const FEED_EDGE = 54
const FEED_MIN_RADIUS = 108

/**
 * Feed Window: a slightly tighter ring that fits small windows. Below the smallest ring (a drop zone
 * under 324 px, e.g. the window's minimum size) the whole stage is scaled down so every bubble
 * stays inside the zone (B-064).
 */
export function feedRing(w: number, h: number): RingGeometry {
  const half = Math.min(w, h) / 2
  const radius = Math.max(FEED_MIN_RADIUS, Math.min(BASE_RADIUS, half - FEED_EDGE))
  const scale = Math.max(0.3, Math.min(1, Math.floor((half / (radius + FEED_EDGE)) * 1000) / 1000))
  return { radius, hitRadius: 42, mouthRadius: Math.round(radius * 0.52), scale }
}

/** Uncle width for a ring radius (reads well at 220–260 px in the overlay). */
export function uncleWidthFor(radius: number, max: number): number {
  return Math.round(Math.min(max, radius * 1.3))
}

/**
 * The drag overlay draws the character this much smaller than the Feed Window does (product: it read
 * too big on a real Mac, twice: 0.85, then 0.7). The ring radius is unchanged, so the bubbles get more room.
 */
export const OVERLAY_CHARACTER_SCALE = 0.7

/** Character width in the drag overlay for a ring radius. */
export function overlayCharacterWidth(radius: number): number {
  return Math.round(uncleWidthFor(radius, 250) * OVERLAY_CHARACTER_SCALE)
}
