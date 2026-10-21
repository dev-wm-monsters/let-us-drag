// Background removal with ISNet (isnet-general-use) on ONNX Runtime.
// Pre/post-processing mirrors rembg's DisSession (rembg/sessions/dis_general_use.py + base.py):
//   1. RGB, resize to 1024×1024 (LANCZOS),
//   2. divide by the max pixel value of the whole array (not a fixed 255), subtract mean 0.5,
//      divide by std 1.0, NCHW float32,
//   3. take output[0][:, 0], min-max normalise to 0..1, ×255 → uint8 mask,
//   4. resize the mask back to the original size (LANCZOS) and use it as the alpha channel (PNG).
// Runtime: onnxruntime-node where its prebuilt binary exists, otherwise onnxruntime-web (wasm).
// Both are loaded lazily on first use so the engine starts fast. One session per run (D24).
import { cpus } from 'node:os'
import { dirname, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MAX_INPUT_PIXELS } from '../limits'
import { sharp, sharpError, type Sharp } from './sharp-safe'
import { EngineError, errMessage, throwIfAborted } from '../errors'
import { resolveEntry } from '../resolve'

export const MODEL_INPUT_SIZE = 1024
const MEAN = [0.5, 0.5, 0.5] as const
const STD = [1.0, 1.0, 1.0] as const

export type OrtBackend = 'node' | 'web'

/** onnxruntime-node 1.30 ships binaries for these platform-arch pairs (verified in node_modules). */
const NODE_BINARIES = new Set(['darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64'])

export function chooseOrtBackend(platform: string = process.platform, arch: string = process.arch): OrtBackend {
  return NODE_BINARIES.has(`${platform}-${arch}`) ? 'node' : 'web'
}

/** HWC uint8 RGB (size×size) → NCHW float32, rembg normalisation (max-scaling, mean/std). */
export function preprocess(rgb: Uint8Array, size = MODEL_INPUT_SIZE): Float32Array {
  const n = size * size
  if (rgb.length !== n * 3) throw new Error(`expected ${n * 3} bytes, got ${rgb.length}`)
  let max = 0
  for (let i = 0; i < rgb.length; i++) if (rgb[i]! > max) max = rgb[i]!
  const scale = Math.max(max, 1e-6)
  const out = new Float32Array(n * 3)
  for (let c = 0; c < 3; c++) {
    const mean = MEAN[c]!
    const std = STD[c]!
    const plane = c * n
    for (let i = 0; i < n; i++) out[plane + i] = (rgb[i * 3 + c]! / scale - mean) / std
  }
  return out
}

/** Prediction (first channel) → uint8 mask via min-max normalisation, like rembg. */
export function postprocess(pred: Float32Array, count = pred.length): Uint8Array {
  let mi = Infinity
  let ma = -Infinity
  for (let i = 0; i < count; i++) {
    const v = pred[i]!
    if (v < mi) mi = v
    if (v > ma) ma = v
  }
  const out = new Uint8Array(count)
  const range = ma - mi
  if (!(range > 0)) return out // flat prediction: nothing recognisable as foreground
  for (let i = 0; i < count; i++) out[i] = Math.min(255, Math.floor(((pred[i]! - mi) / range) * 255))
  return out
}

interface OrtTensor {
  data: unknown
  dims: readonly number[]
}
interface OrtSession {
  inputNames: readonly string[]
  outputNames: readonly string[]
  run(feeds: Record<string, unknown>, fetches?: readonly string[]): Promise<Record<string, OrtTensor>>
  /** onnxruntime-common 1.30 `InferenceSession.release(): Promise<void>` (both backends). */
  release?(): Promise<void>
}
interface OrtModule {
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => unknown
  InferenceSession: { create(pathOrBytes: string, options?: Record<string, unknown>): Promise<OrtSession> }
  env: { wasm: { numThreads?: number; wasmPaths?: string } }
}

async function importOrt(prefer: OrtBackend): Promise<{ ort: OrtModule; backend: OrtBackend }> {
  if (prefer === 'node') {
    try {
      return { ort: (await import('onnxruntime-node')) as unknown as OrtModule, backend: 'node' }
    } catch {
      // binary missing or incompatible: fall back to wasm
    }
  }
  const ort = (await import('onnxruntime-web')) as unknown as OrtModule
  ort.env.wasm.numThreads = Math.max(1, Math.min(4, cpus().length))
  const distDir = dirname(resolveEntry('onnxruntime-web')) // .../onnxruntime-web/dist
  const asar = `${sep}app.asar${sep}`
  if (distDir.includes(asar)) {
    // Packaged app: the .wasm/.mjs runtime files are unpacked next to the asar (electron-builder asarUnpack).
    ort.env.wasm.wasmPaths = pathToFileURL(distDir.replace(asar, `${sep}app.asar.unpacked${sep}`) + sep).href
  }
  return { ort, backend: 'web' }
}

/** The runtime module (not a session) is loaded once per backend; its env is configured only then. */
const runtimes = new Map<OrtBackend, Promise<{ ort: OrtModule; backend: OrtBackend }>>()

function loadOrt(prefer: OrtBackend): Promise<{ ort: OrtModule; backend: OrtBackend }> {
  let p = runtimes.get(prefer)
  if (!p) {
    p = importOrt(prefer)
    runtimes.set(prefer, p)
    p.catch(() => runtimes.delete(prefer))
  }
  return p
}

/**
 * Inference runs one at a time: every run gets its own session (~170 MB model + working memory),
 * so two parallel Remove-BG jobs would otherwise hold two of them.
 */
let inferenceQueue: Promise<unknown> = Promise.resolve()

function serialised<T>(fn: () => Promise<T>): Promise<T> {
  const run = inferenceQueue.then(fn, fn)
  inferenceQueue = run.catch(() => undefined)
  return run
}

/** Sessions created and not yet released (test hook: must be 0 after every job). */
let openSessions = 0
export function openModelSessions(): number {
  return openSessions
}

async function releaseSession(session: OrtSession): Promise<void> {
  try {
    await session.release?.()
  } catch {
    // nothing more we can do; the session object is dropped either way
  } finally {
    openSessions--
  }
}

/**
 * Run the model on a 1024×1024 RGB buffer, returning a 1024×1024 uint8 mask.
 *
 * TPM decision D24 (B-046 / QA3-01): a fresh InferenceSession for every run, released afterwards
 * on success, failure and cancel, on both backends. Reusing one onnxruntime-node session makes the
 * second `session.run()` kill the Electron utilityProcess (exit code 5, Linux verified; same
 * backend on Apple-silicon macOS and Windows x64/arm64). A fresh session costs ~1 s.
 */
export async function predictMask(
  modelPath: string,
  rgb1024: Uint8Array,
  prefer: OrtBackend = chooseOrtBackend(),
  signal?: AbortSignal
): Promise<Uint8Array> {
  const { ort, backend } = await loadOrt(prefer)
  return serialised(async () => {
    if (signal) throwIfAborted(signal)
    let session: OrtSession
    try {
      session = await ort.InferenceSession.create(modelPath, backend === 'web' ? { executionProviders: ['wasm'] } : {})
    } catch (err) {
      throw new EngineError('TOOL_FAILED', "I couldn't load the background-removal model.", errMessage(err))
    }
    openSessions++
    try {
      if (signal) throwIfAborted(signal)
      const size = MODEL_INPUT_SIZE
      const input = new ort.Tensor('float32', preprocess(rgb1024, size), [1, 3, size, size])
      const outName = session.outputNames[0]!
      let result
      try {
        result = await session.run({ [session.inputNames[0]!]: input }, [outName])
      } catch (err) {
        throw new EngineError('TOOL_FAILED', 'The background remover stumbled on this image.', errMessage(err))
      }
      const out = result[outName]
      if (!out || !(out.data instanceof Float32Array) || out.data.length < size * size) {
        throw new EngineError('TOOL_FAILED', 'The background remover gave an unexpected answer.', `dims=${String(out?.dims)}`)
      }
      // postprocess copies into a new Uint8Array: nothing refers to the session's output after release.
      return postprocess(out.data, size * size)
    } finally {
      await releaseSession(session)
    }
  })
}

/** Remove the background from an (already auto-oriented) image. Returns PNG bytes. */
export async function removeBackground(img: Sharp, modelPath: string, signal: AbortSignal, onStage: (p: number, stage: string) => void): Promise<Buffer> {
  onStage(-1, 'Looking closely')
  // First pixel access: this is where libvips really decodes the input (lazy loaders).
  const { data: rgb, info } = await img
    .clone()
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
    .catch((err: unknown) => {
      throw sharpError(err)
    })
  if (info.channels !== 3) throw new EngineError('INTERNAL', undefined, `expected 3 channels, got ${info.channels}`)
  const { width, height } = info
  const raw = { raw: { width, height, channels: 3 as const }, limitInputPixels: MAX_INPUT_PIXELS }
  const small = await sharp(rgb, raw).resize(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer()
  throwIfAborted(signal)
  onStage(0.2, 'Finding the subject')
  const mask1024 = await predictMask(modelPath, small, chooseOrtBackend(), signal)
  throwIfAborted(signal)
  onStage(0.9, 'Cutting it out')
  const mask = await sharp(mask1024, { raw: { width: MODEL_INPUT_SIZE, height: MODEL_INPUT_SIZE, channels: 1 }, limitInputPixels: MAX_INPUT_PIXELS })
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
    .extractChannel(0) // sharp would otherwise emit a 3-channel sRGB buffer
    .raw()
    .toBuffer()
  if (mask.length !== width * height) throw new EngineError('INTERNAL', undefined, `mask size ${mask.length} != ${width * height}`)
  return sharp(rgb, raw).joinChannel(mask, { raw: { width, height, channels: 1 } }).png().toBuffer()
}
