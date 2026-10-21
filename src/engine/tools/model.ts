// Remove-BG model manager: one-time download on first use (TPM decision D10), streaming,
// SHA-256 verified, atomic rename into the cache, shared by concurrent jobs.
//
// Model: ISNet "isnet-general-use" (IS-Net, Qin et al., "Highly Accurate Dichotomous Image
// Segmentation", ECCV 2022), ONNX export as distributed by the rembg project.
// License notes (verified 2026-10-21 from primary sources, see the engine report):
//   - DIS repository (github.com/xuebinqin/DIS): "Our code and evaluation metric use Apache License 2.0"
//     (LICENSE.md = Apache-2.0). The README states no separate license for the pretrained weights.
//   - rembg (github.com/danielgatis/rembg), which hosts the ONNX file: MIT.
//   - The upstream file matches rembg's pinned MD5 fc16ebd8b0c10d971d3513d564d01e29.
// Because the weights' license is not stated upstream, we do NOT mirror them (D10): the upstream
// rembg release asset is the primary source. Our own release URL is only tried second, in case the
// product owner decides to mirror later; today it answers 404 at once.
//
// Network rules (SEC-120/121): https only, hard-coded URLs, redirects followed manually and only to
// GitHub's release hosts, a byte cap (the pinned size), a connect and a stall timeout, SHA-256
// checked while streaming and again whenever a cached file is first used in a process.
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { EngineError, cancelledOrTimeout, errMessage } from '../errors'
import { MODEL_CONNECT_TIMEOUT_MS, MODEL_STALL_TIMEOUT_MS } from '../limits'

export const MODEL_FILE = 'isnet-general-use.onnx'
/** Primary (D10): the upstream rembg release asset. */
export const MODEL_UPSTREAM_URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx'
/** Optional secondary: our own release, used only if it ever exists (not published today, D10). */
export const MODEL_MIRROR_URL = 'https://github.com/dev-wm-monsters/let-us-drag/releases/download/models-v1/isnet-general-use.onnx'
/** Sources in the order they are tried. */
export const MODEL_URLS: readonly string[] = [MODEL_UPSTREAM_URL, MODEL_MIRROR_URL]
/** @deprecated kept for older imports: the primary URL. */
export const MODEL_URL = MODEL_UPSTREAM_URL

/** Hosts a download may start at or be redirected to (GitHub release downloads). */
export const MODEL_ALLOWED_HOSTS: readonly string[] = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']
const MAX_REDIRECTS = 5

/**
 * >>> TPM-PINNED CONSTANT <<<
 * SHA-256 of isnet-general-use.onnx. Computed by the engine dev on 2026-10-21 from the upstream
 * rembg asset (178,648,008 bytes; MD5 fc16ebd8b0c10d971d3513d564d01e29 = rembg's own pin).
 * Re-check with `node scripts/fetch-model.mjs`.
 */
export const MODEL_SHA256 = '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a'
export const MODEL_SIZE_BYTES = 178_648_008

export interface ModelOptions {
  cacheDir: string
  signal: AbortSignal
  /** Download progress 0..1 (only called while downloading). */
  onProgress?: (p: number) => void
  /** Called when a fresh download finished streaming and its hash is being checked. */
  onVerify?: () => void
  env?: NodeJS.ProcessEnv
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
  urls?: readonly string[]
  sha256?: string
  /** Exact expected size (defaults to MODEL_SIZE_BYTES with the pinned hash, else unchecked). */
  sizeBytes?: number
  allowedHosts?: readonly string[]
  connectTimeoutMs?: number
  stallTimeoutMs?: number
}

export async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256')
  await pipeline(createReadStream(path), h)
  return h.digest('hex')
}

/** True when `url` is https and its host is allowed (SEC-120). */
export function isAllowedModelUrl(url: string, allowedHosts: readonly string[] = MODEL_ALLOWED_HOSTS): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  return u.protocol === 'https:' && u.username === '' && u.password === '' && allowedHosts.includes(u.hostname.toLowerCase())
}

const verified = new Set<string>()

/** One shared download per target file; every waiting job gets progress and can leave on its own. */
interface SharedDownload {
  promise: Promise<string>
  controller: AbortController
  listeners: Set<(p: number) => void>
  waiters: number
}
const inflight = new Map<string, SharedDownload>()

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
  if (verified.has(target) && existsSync(target)) return target
  if (!inflight.has(target) && existsSync(target)) {
    if ((await sha256File(target)) === expected) {
      verified.add(target)
      return target
    }
    await rm(target, { force: true }) // corrupted or outdated: fetch again
  }
  return joinDownload(target, expected, opts)
}

/** Start or join the shared download of `target`, leaving it (without stopping it for others) on abort. */
function joinDownload(target: string, expected: string, opts: ModelOptions): Promise<string> {
  let shared = inflight.get(target)
  if (!shared) {
    const controller = new AbortController()
    const listeners = new Set<(p: number) => void>()
    const s: SharedDownload = {
      controller,
      listeners,
      waiters: 0,
      promise: download(target, expected, opts, controller.signal, (p) => listeners.forEach((l) => l(p))).finally(() => inflight.delete(target))
    }
    s.promise.catch(() => undefined) // a waiter may have left already; never an unhandled rejection
    inflight.set(target, s)
    shared = s
  }
  const s = shared
  if (opts.signal.aborted) return Promise.reject(cancelledOrTimeout(opts.signal))
  const listener = (p: number): void => opts.onProgress?.(p)
  s.listeners.add(listener)
  s.waiters++
  return new Promise<string>((resolve, reject) => {
    const leave = (): void => {
      s.listeners.delete(listener)
      opts.signal.removeEventListener('abort', onAbort)
      s.waiters--
    }
    const onAbort = (): void => {
      leave()
      if (s.waiters === 0) s.controller.abort() // nobody waits any more: stop the download
      reject(cancelledOrTimeout(opts.signal))
    }
    opts.signal.addEventListener('abort', onAbort, { once: true })
    s.promise.then(
      (p) => {
        leave()
        resolve(p)
      },
      (err: unknown) => {
        leave()
        reject(err)
      }
    )
  })
}

/** Remove leftovers of interrupted downloads ("<file>.<random>.part"). Only one download runs per target. */
async function cleanPartials(cacheDir: string): Promise<void> {
  let names: string[]
  try {
    names = await readdir(cacheDir)
  } catch {
    return
  }
  await Promise.all(names.filter((n) => n.startsWith(`${MODEL_FILE}.`) && n.endsWith('.part')).map((n) => rm(join(cacheDir, n), { force: true }).catch(() => undefined)))
}

/** fetch with manual, allow-listed redirects and a timeout until the response headers arrive. */
async function fetchAllowed(url: string, opts: ModelOptions, signal: AbortSignal): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch
  const hosts = opts.allowedHosts ?? MODEL_ALLOWED_HOSTS
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedModelUrl(current, hosts)) throw new Error(`refused URL ${new URL(current).host || current}`)
    const connect = AbortSignal.timeout(opts.connectTimeoutMs ?? MODEL_CONNECT_TIMEOUT_MS)
    const res = await doFetch(current, { redirect: 'manual', signal: AbortSignal.any([signal, connect]) })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      await res.body?.cancel().catch(() => undefined)
      if (!location) throw new Error(`HTTP ${res.status} without location`)
      current = new URL(location, current).href
      continue
    }
    return res
  }
  throw new Error('too many redirects')
}

async function download(target: string, expected: string, opts: ModelOptions, signal: AbortSignal, onProgress: (p: number) => void): Promise<string> {
  const urls = opts.urls ?? MODEL_URLS
  const size = opts.sizeBytes ?? (expected === MODEL_SHA256 ? MODEL_SIZE_BYTES : undefined)
  await mkdir(opts.cacheDir, { recursive: true })
  await cleanPartials(opts.cacheDir)
  const failures: string[] = []
  for (const url of urls) {
    if (signal.aborted) throw cancelledOrTimeout(signal)
    const part = `${target}.${randomBytes(4).toString('hex')}.part`
    const stall = new AbortController()
    let stallTimer: NodeJS.Timeout | undefined
    const kick = (): void => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => stall.abort(new Error('download stalled')), opts.stallTimeoutMs ?? MODEL_STALL_TIMEOUT_MS)
      stallTimer.unref?.()
    }
    try {
      const res = await fetchAllowed(url, opts, signal)
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => undefined)
        throw new Error(`HTTP ${res.status}`)
      }
      const declared = Number(res.headers.get('content-length')) || undefined
      if (size !== undefined && declared !== undefined && declared !== size) throw new Error(`unexpected size ${declared}`)
      const total = size ?? declared
      const hash = createHash('sha256')
      let received = 0
      kick()
      const meter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          kick()
          received += chunk.length
          if (size !== undefined && received > size) {
            cb(new Error(`more than ${size} bytes`))
            return
          }
          hash.update(chunk)
          if (total) onProgress(Math.min(1, received / total))
          cb(null, chunk)
        }
      })
      await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), meter, createWriteStream(part, { flags: 'wx' }), {
        signal: AbortSignal.any([signal, stall.signal])
      })
      opts.onVerify?.()
      const digest = hash.digest('hex')
      if (digest !== expected) throw new Error(`SHA-256 mismatch: got ${digest}`)
      await rename(part, target)
      verified.add(target)
      onProgress(1)
      return target
    } catch (err) {
      await rm(part, { force: true }).catch(() => undefined)
      if (signal.aborted) throw cancelledOrTimeout(signal)
      failures.push(`${url}: ${stall.signal.aborted ? 'stalled' : errMessage(err)}`)
    } finally {
      if (stallTimer) clearTimeout(stallTimer)
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
