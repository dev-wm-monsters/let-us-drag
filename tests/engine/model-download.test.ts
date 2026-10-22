// Remove-BG model download over a real (local) HTTP connection: timeouts must behave like on a
// slow home connection, not like on a fast CI runner (regression: the connect timeout used to keep
// running on the response body and killed every download slower than ~6 MB/s after 30 s).
//
// The allow-list only accepts https GitHub hosts, so the injected fetchImpl maps
// https://github.com/<path> to the local plain-HTTP server and calls the REAL fetch with the
// engine's own RequestInit (signal included). That is what makes the old bug reproducible: an
// aborted fetch signal also aborts a real response body stream.
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EngineError } from '../../src/engine/errors'
import { MODEL_FAILURE_MESSAGES, ensureModel, resetModelCacheState } from '../../src/engine/tools/model'
import { makeTempDir } from '../helpers/fixtures'

const body = Buffer.alloc(64 * 1024)
for (let i = 0; i < body.length; i++) body[i] = (i * 31 + 7) & 0xff
const sha = createHash('sha256').update(body).digest('hex')
const CHUNKS = 16
const CHUNK_GAP_MS = 100 // 16 chunks x 100 ms: the whole body takes ~1.6 s

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function slowBody(res: ServerResponse, gapMs: number, stopAfter = CHUNKS): Promise<void> {
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(body.length) })
  const size = body.length / CHUNKS
  for (let i = 0; i < CHUNKS; i++) {
    if (i >= stopAfter || res.destroyed) return // "stall": keep the socket open, send nothing more
    res.write(body.subarray(i * size, (i + 1) * size))
    await sleep(gapMs)
  }
  res.end()
}

function handler(req: IncomingMessage, res: ServerResponse): void {
  switch (req.url) {
    case '/slow': // steady but slow: total time >> connect timeout, every gap << stall timeout
      void slowBody(res, CHUNK_GAP_MS)
      return
    case '/redirect-slow':
      res.writeHead(302, { location: 'https://github.com/slow' })
      res.end()
      return
    case '/stall': // headers and a little data, then silence
      void slowBody(res, 10, 2)
      return
    case '/no-headers': // accepts the request and never answers
      return
    case '/unavailable':
      res.writeHead(503)
      res.end('busy')
      return
    default:
      res.writeHead(404)
      res.end('Not Found')
  }
}

describe('model download timeouts (local HTTP server)', () => {
  let server: Server
  let origin = ''
  let dir = ''
  let cleanup: () => Promise<void> = async () => undefined
  const realFetch = globalThis.fetch
  const fetchImpl = ((u: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(u))
    expect(url.protocol).toBe('https:')
    return realFetch(`${origin}${url.pathname}`, init)
  }) as typeof fetch
  const base = { env: {}, sha256: sha, sizeBytes: body.length, allowedHosts: ['github.com'], fetchImpl }

  beforeAll(async () => {
    ;({ dir, cleanup } = await makeTempDir('lud-model-dl-'))
    server = createServer(handler)
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
    await cleanup()
  })

  it('a slow but steady download that takes much longer than the connect timeout succeeds', async () => {
    resetModelCacheState()
    const cacheDir = join(dir, 'slow-ok')
    const progress: number[] = []
    const t0 = Date.now()
    const p = await ensureModel({
      ...base,
      cacheDir,
      signal: new AbortController().signal,
      urls: ['https://github.com/slow'],
      connectTimeoutMs: 300,
      stallTimeoutMs: 1000,
      onProgress: (v) => progress.push(v)
    })
    const elapsed = Date.now() - t0
    expect(elapsed).toBeGreaterThan(3 * 300) // the body really outlived the connect timeout
    expect(await readFile(p)).toEqual(body)
    expect(progress.length).toBeGreaterThan(CHUNKS / 2)
    expect(progress.at(-1)).toBe(1)
    expect(await readdir(cacheDir)).toEqual(['isnet-general-use.onnx'])
  })

  it('the connect timeout applies per redirect hop, not to the body after it', async () => {
    resetModelCacheState()
    const cacheDir = join(dir, 'slow-redirect-ok')
    const p = await ensureModel({
      ...base,
      cacheDir,
      signal: new AbortController().signal,
      urls: ['https://github.com/redirect-slow'],
      connectTimeoutMs: 300,
      stallTimeoutMs: 1000
    })
    expect(await readFile(p)).toEqual(body)
  })

  it('a real stall (no data for stallTimeoutMs) still fails, with a timeout message, and leaves no partial file', async () => {
    resetModelCacheState()
    const cacheDir = join(dir, 'stall')
    const t0 = Date.now()
    const err = await ensureModel({
      ...base,
      cacheDir,
      signal: new AbortController().signal,
      urls: ['https://github.com/stall'],
      connectTimeoutMs: 5000,
      stallTimeoutMs: 300
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EngineError)
    expect(err).toMatchObject({ code: 'MODEL_DOWNLOAD_FAILED', message: MODEL_FAILURE_MESSAGES.timeout, detail: expect.stringMatching(/stalled/) })
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(await readdir(cacheDir)).toEqual([])
  })

  it('a server that never sends headers hits the connect timeout', async () => {
    resetModelCacheState()
    const cacheDir = join(dir, 'no-headers')
    const t0 = Date.now()
    await expect(
      ensureModel({ ...base, cacheDir, signal: new AbortController().signal, urls: ['https://github.com/no-headers'], connectTimeoutMs: 300, stallTimeoutMs: 5000 })
    ).rejects.toMatchObject({ code: 'MODEL_DOWNLOAD_FAILED', message: MODEL_FAILURE_MESSAGES.timeout, detail: expect.stringMatching(/no response headers within 300 ms/) })
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(await readdir(cacheDir)).toEqual([])
  })

  it('the user can still cancel while the body is streaming; the partial file is removed', async () => {
    resetModelCacheState()
    const cacheDir = join(dir, 'cancel')
    const ac = new AbortController()
    const p = ensureModel({
      ...base,
      cacheDir,
      signal: ac.signal,
      urls: ['https://github.com/slow'],
      connectTimeoutMs: 300,
      stallTimeoutMs: 5000,
      onProgress: (v) => {
        if (v > 0.2) ac.abort()
      }
    })
    await expect(p).rejects.toMatchObject({ code: 'CANCELLED' })
    await sleep(50) // let the shared download finish its own cleanup
    expect(await readdir(cacheDir)).toEqual([])
  })

  it('an HTTP error says the server is unavailable; a timeout wins over a later source answering 404', async () => {
    resetModelCacheState()
    await expect(
      ensureModel({ ...base, cacheDir: join(dir, 'http'), signal: new AbortController().signal, urls: ['https://github.com/unavailable', 'https://github.com/missing'] })
    ).rejects.toMatchObject({ code: 'MODEL_DOWNLOAD_FAILED', message: MODEL_FAILURE_MESSAGES.http, detail: expect.stringMatching(/HTTP 503.*HTTP 404/) })
    await expect(
      ensureModel({
        ...base,
        cacheDir: join(dir, 'mixed'),
        signal: new AbortController().signal,
        urls: ['https://github.com/stall', 'https://github.com/missing'],
        stallTimeoutMs: 300
      })
    ).rejects.toMatchObject({ code: 'MODEL_DOWNLOAD_FAILED', message: MODEL_FAILURE_MESSAGES.timeout })
    for (const m of Object.values(MODEL_FAILURE_MESSAGES)) expect(m.length).toBeLessThanOrEqual(140) // room for a "file name: " prefix within 200
  })
})
