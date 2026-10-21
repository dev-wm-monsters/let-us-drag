// Ring/Uncle sizing for the overlay and the Feed Window (pure, unit tested).
import type { RingGeometry } from './useUncleSession'

const BASE_RADIUS = 190
const BASE_HIT = 46

/** Overlay: ring radius ~190 px when the window is large enough, never below 120. */
export function overlayRing(w: number, h: number): RingGeometry {
  const radius = Math.max(120, Math.min(BASE_RADIUS, Math.min(w, h) / 2 - 58))
  return { radius, hitRadius: BASE_HIT, mouthRadius: Math.round(radius * 0.52) }
}

/** Feed Window: a slightly tighter ring that fits small windows. */
export function feedRing(w: number, h: number): RingGeometry {
  const radius = Math.max(108, Math.min(BASE_RADIUS, Math.min(w, h) / 2 - 54))
  return { radius, hitRadius: 42, mouthRadius: Math.round(radius * 0.52) }
}

/** Uncle width for a ring radius (reads well at 220–260 px in the overlay). */
export function uncleWidthFor(radius: number, max: number): number {
  return Math.round(Math.min(max, radius * 1.3))
}
