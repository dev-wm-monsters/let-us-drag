// Pure mask / matte helpers for Remove BG post-processing (D27). No I/O, no dependencies:
// everything works on typed arrays so it is cheap, deterministic and unit-testable.
//
// Conventions: images are row-major, `w`×`h`; alpha/mask planes are Float32Array in 0..1;
// colour images are interleaved RGB Float32Array in 0..1 (length w·h·3).

/**
 * Box mean with radius `r` (window (2r+1)²), clamped at the borders: each output is the mean of the
 * pixels of the window that lie inside the image. Separable running sums: O(w·h), independent of r.
 */
export function boxMean(src: Float32Array, w: number, h: number, r: number, out = new Float32Array(w * h)): Float32Array {
  if (src.length !== w * h) throw new Error(`boxMean: expected ${w * h} values, got ${src.length}`)
  const tmp = new Float32Array(w * h)
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    const first = Math.min(r, w - 1)
    for (let x = 0; x <= first; x++) sum += src[row + x]!
    for (let x = 0; x < w; x++) {
      const lo = Math.max(0, x - r)
      const hi = Math.min(w - 1, x + r)
      tmp[row + x] = sum / (hi - lo + 1)
      const add = x + r + 1
      if (add < w) sum += src[row + add]!
      const sub = x - r
      if (sub >= 0) sum -= src[row + sub]!
    }
  }
  // vertical (row-major running column sums: cache friendly)
  const col = new Float64Array(w)
  const firstRows = Math.min(r, h - 1)
  for (let y = 0; y <= firstRows; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) col[x]! += tmp[row + x]!
  }
  for (let y = 0; y < h; y++) {
    const lo = Math.max(0, y - r)
    const hi = Math.min(h - 1, y + r)
    const inv = 1 / (hi - lo + 1)
    const row = y * w
    for (let x = 0; x < w; x++) out[row + x] = col[x]! * inv
    const add = y + r + 1
    if (add < h) {
      const ar = add * w
      for (let x = 0; x < w; x++) col[x]! += tmp[ar + x]!
    }
    const sub = y - r
    if (sub >= 0) {
      const sr = sub * w
      for (let x = 0; x < w; x++) col[x]! -= tmp[sr + x]!
    }
  }
  return out
}

/**
 * Alpha levels: values ≤ lo become 0, ≥ hi become 1, linear ramp in between (in place).
 * Removes faint "ghost" background and makes the subject truly opaque without hard jaggies.
 */
export function alphaLevels(alpha: Float32Array, lo: number, hi: number): Float32Array {
  if (!(hi > lo)) throw new Error('alphaLevels: hi must be greater than lo')
  const k = 1 / (hi - lo)
  for (let i = 0; i < alpha.length; i++) {
    const t = (alpha[i]! - lo) * k
    alpha[i] = t <= 0 ? 0 : t >= 1 ? 1 : t
  }
  return alpha
}

/**
 * Label 8-connected components of `inside[i] === 1`. Returns per-pixel labels (0 = outside, 1..n)
 * and the component count. Iterative flood fill with an explicit stack (no recursion).
 */
export function labelComponents(inside: Uint8Array, w: number, h: number): { labels: Int32Array; count: number } {
  const labels = new Int32Array(w * h)
  const stack = new Int32Array(w * h)
  let count = 0
  for (let start = 0; start < w * h; start++) {
    if (inside[start] !== 1 || labels[start] !== 0) continue
    count++
    let sp = 0
    stack[sp++] = start
    labels[start] = count
    while (sp > 0) {
      const i = stack[--sp]!
      const x = i % w
      const y = (i - x) / w
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const j = ny * w + nx
          if (inside[j] === 1 && labels[j] === 0) {
            labels[j] = count
            stack[sp++] = j
          }
        }
      }
    }
  }
  return { labels, count }
}

export interface IslandOptions {
  /** A pixel belongs to a component when alpha > threshold. */
  threshold: number
  /** Components whose alpha mass is below this fraction of the largest component's mass are removed. */
  minFraction: number
}

/**
 * Remove small disconnected blobs (in place). Components are found on alpha > threshold and weighed
 * by their alpha mass, so several real subjects of similar size all survive. Run it on the soft
 * model mask with a low threshold (before levels): faint thin parts still attached to the subject,
 * like a lattice beam, then stay connected and survive. Returns how many components were removed.
 */
export function removeSmallIslands(alpha: Float32Array, w: number, h: number, opts: IslandOptions): number {
  if (alpha.length !== w * h) throw new Error('removeSmallIslands: size mismatch')
  const inside = new Uint8Array(w * h)
  for (let i = 0; i < inside.length; i++) inside[i] = alpha[i]! > opts.threshold ? 1 : 0
  const { labels, count } = labelComponents(inside, w, h)
  if (count <= 1) return 0
  const mass = new Float64Array(count + 1)
  for (let i = 0; i < labels.length; i++) mass[labels[i]!]! += labels[i]! ? alpha[i]! : 0
  let largest = 0
  for (let c = 1; c <= count; c++) if (mass[c]! > largest) largest = mass[c]!
  const drop = new Uint8Array(count + 1)
  let removed = 0
  for (let c = 1; c <= count; c++) {
    if (mass[c]! > 0 && mass[c]! < largest * opts.minFraction) {
      drop[c] = 1
      removed++
    }
  }
  if (!removed) return 0
  for (let i = 0; i < labels.length; i++) if (drop[labels[i]!]) alpha[i] = 0
  return removed
}

/**
 * Bilinear sample position of output pixel `o` (of `outSize`) in a map of `inSize` pixels
 * (pixel-centre aligned, clamped). Returns [i0, i1, frac].
 */
function sampleAxis(outSize: number, inSize: number): { i0: Int32Array; i1: Int32Array; f: Float32Array } {
  const i0 = new Int32Array(outSize)
  const i1 = new Int32Array(outSize)
  const f = new Float32Array(outSize)
  const scale = inSize / outSize
  for (let o = 0; o < outSize; o++) {
    let s = (o + 0.5) * scale - 0.5
    if (s < 0) s = 0
    if (s > inSize - 1) s = inSize - 1
    const a = Math.floor(s)
    i0[o] = a
    i1[o] = Math.min(a + 1, inSize - 1)
    f[o] = s - a
  }
  return { i0, i1, f }
}

/** Smooth foreground / background colour estimates (planar-free, interleaved RGB 0..1). */
export interface BlurredColours {
  w: number
  h: number
  fg: Float32Array
  bg: Float32Array
}

function blurFusionPass(image: Float32Array, F: Float32Array, B: Float32Array, alpha: Float32Array, w: number, h: number, r: number): BlurredColours {
  const n = w * h
  const ba = boxMean(alpha, w, h, r)
  const plane = new Float32Array(n)
  const fg = new Float32Array(n * 3)
  const bg = new Float32Array(n * 3)
  const nextF = new Float32Array(n * 3)
  const blurred = new Float32Array(n)
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) plane[i] = F[i * 3 + c]! * alpha[i]!
    boxMean(plane, w, h, r, blurred)
    for (let i = 0; i < n; i++) fg[i * 3 + c] = blurred[i]! / (ba[i]! + 1e-5)
    for (let i = 0; i < n; i++) plane[i] = B[i * 3 + c]! * (1 - alpha[i]!)
    boxMean(plane, w, h, r, blurred)
    for (let i = 0; i < n; i++) bg[i * 3 + c] = blurred[i]! / (1 - ba[i]! + 1e-5)
  }
  for (let i = 0; i < n; i++) {
    const a = alpha[i]!
    for (let c = 0; c < 3; c++) {
      const j = i * 3 + c
      const f = fg[j]! + a * (image[j]! - a * fg[j]! - (1 - a) * bg[j]!)
      nextF[j] = f <= 0 ? 0 : f >= 1 ? 1 : f
    }
  }
  return { w, h, fg: nextF, bg }
}

/**
 * Approximate fast foreground colour estimation by blur fusion (Forte & Pitié, ICIP 2021): two
 * passes (large radius, then small). Returns the smooth foreground/background colour estimates of
 * the last pass; {@link decontaminate} combines them with the full-size image.
 */
export function blurFusionColours(image: Float32Array, alpha: Float32Array, w: number, h: number, r1: number, r2: number): BlurredColours {
  const first = blurFusionPass(image, image, image, alpha, w, h, r1)
  const ba = boxMean(alpha, w, h, r2)
  const n = w * h
  const plane = new Float32Array(n)
  const blurred = new Float32Array(n)
  const fg = new Float32Array(n * 3)
  const bg = new Float32Array(n * 3)
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) plane[i] = first.fg[i * 3 + c]! * alpha[i]!
    boxMean(plane, w, h, r2, blurred)
    for (let i = 0; i < n; i++) fg[i * 3 + c] = blurred[i]! / (ba[i]! + 1e-5)
    for (let i = 0; i < n; i++) plane[i] = first.bg[i * 3 + c]! * (1 - alpha[i]!)
    boxMean(plane, w, h, r2, blurred)
    for (let i = 0; i < n; i++) bg[i * 3 + c] = blurred[i]! / (1 - ba[i]! + 1e-5)
  }
  return { w, h, fg, bg }
}

/**
 * Colour decontamination at full size (in place on `rgb`, uint8 interleaved W×H): for every
 * semi-transparent pixel, F = F̄ + α(I − αF̄ − (1−α)B̄) with F̄/B̄ bilinearly sampled from `est`.
 * Opaque pixels are untouched (the formula gives I there anyway); fully transparent pixels get F̄.
 */
export function decontaminate(rgb: Uint8Array, alpha: Uint8Array, W: number, H: number, est: BlurredColours): void {
  if (rgb.length !== W * H * 3 || alpha.length !== W * H) throw new Error('decontaminate: size mismatch')
  const xs = sampleAxis(W, est.w)
  const ys = sampleAxis(H, est.h)
  for (let y = 0; y < H; y++) {
    const r0 = ys.i0[y]! * est.w
    const r1 = ys.i1[y]! * est.w
    const fy = ys.f[y]!
    for (let x = 0; x < W; x++) {
      const o = y * W + x
      const a8 = alpha[o]!
      if (a8 === 255) continue
      const a = a8 / 255
      const fx = xs.f[x]!
      const p00 = (r0 + xs.i0[x]!) * 3
      const p01 = (r0 + xs.i1[x]!) * 3
      const p10 = (r1 + xs.i0[x]!) * 3
      const p11 = (r1 + xs.i1[x]!) * 3
      const w00 = (1 - fx) * (1 - fy)
      const w01 = fx * (1 - fy)
      const w10 = (1 - fx) * fy
      const w11 = fx * fy
      for (let c = 0; c < 3; c++) {
        const fb = est.fg[p00 + c]! * w00 + est.fg[p01 + c]! * w01 + est.fg[p10 + c]! * w10 + est.fg[p11 + c]! * w11
        const bb = est.bg[p00 + c]! * w00 + est.bg[p01 + c]! * w01 + est.bg[p10 + c]! * w10 + est.bg[p11 + c]! * w11
        const f = fb + a * (rgb[o * 3 + c]! / 255 - a * fb - (1 - a) * bb)
        rgb[o * 3 + c] = f <= 0 ? 0 : f >= 1 ? 255 : Math.round(f * 255)
      }
    }
  }
}

/**
 * Tuned on real photos (D27). Radii are for a 1024-pixel long side and scale with the work size.
 * Tried and rejected: a colour guided filter (washed out thin lattice structures, no visible gain on
 * hair) and hole filling (filled the gaps of lattices and wheel spokes).
 */
export const REFINE = {
  /** Mask cleanup and colour estimation run at most at this long side; only the final apply is full size. */
  workMax: 1024,
  /** Alpha levels: raw ≤ 0.15 → transparent, ≥ 0.85 → opaque (the raw model output peaks at 254/255). */
  levelsLo: 0.15,
  levelsHi: 0.85,
  /** Islands are found on the raw mask > 0.05 and removed below 2 % of the largest one's mass. */
  islandSupport: 0.05,
  islandMinFraction: 0.02,
  /** Blur-fusion radii (Forte & Pitié use 90 and 6 at ~1 MP). */
  fgRadius1: 90,
  fgRadius2: 6
} as const

/** 256-entry lookup table for {@link alphaLevels} with the REFINE levels, on 0..255 values. */
export function levelsTable(lo: number = REFINE.levelsLo, hi: number = REFINE.levelsHi): Uint8Array {
  const v = new Float32Array(256)
  for (let i = 0; i < 256; i++) v[i] = i / 255
  alphaLevels(v, lo, hi)
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i++) lut[i] = Math.round(v[i]! * 255)
  return lut
}

/** Apply the levels to a 0..255 mask in place (used on the full-size, upscaled mask). */
export function applyLevels(mask: Uint8Array, lut: Uint8Array = levelsTable()): Uint8Array {
  for (let i = 0; i < mask.length; i++) mask[i] = lut[mask[i]!]!
  return mask
}

export interface RefinedMatte {
  /** The model mask (0..255) with small islands removed, before levels: upscale this, then {@link applyLevels}. */
  cleaned: Uint8Array
  /** Smooth foreground/background colours at the work size, for {@link decontaminate}. */
  colours: BlurredColours
  islandsRemoved: number
}

/**
 * Clean the model's mask at the work size (drop small islands) and estimate the foreground colours
 * for decontamination from the levelled alpha. `mask` (0..255) and `rgb` (interleaved 0..255) are
 * w×h. Levels are applied by the caller after upscaling, so lanczos ringing below the low level
 * disappears instead of leaving a faint halo.
 */
export function refineMatte(mask: Uint8Array, rgb: Uint8Array, w: number, h: number): RefinedMatte {
  const n = w * h
  if (mask.length !== n || rgb.length !== n * 3) throw new Error('refineMatte: size mismatch')
  const raw = new Float32Array(n)
  for (let i = 0; i < n; i++) raw[i] = mask[i]! / 255
  const islandsRemoved = removeSmallIslands(raw, w, h, { threshold: REFINE.islandSupport, minFraction: REFINE.islandMinFraction })
  const cleaned = new Uint8Array(n)
  for (let i = 0; i < n; i++) cleaned[i] = raw[i] === 0 ? 0 : mask[i]!
  const alpha = alphaLevels(raw, REFINE.levelsLo, REFINE.levelsHi)
  const image = new Float32Array(n * 3)
  for (let i = 0; i < image.length; i++) image[i] = rgb[i]! / 255
  const unit = Math.max(w, h) / 1024
  const r1 = Math.max(1, Math.round(REFINE.fgRadius1 * unit))
  const r2 = Math.max(1, Math.round(REFINE.fgRadius2 * unit))
  return { cleaned, colours: blurFusionColours(image, alpha, w, h, r1, r2), islandsRemoved }
}

/** Work size for an image: the long side capped at REFINE.workMax, aspect kept. */
export function workSize(width: number, height: number, max: number = REFINE.workMax): { w: number; h: number } {
  const s = Math.min(1, max / Math.max(width, height))
  return { w: Math.max(1, Math.round(width * s)), h: Math.max(1, Math.round(height * s)) }
}
