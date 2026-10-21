// Procedural SVG paths for the Uncle (pure; unit tested for finiteness).
// Coordinate system: viewBox units, origin = centre of the face; y grows downwards.
import type { Point } from '../geometry'

const f = (n: number): string => (Math.round(n * 10) / 10).toString()
const P = (x: number, y: number): string => `${f(x)},${f(y)}`

/** Max chin drop (viewBox units) at jaw = 1. */
export const JAW_DROP = 30
/** Where the mouth's top edge sits (under the moustache). */
export const MOUTH_TOP = 57

/** Head silhouette. The chin drops with the jaw, the jowls widen with `puff` (chewing cheeks). */
export function headPath(jaw: number, puff = 0): string {
  const J = jaw * JAW_DROP
  const w = 112 + puff * 16
  const jw = 92 + puff * 26
  const jy = 90 + J * 0.7 - puff * 4
  return [
    `M ${P(0, -126)}`,
    `C ${P(66, -127)} ${P(112, -88)} ${P(112, -24)}`,
    `C ${P(w + 1, 22)} ${P(w - 2, 60 + J * 0.4)} ${P(jw, jy)}`,
    `C ${P(72 + puff * 8, 116 + J)} ${P(38, 123 + J)} ${P(0, 123 + J)}`,
    `C ${P(-40, 123 + J)} ${P(-74 - puff * 8, 115 + J)} ${P(-jw - 1, jy - 1)}`,
    `C ${P(-w + 1, 61 + J * 0.4)} ${P(-w - 2, 20)} ${P(-113, -24)}`,
    `C ${P(-111, -88)} ${P(-64, -127)} ${P(0, -126)}`,
    'Z'
  ].join(' ')
}

export interface MouthShape {
  /** Half width. */
  w: number
  top: number
  /** Corner height. */
  corner: number
  /** Lowest point of the mouth opening. */
  bottom: number
}

/** Mouth geometry from openness (0..1) and smile (-1 frown .. 1 grin). */
export function mouthShape(open: number, smile: number): MouthShape {
  const o = Math.max(0, Math.min(1.15, open))
  const s = Math.max(-1, Math.min(1, smile))
  const w = 30 + o * 24 + Math.max(0, s) * 10
  const top = MOUTH_TOP - o * 5
  const corner = top + 3 - s * 9 + o * 4
  const depth = 4 + o * 64 + Math.max(0, s) * 8 * (1 - o)
  return { w, top, corner, bottom: top + depth }
}

export function mouthPath(open: number, smile: number): string {
  const m = mouthShape(open, smile)
  const midTop = m.top - 2 + Math.min(0, smile) * -4
  return [
    `M ${P(-m.w, m.corner)}`,
    `Q ${P(0, midTop)} ${P(m.w, m.corner)}`,
    `C ${P(m.w + 2, m.corner + (m.bottom - m.corner) * 0.75)} ${P(m.w * 0.55, m.bottom)} ${P(0, m.bottom)}`,
    `C ${P(-m.w * 0.55, m.bottom)} ${P(-m.w - 2, m.corner + (m.bottom - m.corner) * 0.75)} ${P(-m.w, m.corner)}`,
    'Z'
  ].join(' ')
}

/** Rubber-hose arm from shoulder to wrist with an elbow bend (sign = bend direction). */
export function armPath(s: Point, w: Point, bend: number): string {
  const mx = (s.x + w.x) / 2
  const my = (s.y + w.y) / 2
  const dx = w.x - s.x
  const dy = w.y - s.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const k = bend * Math.max(10, 70 - len * 0.35)
  return `M ${P(s.x, s.y)} Q ${P(mx + nx * k, my + ny * k)} ${P(w.x, w.y)}`
}

/** An upper eyelid that covers the eye from the top; closed = 0..1. */
export function lidPath(cx: number, cy: number, rx: number, ry: number, closed: number): string {
  const c = Math.max(0, Math.min(1, closed))
  const top = cy - ry - 6
  const edge = cy - ry + c * (2 * ry + 2)
  const sag = 4 + c * 3
  return [
    `M ${P(cx - rx - 6, top)}`,
    `L ${P(cx + rx + 6, top)}`,
    `L ${P(cx + rx + 6, edge - 2)}`,
    `Q ${P(cx, edge + sag)} ${P(cx - rx - 6, edge - 2)}`,
    'Z'
  ].join(' ')
}

/** Lid edge line (drawn in ink, follows the lid). */
export function lidLinePath(cx: number, cy: number, rx: number, ry: number, closed: number): string {
  const c = Math.max(0, Math.min(1, closed))
  const edge = cy - ry + c * (2 * ry + 2)
  const sag = 4 + c * 3
  return `M ${P(cx - rx - 1, edge - 1)} Q ${P(cx, edge + sag)} ${P(cx + rx + 1, edge - 1)}`
}
