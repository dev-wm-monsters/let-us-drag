// Remove-BG: pre/post-processing math (unit), model choice (D25) and the full pipeline with a tiny
// stand-in ONNX model on both runtimes. The real-model tests live in ONE file,
// tests/engine/qa-removebg-repeat.test.ts: a BiRefNet run peaks at ~6.6-7.5 GB, and two test files
// running it in parallel forks got the second one OOM-killed on a 16 GB machine.
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { BIREFNET_LITE, ISNET } from '../../src/engine/tools/model'
import {
  BIREFNET_MIN_TOTAL_MEM,
  MODEL_INPUT_SIZE,
  chooseOrtBackend,
  chooseRemoveBgModel,
  openModelSessions,
  postprocess,
  predictMask,
  preprocess,
  removeBgModelFor,
  sessionOptions
} from '../../src/engine/tools/removebg'
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
    const t = preprocess(rgb, 2, 'isnet')
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
    const t = preprocess(new Uint8Array(12), 2, 'isnet')
    expect(Array.from(t).every((v) => v === -0.5)).toBe(true)
  })

  it('rejects wrong buffer sizes', () => {
    expect(() => preprocess(new Uint8Array(5), 2, 'isnet')).toThrow()
  })

  it('min-max normalises the prediction to 0..255', () => {
    const m = postprocess(Float32Array.from([0.2, 0.6, 1.0, 0.4]), 4, 'isnet')
    expect(Array.from(m)).toEqual([0, 127, 255, 63])
  })

  it('a flat prediction yields an empty (fully transparent) mask', () => {
    expect(Array.from(postprocess(Float32Array.from([0.5, 0.5]), 2, 'isnet'))).toEqual([0, 0])
  })

  it('picks onnxruntime-node where binaries exist, else wasm', () => {
    expect(chooseOrtBackend('darwin', 'arm64')).toBe('node')
    expect(chooseOrtBackend('darwin', 'x64')).toBe('web')
    expect(chooseOrtBackend('linux', 'x64')).toBe('node')
    expect(chooseOrtBackend('win32', 'x64')).toBe('node')
    expect(chooseOrtBackend('linux', 'ia32')).toBe('web')
  })
})

describe('BiRefNet pre/post-processing (matches rembg BiRefNetSessionGeneral)', () => {
  it('divides by the max pixel, then ImageNet mean/std per channel, NCHW planes', () => {
    const rgb = Uint8Array.from([200, 100, 0, 50, 50, 50, 0, 0, 0, 100, 200, 150])
    const t = preprocess(rgb, 2, 'birefnet-lite')
    const n = 4
    expect(t[0]).toBeCloseTo((200 / 200 - 0.485) / 0.229, 5)
    expect(t[1]).toBeCloseTo((50 / 200 - 0.485) / 0.229, 5)
    expect(t[n + 3]).toBeCloseTo((200 / 200 - 0.456) / 0.224, 5)
    expect(t[2 * n + 3]).toBeCloseTo((150 / 200 - 0.406) / 0.225, 5)
    expect(t[2 * n + 2]).toBeCloseTo((0 - 0.406) / 0.225, 5)
  })

  it('sigmoid of the logits, then min-max to 0..255 (truncated like numpy astype)', () => {
    const logits = Float32Array.from([-4, 0, 4, 1])
    const s = Array.from(logits, (x) => 1 / (1 + Math.exp(-x)))
    const [mi, ma] = [Math.min(...s), Math.max(...s)]
    const expected = s.map((v) => Math.floor(((v - mi) / (ma - mi)) * 255))
    expect(Array.from(postprocess(logits, 4, 'birefnet-lite'))).toEqual(expected)
    expect(expected).toEqual([0, 127, 255, 188])
    // Without the sigmoid (ISNet recipe) the same numbers give a different, linear mask.
    expect(Array.from(postprocess(logits, 4, 'isnet'))).toEqual([0, 127, 255, 159])
  })

  it('a flat prediction yields an empty mask', () => {
    expect(Array.from(postprocess(Float32Array.from([3, 3, 3]), 3, 'birefnet-lite'))).toEqual([0, 0, 0])
  })
})

describe('model choice (D25)', () => {
  const GiB = 1024 ** 3
  it('BiRefNet on onnxruntime-node with enough memory, ISNet on wasm or with less memory', () => {
    expect(chooseRemoveBgModel('node', 16 * GiB)).toBe('birefnet-lite')
    expect(chooseRemoveBgModel('node', 15.5 * GiB)).toBe('birefnet-lite') // a 16 GB PC reports a little less
    expect(chooseRemoveBgModel('node', BIREFNET_MIN_TOTAL_MEM)).toBe('birefnet-lite')
    expect(chooseRemoveBgModel('node', 8 * GiB)).toBe('isnet')
    expect(chooseRemoveBgModel('web', 64 * GiB)).toBe('isnet') // wasm32: BiRefNet fails with bad_alloc
  })

  it('developer override: LUD_MODEL_KIND, else the known file name of LUD_MODEL_PATH, else the machine choice', () => {
    expect(removeBgModelFor('node', { LUD_MODEL_KIND: 'isnet' }, 64 * GiB)).toBe('isnet')
    expect(removeBgModelFor('web', { LUD_MODEL_KIND: 'birefnet-lite' }, 1 * GiB)).toBe('birefnet-lite')
    expect(removeBgModelFor('node', { LUD_MODEL_PATH: `/x/${ISNET.file}` }, 64 * GiB)).toBe('isnet')
    expect(removeBgModelFor('node', { LUD_MODEL_PATH: `/m/${BIREFNET_LITE.file}` }, 4 * GiB)).toBe('birefnet-lite')
    expect(removeBgModelFor('node', { LUD_MODEL_PATH: '/x/tiny.onnx', LUD_MODEL_KIND: 'bogus' }, 64 * GiB)).toBe('birefnet-lite')
    expect(removeBgModelFor('node', {}, 8 * GiB)).toBe('isnet')
  })

  it('session options: wasm EP on web; BiRefNet on node without arena/mem-pattern; ISNet on node unchanged', () => {
    expect(sessionOptions('web', 'isnet')).toEqual({ executionProviders: ['wasm'] })
    expect(sessionOptions('node', 'birefnet-lite')).toEqual({ enableCpuMemArena: false, enableMemPattern: false })
    expect(sessionOptions('node', 'isnet')).toEqual({})
  })

  it('the two models are pinned separately and never share a file name', () => {
    expect(BIREFNET_LITE.file).not.toBe(ISNET.file)
    expect(BIREFNET_LITE.sha256).toBe('5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333')
    expect([BIREFNET_LITE.sizeBytes, BIREFNET_LITE.sizeMB]).toEqual([224_005_088, 224])
    expect([ISNET.sizeBytes, ISNET.sizeMB]).toEqual([178_648_008, 179])
    expect(Math.round(BIREFNET_LITE.sizeBytes / 1e6)).toBe(BIREFNET_LITE.sizeMB)
    expect(Math.round(ISNET.sizeBytes / 1e6)).toBe(ISNET.sizeMB)
  })
})

describe('pipeline with a tiny stand-in model', () => {
  it.each(['node', 'web'] as const)('onnxruntime-%s runs the model and returns a 1024² mask', async (backend) => {
    const rgb = new Uint8Array(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE * 3)
    for (let i = 0; i < rgb.length; i += 3) rgb[i] = i % 7 === 0 ? 255 : 10 // some contrast
    const mask = await predictMask(tinyModel, rgb, { prefer: backend })
    expect(mask).toHaveLength(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE)
    expect(Math.max(...mask.subarray(0, 4096))).toBe(255)
  })

  it.each(['isnet', 'birefnet-lite'] as const)('Remove BG option (%s recipe) → "name-nobg.png" with an alpha channel at the original size', async (kind) => {
    const src = join(dir, `portrait-${kind}.jpg`)
    // left half bright, right half dark: the tiny model's mask follows brightness
    const left = await sharp({ create: { width: 60, height: 80, channels: 3, background: '#ffffff' } }).png().toBuffer()
    await sharp({ create: { width: 120, height: 80, channels: 3, background: '#000000' } })
      .composite([{ input: left, left: 0, top: 0 }])
      .jpeg()
      .toFile(src)
    const [out] = await convertOk('remove-bg', [src], { options: { env: { LUD_MODEL_PATH: tinyModel, LUD_MODEL_KIND: kind } } })
    expect(basename(out!)).toBe(`portrait-${kind}-nobg.png`)
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
      expect(await predictMask(tinyModel, rgb(), { prefer: backend })).toHaveLength(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE)
    }
    expect(spied.creates).toBe(3)
    expect(spied.releases).toBe(3)
    expect(openModelSessions()).toBe(0)
  })

  it.each(['node', 'web'] as const)('onnxruntime-%s: a failing run still releases its session', async (backend) => {
    spied = await spySessions(backend)
    await expect(predictMask(tinyModel, new Uint8Array(7), { prefer: backend })).rejects.toThrow()
    expect([spied.creates, spied.releases]).toEqual([1, 1])
    expect(openModelSessions()).toBe(0)
    // and the next run works
    expect(await predictMask(tinyModel, rgb(), { prefer: backend })).toHaveLength(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE)
    expect(spied.releases).toBe(2)
  })

  it('a job cancelled while the session loads releases it and reports CANCELLED', async () => {
    const ac = new AbortController()
    spied = await spySessions('node', () => ac.abort())
    await expect(predictMask(tinyModel, rgb(), { prefer: 'node', signal: ac.signal })).rejects.toMatchObject({ code: 'CANCELLED' })
    expect([spied.creates, spied.releases]).toEqual([1, 1])
    expect(openModelSessions()).toBe(0)
  })

  it('an already cancelled job creates no session at all', async () => {
    const ac = new AbortController()
    ac.abort()
    spied = await spySessions('node')
    await expect(predictMask(tinyModel, rgb(), { prefer: 'node', signal: ac.signal })).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(spied.creates).toBe(0)
  })

  it('a broken model file → TOOL_FAILED, nothing left open', async () => {
    const bad = join(dir, 'broken.onnx')
    await writeFile(bad, Buffer.from('not an onnx model'))
    await expect(predictMask(bad, rgb(), { prefer: 'node' })).rejects.toMatchObject({ code: 'TOOL_FAILED' })
    expect(openModelSessions()).toBe(0)
    expect(await predictMask(tinyModel, rgb(), { prefer: 'node' })).toHaveLength(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE)
  })

  it('parallel jobs run inference one at a time (one session in memory)', async () => {
    spied = await spySessions('node')
    const runs = await Promise.all([1, 2, 3].map(() => predictMask(tinyModel, rgb(), { prefer: 'node' })))
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
