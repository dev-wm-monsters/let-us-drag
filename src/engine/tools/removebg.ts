// Background removal on ONNX Runtime with one of two pinned models (TPM decision D25, model.ts):
// BiRefNet_lite (default) or ISNet (wasm fallback and machines with less memory).
// Pre/post-processing mirrors rembg 2.0.86 exactly (rembg/sessions/base.py `normalize`,
// birefnet_general.py and dis_general_use.py):
//   1. RGB, resize to 1024×1024 (LANCZOS),
//   2. divide by the max pixel value of the whole array (not a fixed 255), then per channel
//      (x - mean) / std, NCHW float32. ISNet: mean 0.5, std 1.0. BiRefNet: ImageNet mean
//      (0.485, 0.456, 0.406), std (0.229, 0.224, 0.225),
//   3. take output[0][:, 0]; BiRefNet only: sigmoid (its output is logits); then min-max normalise
//      to 0..1, ×255 → uint8 mask (truncated, like numpy's astype),
//   4. resize the mask back to the original size (LANCZOS) and use it as the alpha channel (PNG).
// Runtime: onnxruntime-node where its prebuilt binary exists, otherwise onnxruntime-web (wasm).
// Both are loaded lazily on first use so the engine starts fast. One session per run (D24).
import { cpus, totalmem } from 'node:os'
import { basename, dirname, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MAX_INPUT_PIXELS } from '../limits'
import { sharp, sharpError, type Sharp } from './sharp-safe'
import { EngineError, errMessage, throwIfAborted } from '../errors'
import { resolveEntry } from '../resolve'
import { REMOVE_BG_MODELS, type RemoveBgModelId } from './model'

export const MODEL_INPUT_SIZE = 1024

interface Recipe {
  mean: readonly [number, number, number]
  std: readonly [number, number, number]
  /** The model outputs logits (BiRefNet): apply a sigmoid before min-max normalising. */
  sigmoid: boolean
}

const RECIPES: Readonly<Record<RemoveBgModelId, Recipe>> = {
  'birefnet-lite': { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], sigmoid: true },
  isnet: { mean: [0.5, 0.5, 0.5], std: [1.0, 1.0, 1.0], sigmoid: false }
}

export type OrtBackend = 'node' | 'web'

/** onnxruntime-node 1.30 ships binaries for these platform-arch pairs (verified in node_modules). */
const NODE_BINARIES = new Set(['darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64'])

export function chooseOrtBackend(platform: string = process.platform, arch: string = process.arch): OrtBackend {
  return NODE_BINARIES.has(`${platform}-${arch}`) ? 'node' : 'web'
}

/**
 * BiRefNet needs this much physical memory (D25): one 1024×1024 run peaked at ~6.6 GB RSS with
 * `sessionOptions` (~7.5 GB with ORT defaults) on onnxruntime-node 1.30 (CPU). 16 GB machines
 * report a little under 16 GiB; 8 GB machines keep ISNet (~1 GB peak) instead of swapping or
 * being killed (the test runner itself was OOM-killed running two BiRefNet jobs on 16 GB).
 */
export const BIREFNET_MIN_TOTAL_MEM = 14 * 1024 ** 3

/** Which model this machine uses (D25): BiRefNet on onnxruntime-node with enough memory, else ISNet. */
export function chooseRemoveBgModel(backend: OrtBackend, totalMemBytes: number = totalmem()): RemoveBgModelId {
  return backend === 'node' && totalMemBytes >= BIREFNET_MIN_TOTAL_MEM ? 'birefnet-lite' : 'isnet'
}

/**
 * Developer/CI override (unpackaged runs only, D18 strips LUD_* when packaged): with LUD_MODEL_PATH
 * the model kind comes from LUD_MODEL_KIND, else from a known file name, else the machine's choice.
 */
export function removeBgModelFor(backend: OrtBackend, env: NodeJS.ProcessEnv = process.env, totalMemBytes?: number): RemoveBgModelId {
  const kind = env['LUD_MODEL_KIND']
  if (kind === 'birefnet-lite' || kind === 'isnet') return kind
  const local = env['LUD_MODEL_PATH']
  if (local) {
    const name = basename(local)
    const known = Object.values(REMOVE_BG_MODELS).find((m) => m.file === name)
    if (known) return known.id
  }
  return chooseRemoveBgModel(backend, totalMemBytes)
}

/** HWC uint8 RGB (size×size) → NCHW float32, rembg normalisation (max-scaling, mean/std). */
export function preprocess(rgb: Uint8Array, size: number, model: RemoveBgModelId): Float32Array {
  const n = size * size
  if (rgb.length !== n * 3) throw new Error(`expected ${n * 3} bytes, got ${rgb.length}`)
  const { mean, std } = RECIPES[model]
  let max = 0
  for (let i = 0; i < rgb.length; i++) if (rgb[i]! > max) max = rgb[i]!
  const scale = Math.max(max, 1e-6)
  const out = new Float32Array(n * 3)
  for (let c = 0; c < 3; c++) {
    const m = mean[c]!
    const s = std[c]!
    const plane = c * n
    for (let i = 0; i < n; i++) out[plane + i] = (rgb[i * 3 + c]! / scale - m) / s
  }
  return out
}

/** Prediction (first channel) → uint8 mask: sigmoid (BiRefNet only), then min-max, like rembg. */
export function postprocess(pred: Float32Array, count: number, model: RemoveBgModelId): Uint8Array {
  const sig = RECIPES[model].sigmoid
  const v = new Float64Array(count)
  let mi = Infinity
  let ma = -Infinity
  for (let i = 0; i < count; i++) {
    const x = sig ? 1 / (1 + Math.exp(-pred[i]!)) : pred[i]!
    v[i] = x
    if (x < mi) mi = x
    if (x > ma) ma = x
  }
  const out = new Uint8Array(count)
  const range = ma - mi
  if (!(range > 0)) return out // flat prediction: nothing recognisable as foreground
  for (let i = 0; i < count; i++) out[i] = Math.min(255, Math.floor(((v[i]! - mi) / range) * 255))
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
 * The backend that will really run the model here: onnxruntime-node can fail to load (e.g. a
 * Windows PC without the VC++ runtime) and then falls back to wasm, which only ISNet fits into.
 * Decided before the model is chosen and downloaded.
 */
export async function removeBgBackend(prefer: OrtBackend = chooseOrtBackend()): Promise<OrtBackend> {
  return (await loadOrt(prefer)).backend
}

/**
 * Inference runs one at a time: every run gets its own session (224 MB BiRefNet weights plus up
 * to ~6.4 GB of working memory), so two parallel Remove-BG jobs would otherwise hold two of them.
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
 * BiRefNet on onnxruntime-node: without the CPU memory arena and the memory-pattern planner the
 * peak drops from ~7.47 GB to ~6.6 GB RSS at the same speed and with a bit-identical mask
 * (measured twice each on a 1000×667 photo, D25). ISNet keeps the defaults it was verified with.
 */
export function sessionOptions(backend: OrtBackend, model: RemoveBgModelId): Record<string, unknown> {
  if (backend === 'web') return { executionProviders: ['wasm'] }
  return model === 'birefnet-lite' ? { enableCpuMemArena: false, enableMemPattern: false } : {}
}

export interface PredictOptions {
  /** Which model the file at `modelPath` is (pre/post-processing differ). Default ISNet's recipe. */
  model?: RemoveBgModelId
  prefer?: OrtBackend
  signal?: AbortSignal
}

/**
 * Run the model on a 1024×1024 RGB buffer, returning a 1024×1024 uint8 mask.
 *
 * TPM decision D24 (B-046 / QA3-01): a fresh InferenceSession for every run, released afterwards
 * on success, failure and cancel, on both backends. Reusing one onnxruntime-node session makes the
 * second `session.run()` kill the Electron utilityProcess (exit code 5, Linux verified; same
 * backend on Apple-silicon macOS and Windows x64/arm64). A fresh session costs ~0.4 s (ISNet) or
 * ~3–4 s (BiRefNet; ~9 s when the file is not in the OS cache yet), measured on 4 vCPUs (D25).
 */
export async function predictMask(modelPath: string, rgb1024: Uint8Array, opts: PredictOptions = {}): Promise<Uint8Array> {
  const model = opts.model ?? 'isnet'
  const signal = opts.signal
  const { ort, backend } = await loadOrt(opts.prefer ?? chooseOrtBackend())
  return serialised(async () => {
    if (signal) throwIfAborted(signal)
    let session: OrtSession
    try {
      session = await ort.InferenceSession.create(modelPath, sessionOptions(backend, model))
    } catch (err) {
      throw new EngineError('TOOL_FAILED', "I couldn't load the background-removal model.", errMessage(err))
    }
    openSessions++
    try {
      if (signal) throwIfAborted(signal)
      const size = MODEL_INPUT_SIZE
      const input = new ort.Tensor('float32', preprocess(rgb1024, size, model), [1, 3, size, size])
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
      return postprocess(out.data, size * size, model)
    } finally {
      await releaseSession(session)
    }
  })
}

/** Stage text while the model runs, per model (BiRefNet takes ~25–35 s on 4 cores, D25). */
export const FIND_STAGES: Readonly<Record<RemoveBgModelId, string>> = {
  'birefnet-lite': 'Snipping carefully, this takes a moment',
  isnet: 'Finding the subject'
}

export interface RemoveBackgroundOptions {
  /** Default ISNet (callers pass the machine's choice, see removeBgModelFor). */
  model?: RemoveBgModelId
  backend?: OrtBackend
}

/** Remove the background from an (already auto-oriented) image. Returns PNG bytes. */
export async function removeBackground(
  img: Sharp,
  modelPath: string,
  signal: AbortSignal,
  onStage: (p: number, stage: string) => void,
  opts: RemoveBackgroundOptions = {}
): Promise<Buffer> {
  const model = opts.model ?? 'isnet'
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
  // onnxruntime-node blocks this thread for the whole session load and run (measured: no timer
  // fires for ~30 s with BiRefNet), so no progress can be sent meanwhile. "Unknown" progress makes
  // the overlay spin its ring on its own (renderer CSS animation), so a long run never looks frozen.
  onStage(-1, FIND_STAGES[model])
  await new Promise<void>((r) => setImmediate(r)) // let the stage message go out before the thread blocks
  const mask1024 = await predictMask(modelPath, small, { model, prefer: opts.backend ?? chooseOrtBackend(), signal })
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
