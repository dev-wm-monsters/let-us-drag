// Engine lifecycle: describePaths, validation (UNSUPPORTED), queueing, cancellation, timeout,
// event shape, the worker protocol and the model manager.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Engine, HostToWorker, WorkerToHost } from '../../src/engine/api'
import { Limiter, createEngine, describePaths } from '../../src/engine/index'
import { validateRequest } from '../../src/engine/registry'
import { createWorkerHandler } from '../../src/engine/worker-protocol'
import { ensureModel, resetModelCacheState } from '../../src/engine/tools/model'
import type { JobEvent, OptionId } from '../../src/shared/types'
import { audioFile, makeTempDir, sharpImage, textFile } from '../helpers/fixtures'
import { fakeHtmlToPdf, runOption } from '../helpers/engine'

let dir = ''
let cleanup: () => Promise<void> = async () => undefined
beforeAll(async () => {
  ;({ dir, cleanup } = await makeTempDir('lud-engine-'))
})
afterAll(() => cleanup())

describe('describePaths', () => {
  it('stats files and folders', async () => {
    const f = await textFile(join(dir, 'Notes.MD'), '# hi')
    await mkdir(join(dir, 'folder.v2'), { recursive: true })
    const items = await describePaths([f, join(dir, 'folder.v2')])
    expect(items).toEqual([
      { path: f, name: 'Notes.MD', ext: 'md', isDirectory: false, sizeBytes: 4 },
      { path: join(dir, 'folder.v2'), name: 'folder.v2', ext: '', isDirectory: true, sizeBytes: 0 }
    ])
  })

  it('rejects relative paths and reports missing files', async () => {
    await expect(describePaths([relative(process.cwd(), join(dir, 'x'))])).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await expect(describePaths(['relative/file.txt'])).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await expect(describePaths([join(dir, 'missing.png')])).rejects.toMatchObject({ code: 'INPUT_NOT_FOUND' })
  })
})

describe('validation against the catalog', () => {
  const item = (ext: string, isDirectory = false) => ({ path: `/x/f.${ext}`, name: `f.${ext}`, ext, isDirectory, sizeBytes: 1 })
  it('accepts offered options only', () => {
    expect(validateRequest({ optionId: 'to-jpg' }, [item('png')])).toBe('image')
    expect(() => validateRequest({ optionId: 'to-png' }, [item('png')])).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED' }))
    expect(() => validateRequest({ optionId: 'to-mp4' }, [item('png')])).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED' }))
    expect(() => validateRequest({ optionId: 'to-png' }, [item('exe')])).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED', message: 'Nope, not eating that.' }))
    expect(validateRequest({ optionId: 'zip' }, [item('png'), item('mp4')])).toBe('unknown')
    expect(() => validateRequest({ optionId: 'to-jpg' }, [item('png'), item('mp4')])).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED' }))
    expect(validateRequest({ optionId: 'zip' }, [item('', true)])).toBe('unknown')
    expect(validateRequest({ optionId: 'unzip' }, [item('zip')])).toBe('archive')
  })

  it('an unsupported request emits queued → error UNSUPPORTED', async () => {
    const f = await sharpImage(join(dir, 'u.png'))
    const res = await runOption('to-mp3', [f])
    expect(res.events.map((e) => e.type)).toEqual(['queued', 'error'])
    expect(res.error?.code).toBe('UNSUPPORTED')
  })

  it('missing input → INPUT_NOT_FOUND', async () => {
    expect((await runOption('to-jpg', [join(dir, 'gone.png')])).error?.code).toBe('INPUT_NOT_FOUND')
  })

  it('malformed requests never throw out of run()', async () => {
    const engine = createEngine(fakeHtmlToPdf(), { cacheDir: dir })
    const events: JobEvent[] = []
    await engine.run({ id: 'bad', optionId: 'to-jpg' as OptionId, inputPaths: 'nope' as unknown as string[] }, (e) => events.push(e), new AbortController().signal)
    expect(events.at(-1)).toMatchObject({ type: 'error', jobId: 'bad', error: { code: 'UNSUPPORTED' } })
  })
})

describe('job lifecycle', () => {
  it('emits queued → progress… → done with ids and 0..1 progress', async () => {
    const f = await sharpImage(join(dir, 'life.png'))
    const res = await runOption('to-webp', [f])
    expect(res.events[0]).toMatchObject({ type: 'queued' })
    expect(res.events.at(-1)).toMatchObject({ type: 'done' })
    const ids = new Set(res.events.map((e) => e.jobId))
    expect(ids.size).toBe(1)
    for (const e of res.events) if (e.type === 'progress') expect(e.progress === -1 || (e.progress >= 0 && e.progress <= 1)).toBe(true)
  })

  it('cancel before start → CANCELLED, nothing written', async () => {
    const f = await sharpImage(join(dir, 'early.png'))
    const ac = new AbortController()
    ac.abort()
    const res = await runOption('to-jpg', [f], { signal: ac.signal })
    expect(res.error?.code).toBe('CANCELLED')
    expect(existsSync(join(dir, 'early.jpg'))).toBe(false)
  })

  it('per-job timeout → TOOL_FAILED with a friendly message, temp files removed', async () => {
    const sub = join(dir, 'timeout')
    const src = await audioFile(join(sub, 'slow.wav'), 60)
    const res = await runOption('to-ogg', [src], { options: { jobTimeoutMs: 150 } })
    expect(res.error?.code).toBe('TOOL_FAILED')
    expect(res.error?.message).toMatch(/too long/)
    expect(await readdir(sub)).toEqual(['slow.wav'])
  })

  it('Limiter runs at most N at once and honours abort while waiting', async () => {
    const lim = new Limiter(1)
    const never = new AbortController().signal
    await lim.acquire(never)
    const ac = new AbortController()
    const waiting = lim.acquire(ac.signal)
    ac.abort()
    await expect(waiting).rejects.toMatchObject({ code: 'CANCELLED' })
    let got = false
    const next = lim.acquire(never).then(() => (got = true))
    await Promise.resolve()
    expect(got).toBe(false)
    lim.release()
    await next
    expect(got).toBe(true)
  })
})

describe('worker protocol', () => {
  function harness(engine: Engine) {
    const sent: WorkerToHost[] = []
    let deliver: (m: HostToWorker) => void = () => undefined
    createWorkerHandler(
      { post: (m) => sent.push(m), onMessage: (cb) => (deliver = cb) },
      () => engine,
      { htmlToPdfTimeoutMs: 100 }
    )
    return { sent, deliver: (m: HostToWorker) => deliver(m) }
  }

  it('posts ready, queues runs until init, forwards events and cancels', async () => {
    let seenSignal: AbortSignal | undefined
    const engine: Engine = {
      run: (req, onEvent, signal) =>
        new Promise<void>((resolve) => {
          seenSignal = signal
          onEvent({ type: 'queued', jobId: req.id })
          signal.addEventListener('abort', () => {
            onEvent({ type: 'error', jobId: req.id, error: { code: 'CANCELLED', message: 'Cancelled.' } })
            resolve()
          })
        })
    }
    const h = harness(engine)
    expect(h.sent).toEqual([{ type: 'ready' }])
    h.deliver({ type: 'run', req: { id: 'j1', optionId: 'zip', inputPaths: ['/a'] } })
    expect(h.sent).toHaveLength(1) // not started before init
    h.deliver({ type: 'init', options: { cacheDir: dir } })
    expect(h.sent[1]).toEqual({ type: 'event', event: { type: 'queued', jobId: 'j1' } })
    h.deliver({ type: 'cancel', jobId: 'j1' })
    await new Promise((r) => setTimeout(r, 0))
    expect(seenSignal?.aborted).toBe(true)
    expect(h.sent[2]).toMatchObject({ type: 'event', event: { type: 'error', error: { code: 'CANCELLED' } } })
  })

  it('offers renderPdfPages only when the host declares it, and proxies it', async () => {
    const sent: WorkerToHost[] = []
    let deliver: (m: HostToWorker) => void = () => undefined
    const seen: (boolean | Promise<Uint8Array[]>)[] = []
    createWorkerHandler({ post: (m) => sent.push(m), onMessage: (cb) => (deliver = cb) }, (adapters) => {
      seen.push(typeof adapters.renderPdfPages === 'function')
      return {
        run: async () => {
          if (adapters.renderPdfPages) seen.push(adapters.renderPdfPages(Uint8Array.from([1]), { scale: 2, maxSide: 10, maxPixels: 100 }))
        }
      }
    })
    deliver({ type: 'init', options: { cacheDir: dir }, hostAdapters: ['renderPdfPages'] })
    expect(seen[0]).toBe(true)
    deliver({ type: 'run', req: { id: 'r', optionId: 'pdf-to-png', inputPaths: ['/a.pdf'] } })
    await new Promise((r) => setTimeout(r, 0))
    const req = sent.find((m) => m.type === 'renderPdf') as Extract<WorkerToHost, { type: 'renderPdf' }>
    expect(req.options).toEqual({ scale: 2, maxSide: 10, maxPixels: 100 })
    deliver({ type: 'renderPdf:result', requestId: req.requestId, pages: [Uint8Array.from([9])] })
    await expect(seen[1]).resolves.toEqual([Uint8Array.from([9])])

    const seen2: boolean[] = []
    createWorkerHandler({ post: () => undefined, onMessage: (cb) => cb({ type: 'init', options: { cacheDir: dir } }) }, (adapters) => {
      seen2.push(typeof adapters.renderPdfPages === 'function')
      return { run: async () => undefined }
    })
    expect(seen2).toEqual([false])
  })

  it('proxies htmlToPdf to the host and times out', async () => {
    let adapterResult: Promise<Uint8Array> | undefined
    const sent: WorkerToHost[] = []
    let deliver: (m: HostToWorker) => void = () => undefined
    createWorkerHandler(
      { post: (m) => sent.push(m), onMessage: (cb) => (deliver = cb) },
      (adapters) => ({
        run: async () => {
          adapterResult = adapters.htmlToPdf('<p>x</p>')
        }
      }),
      { htmlToPdfTimeoutMs: 50 }
    )
    deliver({ type: 'init', options: { cacheDir: dir } })
    deliver({ type: 'run', req: { id: 'p', optionId: 'to-pdf', inputPaths: ['/a.md'] } })
    await new Promise((r) => setTimeout(r, 0))
    const req = sent.find((m) => m.type === 'htmlToPdf')
    expect(req).toMatchObject({ type: 'htmlToPdf', html: '<p>x</p>' })
    deliver({ type: 'htmlToPdf:result', requestId: (req as { requestId: string }).requestId, pdf: Uint8Array.from([37, 80, 68, 70, 45]) })
    await expect(adapterResult).resolves.toEqual(Uint8Array.from([37, 80, 68, 70, 45]))
    // second call: no answer → timeout
    deliver({ type: 'run', req: { id: 'p2', optionId: 'to-pdf', inputPaths: ['/a.md'] } })
    await new Promise((r) => setTimeout(r, 0))
    await expect(adapterResult).rejects.toMatchObject({ code: 'TOOL_FAILED' })
  })
})

describe('model manager', () => {
  const body = Buffer.from('pretend this is an onnx model')
  const sha = createHash('sha256').update(body).digest('hex')
  const okFetch = (async () => new Response(body, { status: 200, headers: { 'content-length': String(body.length) } })) as typeof fetch

  it('downloads, verifies SHA-256, renames atomically and reports progress', async () => {
    resetModelCacheState()
    const cacheDir = join(dir, 'models1')
    const progress: number[] = []
    const p = await ensureModel({ cacheDir, signal: new AbortController().signal, env: {}, fetchImpl: okFetch, urls: ['https://primary/x.onnx'], sha256: sha, onProgress: (v) => progress.push(v) })
    expect(await readFile(p)).toEqual(body)
    expect(progress.at(-1)).toBe(1)
    expect((await readdir(cacheDir)).filter((f) => f.endsWith('.part'))).toEqual([])
    // second call: cached, no network
    const again = await ensureModel({ cacheDir, signal: new AbortController().signal, env: {}, fetchImpl: () => Promise.reject(new Error('no network')), sha256: sha })
    expect(again).toBe(p)
  })

  it('falls back to the upstream URL when the mirror fails or has the wrong bytes', async () => {
    resetModelCacheState()
    const urls: string[] = []
    const fetchImpl = (async (u: string | URL | Request) => {
      urls.push(String(u))
      if (String(u).includes('mirror')) return new Response('wrong bytes', { status: 200 })
      return new Response(body, { status: 200 })
    }) as typeof fetch
    const p = await ensureModel({ cacheDir: join(dir, 'models2'), signal: new AbortController().signal, env: {}, fetchImpl, urls: ['https://mirror/x', 'https://upstream/x'], sha256: sha })
    expect(urls).toEqual(['https://mirror/x', 'https://upstream/x'])
    expect(await readFile(p)).toEqual(body)
  })

  it('MODEL_DOWNLOAD_FAILED when every source fails; nothing half-written remains', async () => {
    resetModelCacheState()
    const cacheDir = join(dir, 'models3')
    const fetchImpl = (async () => new Response('nope', { status: 404 })) as typeof fetch
    await expect(ensureModel({ cacheDir, signal: new AbortController().signal, env: {}, fetchImpl, urls: ['https://a', 'https://b'], sha256: sha })).rejects.toMatchObject({ code: 'MODEL_DOWNLOAD_FAILED' })
    expect(await readdir(cacheDir)).toEqual([])
  })

  it('re-downloads a corrupted cached model', async () => {
    resetModelCacheState()
    const cacheDir = join(dir, 'models4')
    await mkdir(cacheDir, { recursive: true })
    await writeFile(join(cacheDir, 'isnet-general-use.onnx'), 'corrupt')
    const p = await ensureModel({ cacheDir, signal: new AbortController().signal, env: {}, fetchImpl: okFetch, urls: ['https://x'], sha256: sha })
    expect(await readFile(p)).toEqual(body)
  })

  it('LUD_MODEL_PATH overrides the cache (no download)', async () => {
    const local = await textFile(join(dir, 'local.onnx'), 'x')
    await expect(ensureModel({ cacheDir: join(dir, 'unused'), signal: new AbortController().signal, env: { LUD_MODEL_PATH: local } })).resolves.toBe(local)
  })
})
