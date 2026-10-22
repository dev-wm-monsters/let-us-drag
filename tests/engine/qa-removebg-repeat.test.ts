// QA (B-046 / QA3-01, fixed in phase 4 by D24: one fresh InferenceSession per job): Remove BG three
// times in a row in one engine instance with the REAL model, in plain Node. Plain Node never showed the
// bug (it was the second session.run() of a reused onnxruntime-node session inside Electron's
// utilityProcess), so this only pins the engine-level behaviour; the in-app regression test is
// tests/e2e/removebg-repeat.spec.ts (QA phase 4: tests/qa/explore/phase4.spec.ts P4-RMBG-REPEAT), the
// minimal ORT repro tests/qa/probes/ort-utility. Needs LUD_MODEL_PATH=<isnet-general-use.onnx> (scripts/fetch-model.mjs).
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
  it('three different pictures in a row all succeed', async () => {
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
    it.skip('skipped: set LUD_MODEL_PATH to the real isnet-general-use.onnx', () => undefined)
  })
}
