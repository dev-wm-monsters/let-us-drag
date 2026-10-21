// Remove-BG: pre/post-processing math (unit), the full pipeline with a tiny stand-in ONNX model
// on both runtimes, and — only when env LUD_MODEL_PATH points at the real isnet-general-use.onnx —
// an integration test with the real model.
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MODEL_INPUT_SIZE, chooseOrtBackend, openModelSessions, postprocess, predictMask, preprocess } from '../../src/engine/tools/removebg'
import { MAGIC, makeTempDir, startsWith, tinyOnnxModel } from '../helpers/fixtures'
import { convertOk } from '../helpers/engine'

let dir = ''
let cleanup: () => Promise<void> = async () => undefined
let tinyModel = ''

beforeAll(async () => {
  ;({ dir, cleanup } = await makeTempDir('lud-rmbg-'))
  tinyModel = join(dir, 'tiny.onnx')
  await writeFile(tinyModel, tinyOnnxModel())
})
afterAll(() => cleanup())

describe('pre/post-processing (matches rembg DisSession)', () => {
  it('divides by the max pixel, subtracts 0.5, NCHW planes', () => {
    // 2×2 image, RGB: pixel values chosen so max = 200
    const rgb = Uint8Array.from([200, 100, 0, 50, 50, 50, 0, 0, 0, 100, 200, 150])
    const t = preprocess(rgb, 2)
    expect(t).toHaveLength(12)
    const n = 4
    // R plane
    expect(t[0]).toBeCloseTo(200 / 200 - 0.5)
    expect(t[1]).toBeCloseTo(50 / 200 - 0.5)
    expect(t[3]).toBeCloseTo(100 / 200 - 0.5)
    // G plane
    expect(t[n + 0]).toBeCloseTo(100 / 200 - 0.5)
    expect(t[n + 3]).toBeCloseTo(200 / 200 - 0.5)
    // B plane
    expect(t[2 * n + 3]).toBeCloseTo(150 / 200 - 0.5)
  })

  it('handles an all-black image without dividing by zero', () => {
    const t = preprocess(new Uint8Array(12), 2)
    expect(Array.from(t).every((v) => v === -0.5)).toBe(true)
  })

  it('rejects wrong buffer sizes', () => {
    expect(() => preprocess(new Uint8Array(5), 2)).toThrow()
  })

  it('min-max normalises the prediction to 0..255', () => {
    const m = postprocess(Float32Array.from([0.2, 0.6, 1.0, 0.4]))
    expect(Array.from(m)).toEqual([0, 127, 255, 63])
  })

  it('a flat prediction yields an empty (fully transparent) mask', () => {
    expect(Array.from(postprocess(Float32Array.from([0.5, 0.5])))).toEqual([0, 0])
  })

  it('picks onnxruntime-node where binaries exist, else wasm', () => {
    expect(chooseOrtBackend('darwin', 'arm64')).toBe('node')
    expect(chooseOrtBackend('darwin', 'x64')).toBe('web')
    expect(chooseOrtBackend('linux', 'x64')).toBe('node')
    expect(chooseOrtBackend('win32', 'x64')).toBe('node')
    expect(chooseOrtBackend('linux', 'ia32')).toBe('web')
  })
})

describe('pipeline with a tiny stand-in model', () => {
  it.each(['node', 'web'] as const)('onnxruntime-%s runs the model and returns a 1024² mask', async (backend) => {
    const rgb = new Uint8Array(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE * 3)
    for (let i = 0; i < rgb.length; i += 3) rgb[i] = i % 7 === 0 ? 255 : 10 // some contrast
    const mask = await predictMask(tinyModel, rgb, backend)
    expect(mask).toHaveLength(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE)
    expect(Math.max(...mask.subarray(0, 4096))).toBe(255)
  })

  it('Remove BG option → "name-nobg.png" with an alpha channel at the original size', async () => {
    const src = join(dir, 'portrait.jpg')
    // left half bright, right half dark: the tiny model's mask follows brightness
    const left = await sharp({ create: { width: 60, height: 80, channels: 3, background: '#ffffff' } }).png().toBuffer()
    await sharp({ create: { width: 120, height: 80, channels: 3, background: '#000000' } })
      .composite([{ input: left, left: 0, top: 0 }])
      .jpeg()
      .toFile(src)
    const [out] = await convertOk('remove-bg', [src], { options: { env: { LUD_MODEL_PATH: tinyModel } } })
    expect(basename(out!)).toBe('portrait-nobg.png')
    const buf = await readFile(out!)
    expect(startsWith(buf, MAGIC.png)).toBe(true)
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height, info.channels]).toEqual([120, 80, 4])
    const alphaAt = (x: number, y: number): number => data[(y * info.width + x) * 4 + 3]!
    for (const y of [2, 40, 77]) {
      expect(alphaAt(10, y)).toBeGreaterThan(200)
      expect(alphaAt(110, y)).toBeLessThan(50)
    }
  })

  it('missing LUD_MODEL_PATH file → MODEL_DOWNLOAD_FAILED', async () => {
    const { runOption } = await import('../helpers/engine')
    const src = join(dir, 'x.png')
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toFile(src)
    const res = await runOption('remove-bg', [src], { options: { env: { LUD_MODEL_PATH: join(dir, 'missing.onnx') } } })
    expect(res.error?.code).toBe('MODEL_DOWNLOAD_FAILED')
  })
})

// B-046 / QA3-01, TPM D24: one fresh InferenceSession per run, released on success, failure and
// cancel, on both backends. (The Electron-level repro is tests/e2e/removebg-repeat.spec.ts.)
describe('session lifecycle (D24)', () => {
  interface Spied {
    creates: number
    releases: number
    maxOpen: number
    restore(): void
  }
  /** Wrap InferenceSession.create of the given runtime to count sessions and release() calls. */
  async function spySessions(backend: 'node' | 'web', afterCreate?: () => void): Promise<Spied> {
    const ort = (backend === 'node' ? await import('onnxruntime-node') : await import('onnxruntime-web')) as unknown as {
      InferenceSession: { create: (...a: unknown[]) => Promise<{ release(): Promise<void> }> }
    }
    const original = ort.InferenceSession.create.bind(ort.InferenceSession)
    const seen: Spied = { creates: 0, releases: 0, maxOpen: 0, restore: () => spy.mockRestore() }
    let open = 0
    const spy = vi.spyOn(ort.InferenceSession, 'create').mockImplementation(async (...args: unknown[]) => {
      const session = await original(...args)
      seen.creates++
      open++
      seen.maxOpen = Math.max(seen.maxOpen, open)
      const release = session.release.bind(session)
      session.release = async () => {
        seen.releases++
        open--
        await release()
      }
      afterCreate?.()
      return session
    })
    return seen
  }

  const rgb = (): Uint8Array => new Uint8Array(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE * 3).fill(90)
  let spied: Spied | undefined
  afterEach(() => {
    spied?.restore()
    spied = undefined
  })

  it.each(['node', 'web'] as const)('onnxruntime-%s: every run gets a new session that is released afterwards', async (backend) => {
    spied = await spySessions(backend)
    for (let i = 0; i < 3; i++) {
      expect(await predictMask(tinyModel, rgb(), backend)).toHaveLength(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE)
    }
    expect(spied.creates).toBe(3)
    expect(spied.releases).toBe(3)
    expect(openModelSessions()).toBe(0)
  })

  it.each(['node', 'web'] as const)('onnxruntime-%s: a failing run still releases its session', async (backend) => {
    spied = await spySessions(backend)
    await expect(predictMask(tinyModel, new Uint8Array(7), backend)).rejects.toThrow()
    expect([spied.creates, spied.releases]).toEqual([1, 1])
    expect(openModelSessions()).toBe(0)
    // and the next run works
    expect(await predictMask(tinyModel, rgb(), backend)).toHaveLength(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE)
    expect(spied.releases).toBe(2)
  })

  it('a job cancelled while the session loads releases it and reports CANCELLED', async () => {
    const ac = new AbortController()
    spied = await spySessions('node', () => ac.abort())
    await expect(predictMask(tinyModel, rgb(), 'node', ac.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
    expect([spied.creates, spied.releases]).toEqual([1, 1])
    expect(openModelSessions()).toBe(0)
  })

  it('an already cancelled job creates no session at all', async () => {
    const ac = new AbortController()
    ac.abort()
    spied = await spySessions('node')
    await expect(predictMask(tinyModel, rgb(), 'node', ac.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(spied.creates).toBe(0)
  })

  it('a broken model file → TOOL_FAILED, nothing left open', async () => {
    const bad = join(dir, 'broken.onnx')
    await writeFile(bad, Buffer.from('not an onnx model'))
    await expect(predictMask(bad, rgb(), 'node')).rejects.toMatchObject({ code: 'TOOL_FAILED' })
    expect(openModelSessions()).toBe(0)
    expect(await predictMask(tinyModel, rgb(), 'node')).toHaveLength(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE)
  })

  it('parallel jobs run inference one at a time (one session in memory)', async () => {
    spied = await spySessions('node')
    const runs = await Promise.all([1, 2, 3].map(() => predictMask(tinyModel, rgb(), 'node')))
    expect(runs).toHaveLength(3)
    expect(spied.creates).toBe(3)
    expect(spied.maxOpen).toBe(1)
    expect(openModelSessions()).toBe(0)
  })

  it('two Remove-BG jobs in one engine both succeed (tiny model)', async () => {
    const outs: string[] = []
    for (const name of ['one', 'two']) {
      const src = join(dir, `${name}.png`)
      await sharp({ create: { width: 32, height: 24, channels: 3, background: '#808080' } }).png().toFile(src)
      const [out] = await convertOk('remove-bg', [src], { options: { env: { LUD_MODEL_PATH: tinyModel } } })
      outs.push(basename(out!))
    }
    expect(outs).toEqual(['one-nobg.png', 'two-nobg.png'])
    expect(openModelSessions()).toBe(0)
  })
})

const realModel = process.env['LUD_MODEL_PATH']
const hasRealModel = !!realModel && existsSync(realModel)

describe.skipIf(!hasRealModel)('real isnet-general-use model (set LUD_MODEL_PATH to run)', () => {
  it('cuts a bright subject out of a dark background', async () => {
    const src = join(dir, 'subject.png')
    // Raw pixels, not SVG: the engine blocks libvips' SVG loader process-wide (SEC-50).
    const [w, h] = [400, 300]
    const px = Buffer.alloc(w * h * 3)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inside = (x - 200) ** 2 + (y - 150) ** 2 <= 90 ** 2
        px.set(inside ? [0xf0, 0xc0, 0x20] : [0x20, 0x28, 0x30], (y * w + x) * 3)
      }
    }
    await sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toFile(src)
    const [out] = await convertOk('remove-bg', [src], { options: { env: { LUD_MODEL_PATH: realModel } } })
    const { data, info } = await sharp(out!).raw().toBuffer({ resolveWithObject: true })
    expect(info.channels).toBe(4)
    const alphaAt = (x: number, y: number): number => data[(y * info.width + x) * 4 + 3]!
    expect(alphaAt(200, 150)).toBeGreaterThan(128) // subject kept
    expect(alphaAt(10, 10)).toBeLessThan(128) // background removed
  })
})

if (!hasRealModel) {
  describe('real model test', () => {
    it.skip('skipped: env LUD_MODEL_PATH is not set to the real isnet-general-use.onnx (run scripts/fetch-model.mjs)', () => undefined)
  })
}
