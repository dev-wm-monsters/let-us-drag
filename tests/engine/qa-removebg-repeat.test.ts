// QA phase 3b (QA3-01): Remove BG three times in one engine with the REAL model.
// In the Electron app the second Remove-BG job of a session ends with INTERNAL ("The converter
// stopped unexpectedly"): the engine utilityProcess dies. This test runs the same two jobs in one
// engine instance in plain Node, where it PASSES (so this cannot catch QA3-01; the Electron-level repro is
// tests/qa/probes/ort-utility). Keeps the plain-Node behaviour pinned. Needs LUD_MODEL_PATH=<isnet-general-use.onnx> (scripts/fetch-model.mjs).
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

describe.skipIf(!hasRealModel)('QA: Remove BG twice in one engine (real model)', () => {
  it('two different photos in a row both succeed', async () => {
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
  describe('QA: Remove BG twice (real model)', () => {
    it.skip('skipped: set LUD_MODEL_PATH to the real isnet-general-use.onnx', () => undefined)
  })
}
