// Tiny critically-damped spring utilities (no dependencies).
// We use the closed-form solution of x'' = -ω²(x - target) - 2ω x' so a step is exact for any dt:
// no overshoot, no jitter, frame-rate independent and unconditionally stable.

export interface SpringState {
  x: number
  v: number
}

export function spring(x = 0, v = 0): SpringState {
  return { x, v }
}

/**
 * Advance a critically-damped spring towards `target` by `dt` seconds (mutates and returns `s`).
 * @param omega angular frequency (1/s). Higher = snappier. ~8 feels smooth, ~25 feels instant.
 */
export function springStep(s: SpringState, target: number, omega: number, dt: number): SpringState {
  if (!(dt > 0) || !(omega > 0)) return s
  const d = s.x - target
  const a = s.v + omega * d
  const e = Math.exp(-omega * dt)
  s.x = target + (d + a * dt) * e
  s.v = (s.v - omega * a * dt) * e
  // Snap when settled to avoid denormals and endless sub-pixel updates.
  if (Math.abs(s.x - target) < 1e-5 && Math.abs(s.v) < 1e-4) {
    s.x = target
    s.v = 0
  }
  return s
}

/** Classic exponential smoothing that is frame-rate independent (`rate` per second). */
export function damp(current: number, target: number, rate: number, dt: number): number {
  if (!(dt > 0)) return current
  return target + (current - target) * Math.exp(-rate * dt)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}
