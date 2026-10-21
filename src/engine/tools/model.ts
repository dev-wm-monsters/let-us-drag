// Remove-BG model manager: download on first use (streaming, SHA-256 verified, atomic rename).
//
// Model: ISNet "isnet-general-use" (IS-Net, Qin et al., "Highly Accurate Dichotomous Image
// Segmentation", ECCV 2022), ONNX export as distributed by the rembg project.
// License notes (verified 2026-10-21 from primary sources, see the engine report):
//   - DIS repository (github.com/xuebinqin/DIS): "Our code and evaluation metric use Apache License 2.0"
//     (LICENSE.md = Apache-2.0). The README states no separate license for the pretrained weights.
//   - rembg (github.com/danielgatis/rembg), which hosts the ONNX file: MIT.
//   - The upstream file matches rembg's pinned MD5 fc16ebd8b0c10d971d3513d564d01e29.
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { EngineError, cancelledOrTimeout, errMessage } from '../errors'

export const MODEL_FILE = 'isnet-general-use.onnx'
/** Primary: our own mirror (GitHub release asset of this project). */
export const MODEL_URL = 'https://github.com/dev-wm-monsters/let-us-drag/releases/download/models-v1/isnet-general-use.onnx'
/** Documented fallback: the upstream rembg release asset. */
export const MODEL_UPSTREAM_URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx'

/**
 * >>> TPM-PINNED CONSTANT <<<
 * SHA-256 of isnet-general-use.onnx. Computed by the engine dev on 2026-10-21 from the upstream
 * rembg asset (178,648,008 bytes; MD5 fc16ebd8b0c10d971d3513d564d01e29 = rembg's own pin).
 * Re-check with `node scripts/fetch-model.mjs` before mirroring to models-v1.
 */
export const MODEL_SHA256 = '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a'
export const MODEL_SIZE_BYTES = 178_648_008

export interface ModelOptions {
  cacheDir: string
  signal: AbortSignal
  onProgress?: (p: number) => void
  env?: NodeJS.ProcessEnv
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
  urls?: readonly string[]
  sha256?: string
}

export async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256')
  await pipeline(createReadStream(path), h)
  return h.digest('hex')
}

const verified = new Set<string>()
const inflight = new Map<string, Promise<string>>()

/** Path to a verified model file, downloading it first if needed. */
export async function ensureModel(opts: ModelOptions): Promise<string> {
  const env = opts.env ?? process.env
  const local = env['LUD_MODEL_PATH']
  if (local) {
    // Developer/CI override: trusted local file, not hash-checked (lets tests use a tiny stand-in model).
    if (!existsSync(local)) throw new EngineError('MODEL_DOWNLOAD_FAILED', 'The background-removal model file is missing.', `LUD_MODEL_PATH=${local}`)
    return local
  }
  const expected = opts.sha256 ?? MODEL_SHA256
  const target = join(opts.cacheDir, MODEL_FILE)
  if (existsSync(target)) {
    if (verified.has(target)) return target
    if ((await sha256File(target)) === expected) {
      verified.add(target)
      return target
    }
    await rm(target, { force: true }) // corrupted or outdated: fetch again
  }
  let p = inflight.get(target)
  if (!p) {
    p = download(target, expected, opts).finally(() => inflight.delete(target))
    inflight.set(target, p)
  }
  return p
}

async function download(target: string, expected: string, opts: ModelOptions): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch
  const urls = opts.urls ?? [MODEL_URL, MODEL_UPSTREAM_URL]
  await mkdir(opts.cacheDir, { recursive: true })
  const failures: string[] = []
  for (const url of urls) {
    if (opts.signal.aborted) throw cancelledOrTimeout(opts.signal)
    const part = `${target}.${randomBytes(4).toString('hex')}.part`
    try {
      const res = await doFetch(url, { redirect: 'follow', signal: opts.signal })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const total = Number(res.headers.get('content-length')) || MODEL_SIZE_BYTES
      const hash = createHash('sha256')
      let received = 0
      const meter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          hash.update(chunk)
          received += chunk.length
          opts.onProgress?.(Math.min(1, received / total))
          cb(null, chunk)
        }
      })
      await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), meter, createWriteStream(part), { signal: opts.signal })
      const digest = hash.digest('hex')
      if (digest !== expected) throw new Error(`SHA-256 mismatch: got ${digest}`)
      await rename(part, target)
      verified.add(target)
      return target
    } catch (err) {
      await rm(part, { force: true }).catch(() => undefined)
      if (opts.signal.aborted) throw cancelledOrTimeout(opts.signal)
      failures.push(`${url}: ${errMessage(err)}`)
    }
  }
  throw new EngineError('MODEL_DOWNLOAD_FAILED', undefined, failures.join(' ; '))
}

/** Size of the cached model if present (for UI/diagnostics). */
export async function cachedModelSize(cacheDir: string): Promise<number | undefined> {
  try {
    return (await stat(join(cacheDir, MODEL_FILE))).size
  } catch {
    return undefined
  }
}

/** Test helper: forget in-memory verification results. */
export function resetModelCacheState(): void {
  verified.clear()
}
