// Pure geometry helpers for the overlay window (all values in DIP / CSS pixels).

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Preferred overlay size (square), CSS px. */
export const OVERLAY_SIZE = 560

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/**
 * Bounds of the overlay centred on the cursor and clamped to the work area of the display that
 * contains the cursor. If the work area is smaller than the overlay, the overlay shrinks to fit.
 */
export function overlayBounds(cursor: Point, workArea: Rect, size: number = OVERLAY_SIZE): Rect {
  const width = Math.max(1, Math.min(size, Math.floor(workArea.width)))
  const height = Math.max(1, Math.min(size, Math.floor(workArea.height)))
  const x = clamp(Math.round(cursor.x - width / 2), workArea.x, workArea.x + workArea.width - width)
  const y = clamp(Math.round(cursor.y - height / 2), workArea.y, workArea.y + workArea.height - height)
  return { x, y, width, height }
}

/** Screen point → window-relative point (what the renderer receives on the cursor channel). */
export function toWindowPoint(screen: Point, bounds: Rect): Point {
  return { x: screen.x - bounds.x, y: screen.y - bounds.y }
}

export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

export function samePoint(a: Point | null, b: Point): boolean {
  return a !== null && a.x === b.x && a.y === b.y
}

export function rectCenter(r: Rect): Point {
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
}
