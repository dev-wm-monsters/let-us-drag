// B-046 / QA3-01 (TPM D24): Remove BG must work on every run inside the Electron utilityProcess.
// Before the fix the engine reused one onnxruntime-node InferenceSession and the second run killed
// the engine process (exit code 5, "The converter stopped unexpectedly"). Plain-Node engine tests
// cannot see this, so it is checked in the real app: three Remove-BG jobs in one app session.
// Needs the real model: LUD_MODEL_PATH=<isnet-general-use.onnx> (scripts/fetch-model.mjs; CI sets it on Linux).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { NEEDS_INTEGRATION, expect, test } from './support/app'
import { convertViaDrop, expectOverlayHidesItself, outputsOf } from './support/flows'

const modelPath = process.env['LUD_MODEL_PATH']
const hasModel = !!modelPath && existsSync(modelPath)

/** A bright disc on a dark background, so the model has a subject. */
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

test.describe('Remove BG repeated in one app session (B-046)', () => {
  test.skip(!hasModel, 'set LUD_MODEL_PATH to the real isnet-general-use.onnx')

  test('E2E-RMBG-REPEAT three Remove-BG jobs in a row all finish, engine never restarts', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    test.setTimeout(360_000)
    const app = await lud.launchReady({ env: { LUD_MODEL_PATH: modelPath! } })
    const log: string[] = []
    app.process().stdout?.on('data', (d: Buffer) => log.push(d.toString()))
    app.process().stderr?.on('data', (d: Buffer) => log.push(d.toString()))

    const inputs = [
      await subject(join(lud.workDir, 'first.jpg'), 640, 427),
      await subject(join(lud.workDir, 'second.jpg'), 400, 600),
      await subject(join(lud.workDir, 'third.jpg'), 512, 512)
    ]
    for (const [i, input] of inputs.entries()) {
      const { event } = await convertViaDrop(app, testInfo, `removebg-${i + 1}`, [input], 'remove-bg')
      expect(event.type, `job ${i + 1}: ${JSON.stringify(event)}`).toBe('done')
      const [out] = outputsOf(event)
      expect(out).toBe(input.replace(/\.jpg$/, '-nobg.png'))
      const meta = await sharp(out!).metadata()
      expect(meta.format).toBe('png')
      expect(meta.hasAlpha).toBe(true)
      await expectOverlayHidesItself(app)
    }
    expect(log.join(''), 'the engine utilityProcess must not die').not.toMatch(/engine exited/)
  })
})
