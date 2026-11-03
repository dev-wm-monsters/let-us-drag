// Remove BG post-processing helpers (D27): pure typed-array operations.
import { describe, expect, it } from 'vitest'
import {
  REFINE,
  alphaLevels,
  applyLevels,
  blurFusionColours,
  boxMean,
  decontaminate,
  labelComponents,
  levelsTable,
  refineMatte,
  removeSmallIslands,
  workSize
} from '../../src/engine/tools/mask-refine'

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function disc(alpha: Float32Array, w: number, cx: number, cy: number, r: number, v = 1): void {
  const h = alpha.length / w
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) alpha[y * w + x] = v
}

describe('boxMean', () => {
  it('matches a brute-force clamped window mean', () => {
    const w = 13
    const h = 9
    const r = 2
    const rand = rng(1)
    const src = new Float32Array(w * h).map(() => rand())
    const got = boxMean(src, w, h, r)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0
        let n = 0
        for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
          for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
            sum += src[yy * w + xx]!
            n++
          }
        }
        expect(got[y * w + x]).toBeCloseTo(sum / n, 5)
      }
    }
  })

  it('keeps a constant image constant, also with a radius larger than the image', () => {
    const src = new Float32Array(5 * 4).fill(0.25)
    for (const v of boxMean(src, 5, 4, 10)) expect(v).toBeCloseTo(0.25, 6)
  })

  it('rejects a wrong size', () => {
    expect(() => boxMean(new Float32Array(3), 2, 2, 1)).toThrow()
  })
})

describe('alpha levels', () => {
  it('clips below lo and above hi with a linear ramp between', () => {
    const a = alphaLevels(new Float32Array([0, 0.1, 0.15, 0.5, 0.85, 0.9, 1]), 0.15, 0.85)
    expect(Array.from(a.slice(0, 2))).toEqual([0, 0])
    expect(a[2]).toBeCloseTo(0, 6) // float32(0.15) is not exactly 0.15
    expect(a[3]).toBeCloseTo(0.5, 6)
    expect(a[4]).toBeCloseTo(1, 6)
    expect(Array.from(a.slice(5))).toEqual([1, 1])
  })

  it('the uint8 table: faint ghosting → 0, the model’s 254 → fully opaque, monotonic', () => {
    const lut = levelsTable()
    expect(lut[0]).toBe(0)
    expect(lut[Math.floor(REFINE.levelsLo * 255)]).toBe(0)
    expect(lut[128]).toBeGreaterThan(100)
    expect(lut[128]).toBeLessThan(155)
    expect(lut[230]).toBe(255)
    expect(lut[254]).toBe(255)
    for (let i = 1; i < 256; i++) expect(lut[i]!).toBeGreaterThanOrEqual(lut[i - 1]!)
    expect(Array.from(applyLevels(new Uint8Array([0, 20, 254])))).toEqual([0, 0, 255])
  })

  it('rejects an empty range', () => {
    expect(() => alphaLevels(new Float32Array(1), 0.5, 0.5)).toThrow()
  })
})

describe('connected components and islands', () => {
  it('labels 8-connected components (diagonal neighbours join)', () => {
    // 1 0 0 1
    // 0 1 0 1
    // 0 0 0 0
    const inside = new Uint8Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0])
    const { labels, count } = labelComponents(inside, 4, 3)
    expect(count).toBe(2)
    expect(labels[0]).toBe(labels[5])
    expect(labels[3]).toBe(labels[7])
    expect(labels[0]).not.toBe(labels[3])
    expect(labels[2]).toBe(0)
  })

  it('removes a small stray blob but keeps the subject', () => {
    const w = 64
    const alpha = new Float32Array(w * w)
    disc(alpha, w, 24, 24, 14)
    disc(alpha, w, 56, 56, 1.5, 0.6)
    const removed = removeSmallIslands(alpha, w, w, { threshold: 0.05, minFraction: 0.02 })
    expect(removed).toBe(1)
    expect(alpha[56 * w + 56]).toBe(0)
    expect(alpha[24 * w + 24]).toBe(1)
  })

  it('keeps several subjects of similar size (multi-subject photos)', () => {
    const w = 80
    const alpha = new Float32Array(w * 40)
    disc(alpha, w, 18, 20, 12)
    disc(alpha, w, 60, 20, 10)
    expect(removeSmallIslands(alpha, w, 40, { threshold: 0.05, minFraction: 0.02 })).toBe(0)
    expect(alpha[20 * w + 60]).toBe(1)
  })

  it('a faint thin part attached to the subject is not an island', () => {
    const w = 60
    const alpha = new Float32Array(w * 20)
    disc(alpha, w, 10, 10, 8)
    for (let x = 18; x < 58; x++) alpha[10 * w + x] = 0.3 // thin, faint, but connected
    expect(removeSmallIslands(alpha, w, 20, { threshold: 0.05, minFraction: 0.02 })).toBe(0)
    expect(alpha[10 * w + 50]).toBeCloseTo(0.3, 6)
  })
})

describe('colour decontamination (blur fusion)', () => {
  it('pulls the background colour out of semi-transparent edge pixels', () => {
    // red subject on the left, blue background on the right, a 4-px band at alpha 0.5 mixing both
    const w = 64
    const h = 16
    const n = w * h
    const alpha8 = new Uint8Array(n)
    const rgb8 = new Uint8Array(n * 3)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const a = x < 30 ? 1 : x < 34 ? 0.5 : 0
        alpha8[i] = Math.round(a * 255)
        rgb8.set([Math.round(220 * a), 0, Math.round(220 * (1 - a))], i * 3)
      }
    }
    const image = Float32Array.from(rgb8, (v) => v / 255)
    const alpha = Float32Array.from(alpha8, (v) => v / 255)
    const est = blurFusionColours(image, alpha, w, h, 16, 2)
    const out = new Uint8Array(rgb8)
    decontaminate(out, alpha8, w, h, est)
    const band = (8 * w + 31) * 3
    expect(rgb8[band + 2]).toBeGreaterThan(100) // before: half blue
    expect(out[band]).toBeGreaterThan(190) // red recovered
    expect(out[band + 2]).toBeLessThan(30) // blue fringe gone
    // opaque pixels are untouched
    expect(Array.from(out.slice((8 * w + 5) * 3, (8 * w + 5) * 3 + 3))).toEqual([220, 0, 0])
  })

  it('rejects mismatched sizes', () => {
    const est = blurFusionColours(new Float32Array(12), new Float32Array(4), 2, 2, 1, 1)
    expect(() => decontaminate(new Uint8Array(5), new Uint8Array(4), 2, 2, est)).toThrow()
  })
})

describe('refineMatte / workSize', () => {
  function scene(w: number, h: number): { mask: Uint8Array; rgb: Uint8Array } {
    const a = new Float32Array(w * h)
    disc(a, w, w / 2, h / 2, h / 3)
    disc(a, w, w - 4, 4, 1.2, 0.5) // stray speck
    const mask = Uint8Array.from(a, (v) => Math.floor(v * 254))
    const rgb = new Uint8Array(w * h * 3)
    for (let i = 0; i < w * h; i++) rgb.set(a[i]! > 0 ? [240, 190, 30] : [30, 40, 50], i * 3)
    return { mask, rgb }
  }

  it('drops the stray speck, keeps the subject, is deterministic', () => {
    const { mask, rgb } = scene(96, 64)
    const a = refineMatte(mask, rgb, 96, 64)
    const b = refineMatte(mask, rgb, 96, 64)
    expect(a.islandsRemoved).toBe(1)
    expect(a.cleaned[4 * 96 + 92]).toBe(0)
    expect(a.cleaned[32 * 96 + 48]).toBe(254)
    expect(Buffer.from(a.cleaned).equals(Buffer.from(b.cleaned))).toBe(true)
    expect(Buffer.from(a.colours.fg.buffer).equals(Buffer.from(b.colours.fg.buffer))).toBe(true)
  })

  it('rejects mismatched buffers', () => {
    expect(() => refineMatte(new Uint8Array(10), new Uint8Array(30), 4, 4)).toThrow()
  })

  it('caps the long side at REFINE.workMax and keeps small images as they are', () => {
    expect(workSize(4000, 3000)).toEqual({ w: 1024, h: 768 })
    expect(workSize(3000, 4000)).toEqual({ w: 768, h: 1024 })
    expect(workSize(640, 427)).toEqual({ w: 640, h: 427 })
    expect(workSize(100000, 10)).toEqual({ w: 1024, h: 1 })
  })
})
