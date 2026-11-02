// QA (B-046 / QA3-01, fixed in phase 4 by D24: one fresh InferenceSession per job): Remove BG three
// times in a row in one engine instance with the REAL model, in plain Node. Plain Node never showed the
// bug (it was the second session.run() of a reused onnxruntime-node session inside Electron's
// utilityProcess), so this only pins the engine-level behaviour; the in-app regression test is
// tests/e2e/removebg-repeat.spec.ts (QA phase 4: tests/qa/explore/phase4.spec.ts P4-RMBG-REPEAT), the
// minimal ORT repro tests/qa/probes/ort-utility. Needs LUD_MODEL_PATH=<a real model> (scripts/fetch-model.mjs;
// BiRefNet_lite by default, ~25-35 s per run on 4 cores, hence the longer timeout).
// Every real-model test belongs in this one file (vitest runs a file's tests one after another):
// one BiRefNet run peaks at ~6.6-7.5 GB, two files in parallel forks get OOM-killed on 16 GB (D25).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeTempDir, noisyPng } from '../helpers/fixtures'
import { runOption } from '../helpers/engine'

const realModel = process.env['LUD_MODEL_PATH']
const hasRealModel = !!realModel && existsSync(realModel)

let dir = ''
let cleanup: () => Promise<void> = async () => undefined
beforeAll(async () => {
  ;({ dir, cleanup } = await makeTempDir('lud-qa-rmbg-'))
})
afterAll(async () => cleanup())

async function subject(path: string, w: number, h: number): Promise<string> {
  const px = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = (x - w / 2) ** 2 + (y - h / 2) ** 2 <= (Math.min(w, h) / 3) ** 2
      px.set(inside ? [0xf0, 0xc0, 0x20] : [0x20, 0x28, 0x30], (y * w + x) * 3)
    }
  }
  await sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg().toFile(path)
  return path
}

describe.skipIf(!hasRealModel)('QA: Remove BG three times in one engine (real model)', () => {
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
    const res = await runOption('remove-bg', [src], { options: { env: { LUD_MODEL_PATH: realModel } } })
    expect(res.error, JSON.stringify(res.error)).toBeUndefined()
    const { data, info } = await sharp(res.outputPaths[0]!).raw().toBuffer({ resolveWithObject: true })
    expect(info.channels).toBe(4)
    const alphaAt = (x: number, y: number): number => data[(y * info.width + x) * 4 + 3]!
    expect(alphaAt(200, 150)).toBeGreaterThan(128) // subject kept
    expect(alphaAt(10, 10)).toBeLessThan(128) // background removed
  })

  it('three different pictures in a row all succeed', { timeout: 480_000 }, async () => {
    const opts = { options: { env: { LUD_MODEL_PATH: realModel } } }
    const a = await runOption('remove-bg', [await subject(join(dir, 'a.jpg'), 1000, 667)], opts)
    expect(a.error, JSON.stringify(a.error)).toBeUndefined()
    const b = await runOption('remove-bg', [await subject(join(dir, 'b.jpg'), 600, 399)], opts)
    expect(b.error, JSON.stringify(b.error)).toBeUndefined()
    const c = await runOption('remove-bg', [await noisyPng(join(dir, 'c.png'), 640, 480)], opts)
    expect(c.error, JSON.stringify(c.error)).toBeUndefined()
  })
})

if (!hasRealModel) {
  describe('QA: Remove BG three times (real model)', () => {
    it.skip('skipped: set LUD_MODEL_PATH to a real Remove-BG model (scripts/fetch-model.mjs)', () => undefined)
  })
}
