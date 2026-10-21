import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { HostToWorker } from '../../../src/engine/api'
import {
  CANCEL_GRACE_MS,
  CANCELLED_ERROR,
  CRASH_ERROR,
  EngineHost,
  HUNG_ERROR,
  JOB_HARD_TIMEOUT_MS,
  MAX_RESTARTS,
  RESTARTED_ERROR,
  UNAVAILABLE_ERROR,
  type EngineHostDeps,
  type WorkerLike
} from '../../../src/main/engine-host'
import type { JobEvent, JobRequest } from '../../../src/shared/types'

class FakeWorker extends EventEmitter implements WorkerLike {
  sent: HostToWorker[] = []
  killed = false
  postMessage(m: HostToWorker): void {
    this.sent.push(m)
  }
  kill(): boolean {
    this.killed = true
    return true
  }
  fromWorker(m: unknown): void {
    this.emit('message', m)
  }
  crash(code = 1): void {
    this.emit('exit', code)
  }
}

interface FakeTimer {
  id: number
  fn: () => void
  ms: number
  at: number
}

function setup(opts: { htmlToPdf?: (html: string) => Promise<Uint8Array>; renderPdfPages?: EngineHostDeps['renderPdfPages'] } = {}) {
  const workers: FakeWorker[] = []
  const events: JobEvent[] = []
  /** Live (not cleared, not fired) timers. */
  const timers: FakeTimer[] = []
  let now = 0
  let nextId = 1
  const host = new EngineHost({
    fork: () => {
      const w = new FakeWorker()
      workers.push(w)
      return w
    },
    options: { cacheDir: '/tmp/cache', resourcesDir: '/tmp/res' },
    htmlToPdf: opts.htmlToPdf ?? (async () => new Uint8Array([37, 80, 68, 70])),
    ...(opts.renderPdfPages ? { renderPdfPages: opts.renderPdfPages } : {}),
    onEvent: (e) => events.push(e),
    setTimer: (fn, ms) => {
      const t = { id: nextId++, fn, ms, at: now + ms }
      timers.push(t)
      return t.id
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h)
      if (i >= 0) timers.splice(i, 1)
    },
    now: () => now
  })
  /** Advance the fake clock, firing due timers in order. */
  const advance = (ms: number): void => {
    const target = now + ms
    for (;;) {
      const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      timers.splice(timers.indexOf(due), 1)
      now = due.at
      due.fn()
    }
    now = target
  }
  return {
    host,
    workers,
    events,
    timers,
    advance,
    /** Restart timers currently scheduled (crash recovery). */
    restartTimers: () => timers.filter((t) => t.ms < CANCEL_GRACE_MS),
    /** Fire only the crash-restart timers (not the job watchdogs). */
    runTimers: () => {
      for (const t of timers.filter((x) => x.ms < CANCEL_GRACE_MS)) {
        timers.splice(timers.indexOf(t), 1)
        t.fn()
      }
    }
  }
}

const req = (id: string): JobRequest => ({ id, optionId: 'to-png', inputPaths: ['/tmp/a.jpg'] })

describe('EngineHost', () => {
  it('sends init first and queues runs until ready', () => {
    const { host, workers } = setup()
    host.start()
    const w = workers[0]!
    expect(w.sent).toEqual([{ type: 'init', options: { cacheDir: '/tmp/cache', resourcesDir: '/tmp/res' } }])
    host.run(req('j1'))
    expect(w.sent).toHaveLength(1)
    w.fromWorker({ type: 'ready' })
    expect(w.sent[1]).toEqual({ type: 'run', req: req('j1') })
    host.run(req('j2'))
    expect(w.sent[2]).toEqual({ type: 'run', req: req('j2') })
    expect(host.isReady).toBe(true)
  })

  it('forwards valid job events and forgets finished jobs', () => {
    const { host, workers, events } = setup()
    host.start()
    const w = workers[0]!
    w.fromWorker({ type: 'ready' })
    host.run(req('j1'))
    w.fromWorker({ type: 'event', event: { type: 'queued', jobId: 'j1' } })
    w.fromWorker({ type: 'event', event: { type: 'progress', jobId: 'j1', progress: 0.5 } })
    w.fromWorker({ type: 'event', event: { type: 'done', jobId: 'j1', outputPaths: ['/tmp/a.png'] } })
    expect(events.map((e) => e.type)).toEqual(['queued', 'progress', 'done'])
    expect(host.isInFlight('j1')).toBe(false)
    // events for finished / unknown jobs are dropped
    w.fromWorker({ type: 'event', event: { type: 'progress', jobId: 'j1', progress: 1 } })
    w.fromWorker({ type: 'event', event: { type: 'done', jobId: 'nope', outputPaths: [] } })
    expect(events).toHaveLength(3)
  })

  it('ignores malformed worker messages', () => {
    const { host, workers, events } = setup()
    host.start()
    const w = workers[0]!
    w.fromWorker({ type: 'ready' })
    host.run(req('j1'))
    w.fromWorker(null)
    w.fromWorker({ type: 'event', event: { type: 'done', jobId: 'j1' } }) // missing outputPaths
    w.fromWorker({ type: 'event', event: { type: 'error', jobId: 'j1', error: { code: 'NOPE', message: 'x' } } })
    w.fromWorker({ type: 'bogus' })
    expect(events).toEqual([])
    expect(host.isInFlight('j1')).toBe(true)
  })

  it('rejects a duplicate job id while it is running', () => {
    const { host, workers } = setup()
    host.start()
    workers[0]!.fromWorker({ type: 'ready' })
    host.run(req('j1'))
    expect(() => host.run(req('j1'))).toThrow()
  })

  it('cancels a pending job locally and a dispatched job via the worker', () => {
    const { host, workers, events } = setup()
    host.start()
    const w = workers[0]!
    host.run(req('p1'))
    host.cancel('p1')
    expect(events).toEqual([{ type: 'error', jobId: 'p1', error: { code: 'CANCELLED', message: 'Cancelled.' } }])
    w.fromWorker({ type: 'ready' })
    expect(w.sent.filter((m) => m.type === 'run')).toHaveLength(0)
    host.run(req('d1'))
    host.cancel('d1')
    expect(w.sent.at(-1)).toEqual({ type: 'cancel', jobId: 'd1' })
    host.cancel('unknown') // no-op
    expect(w.sent.at(-1)).toEqual({ type: 'cancel', jobId: 'd1' })
  })

  it('answers htmlToPdf requests through the adapter', async () => {
    const { host, workers } = setup()
    host.start()
    const w = workers[0]!
    w.fromWorker({ type: 'htmlToPdf', requestId: 'r1', html: '<p>hi</p>' })
    await vi.waitFor(() => expect(w.sent.at(-1)).toMatchObject({ type: 'htmlToPdf:result', requestId: 'r1' }))
    const reply = w.sent.at(-1) as Extract<HostToWorker, { type: 'htmlToPdf:result' }>
    expect(Array.from(reply.pdf!)).toEqual([37, 80, 68, 70])
  })

  it('reports htmlToPdf adapter failures as an error string', async () => {
    const { host, workers } = setup({ htmlToPdf: async () => Promise.reject(new Error('boom')) })
    host.start()
    const w = workers[0]!
    w.fromWorker({ type: 'htmlToPdf', requestId: 'r2', html: '' })
    await vi.waitFor(() => expect(w.sent.at(-1)).toEqual({ type: 'htmlToPdf:result', requestId: 'r2', error: 'boom' }))
  })

  it('fails in-flight jobs with INTERNAL on crash and restarts the worker', () => {
    const { host, workers, events, restartTimers, runTimers } = setup()
    host.start()
    workers[0]!.fromWorker({ type: 'ready' })
    host.run(req('j1'))
    host.run(req('j2'))
    workers[0]!.crash()
    expect(events).toEqual([
      { type: 'error', jobId: 'j1', error: CRASH_ERROR },
      { type: 'error', jobId: 'j2', error: CRASH_ERROR }
    ])
    expect(host.isReady).toBe(false)
    expect(restartTimers()).toHaveLength(1)
    // a job submitted while restarting waits for the new worker
    host.run(req('j3'))
    runTimers()
    expect(workers).toHaveLength(2)
    const w2 = workers[1]!
    expect(w2.sent[0]?.type).toBe('init')
    w2.fromWorker({ type: 'ready' })
    expect(w2.sent[1]).toEqual({ type: 'run', req: req('j3') })
    // messages from the dead worker are ignored
    workers[0]!.fromWorker({ type: 'event', event: { type: 'done', jobId: 'j3', outputPaths: [] } })
    expect(host.isInFlight('j3')).toBe(true)
  })

  it('gives up after too many crashes, fails pending jobs, and retries on the next job', () => {
    const { host, workers, events, runTimers } = setup()
    host.start()
    host.run(req('pending'))
    for (let i = 0; i <= MAX_RESTARTS; i++) {
      workers.at(-1)!.crash()
      runTimers()
    }
    expect(events).toEqual([{ type: 'error', jobId: 'pending', error: UNAVAILABLE_ERROR }])
    const count = workers.length
    host.run(req('again'))
    expect(workers.length).toBe(count + 1)
  })

  it('does not restart after stop()', () => {
    const { host, workers, timers, events } = setup()
    host.start()
    workers[0]!.fromWorker({ type: 'ready' })
    host.run(req('j1'))
    expect(timers).toHaveLength(1) // the job's watchdog
    host.stop()
    expect(workers[0]!.killed).toBe(true)
    workers[0]!.crash()
    expect(timers).toHaveLength(0)
    host.run(req('late'))
    expect(events.at(-1)).toEqual({ type: 'error', jobId: 'late', error: UNAVAILABLE_ERROR })
  })

  it('restarts when fork itself throws', () => {
    let calls = 0
    const timers: (() => void)[] = []
    const host = new EngineHost({
      fork: () => {
        calls++
        throw new Error('no worker')
      },
      options: { cacheDir: '/c' },
      htmlToPdf: async () => new Uint8Array(),
      onEvent: () => undefined,
      setTimer: (fn) => timers.push(fn),
      clearTimer: () => undefined
    })
    host.start()
    expect(calls).toBe(1)
    expect(timers).toHaveLength(1)
  })

  it('declares renderPdfPages in init and answers renderPdf requests', async () => {
    const seen: { bytes: number[]; scale: number; aborted: boolean }[] = []
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
    const { host, workers } = setup({
      renderPdfPages: async (pdf, o, signal) => {
        seen.push({ bytes: Array.from(pdf), scale: o.scale, aborted: signal.aborted })
        return [png, png]
      }
    })
    host.start()
    const w = workers[0]!
    expect(w.sent[0]).toEqual({ type: 'init', options: { cacheDir: '/tmp/cache', resourcesDir: '/tmp/res' }, hostAdapters: ['renderPdfPages'] })
    w.fromWorker({ type: 'renderPdf', requestId: 'p1', pdf: new Uint8Array([37, 80]), options: { scale: 2, maxSide: 100, maxPixels: 1000 } })
    await vi.waitFor(() => expect(w.sent.at(-1)).toMatchObject({ type: 'renderPdf:result', requestId: 'p1' }))
    const reply = w.sent.at(-1) as Extract<HostToWorker, { type: 'renderPdf:result' }>
    expect(reply.pages).toHaveLength(2)
    expect(seen).toEqual([{ bytes: [37, 80], scale: 2, aborted: false }])
  })

  it('reports renderPdf failures and rejects malformed renderPdf requests', async () => {
    const { host, workers } = setup({ renderPdfPages: async () => Promise.reject(new Error('bad pdf')) })
    host.start()
    const w = workers[0]!
    w.fromWorker({ type: 'renderPdf', requestId: 'p2', pdf: 'not bytes', options: { scale: 2, maxSide: 1, maxPixels: 1 } })
    w.fromWorker({ type: 'renderPdf', requestId: 'p3', pdf: new Uint8Array([1]), options: { scale: 2, maxSide: 1, maxPixels: 1 } })
    await vi.waitFor(() => expect(w.sent.at(-1)).toEqual({ type: 'renderPdf:result', requestId: 'p3', error: 'bad pdf' }))
    expect(w.sent.filter((m) => m.type === 'renderPdf:result')).toHaveLength(1)
  })

  it('without the adapter, init declares nothing and renderPdf requests fail', async () => {
    const { host, workers } = setup()
    host.start()
    const w = workers[0]!
    expect(w.sent[0]).toEqual({ type: 'init', options: { cacheDir: '/tmp/cache', resourcesDir: '/tmp/res' } })
    w.fromWorker({ type: 'renderPdf', requestId: 'p4', pdf: new Uint8Array([1]), options: { scale: 2, maxSide: 1, maxPixels: 1 } })
    await vi.waitFor(() => expect(w.sent.at(-1)).toMatchObject({ type: 'renderPdf:result', requestId: 'p4', error: expect.any(String) }))
  })

  it('aborts adapter work when the worker dies', async () => {
    let signal: AbortSignal | null = null
    const { host, workers } = setup({
      renderPdfPages: (_pdf, _o, s) => {
        signal = s
        return new Promise(() => undefined)
      }
    })
    host.start()
    workers[0]!.fromWorker({ type: 'renderPdf', requestId: 'p5', pdf: new Uint8Array([1]), options: { scale: 2, maxSide: 1, maxPixels: 1 } })
    expect(signal!.aborted).toBe(false)
    workers[0]!.crash()
    expect(signal!.aborted).toBe(true)
  })

  it('watchdog: a cancelled job that does not stop within the grace period kills and restarts the worker', () => {
    const { host, workers, events, advance } = setup()
    host.start()
    const w = workers[0]!
    w.fromWorker({ type: 'ready' })
    host.run(req('stuck'))
    host.run(req('other'))
    w.fromWorker({ type: 'event', event: { type: 'progress', jobId: 'stuck', progress: 0 } })
    host.cancel('stuck')
    host.cancel('stuck') // a second cancel does not extend the grace period
    expect(w.sent.filter((m) => m.type === 'cancel')).toHaveLength(2)
    advance(CANCEL_GRACE_MS - 1)
    expect(w.killed).toBe(false)
    advance(1)
    expect(w.killed).toBe(true)
    expect(events).toEqual([
      { type: 'progress', jobId: 'stuck', progress: 0 },
      { type: 'error', jobId: 'stuck', error: CANCELLED_ERROR },
      { type: 'error', jobId: 'other', error: RESTARTED_ERROR }
    ])
    // restarted immediately (not counted as a crash), and the old worker is ignored
    expect(workers).toHaveLength(2)
    expect(workers[1]!.sent[0]?.type).toBe('init')
    w.crash()
    w.fromWorker({ type: 'event', event: { type: 'done', jobId: 'stuck', outputPaths: [] } })
    expect(events).toHaveLength(3)
    workers[1]!.fromWorker({ type: 'ready' })
    host.run(req('stuck')) // the id is free again
    expect(workers[1]!.sent.at(-1)).toEqual({ type: 'run', req: req('stuck') })
  })

  it('watchdog: a cancelled job that stops in time does not trigger a restart', () => {
    const { host, workers, events, advance, timers } = setup()
    host.start()
    const w = workers[0]!
    w.fromWorker({ type: 'ready' })
    host.run(req('j1'))
    host.cancel('j1')
    w.fromWorker({ type: 'event', event: { type: 'error', jobId: 'j1', error: CANCELLED_ERROR } })
    expect(timers).toHaveLength(0)
    advance(JOB_HARD_TIMEOUT_MS * 2)
    expect(w.killed).toBe(false)
    expect(events).toEqual([{ type: 'error', jobId: 'j1', error: CANCELLED_ERROR }])
  })

  it('watchdog: a job running longer than the hard timeout kills and restarts the worker', () => {
    const { host, workers, events, advance } = setup()
    host.start()
    const w = workers[0]!
    w.fromWorker({ type: 'ready' })
    host.run(req('long'))
    advance(1_000)
    w.fromWorker({ type: 'event', event: { type: 'progress', jobId: 'long', progress: 0 } }) // starts now
    advance(JOB_HARD_TIMEOUT_MS - 1)
    expect(w.killed).toBe(false)
    advance(1)
    expect(w.killed).toBe(true)
    expect(events.at(-1)).toEqual({ type: 'error', jobId: 'long', error: HUNG_ERROR })
    expect(workers).toHaveLength(2)
  })

  it('watchdog: jobs waiting inside a live worker are not timed out while it keeps talking', () => {
    const { host, workers, events, advance } = setup()
    host.start()
    const w = workers[0]!
    w.fromWorker({ type: 'ready' })
    host.run(req('running'))
    host.run(req('waiting'))
    w.fromWorker({ type: 'event', event: { type: 'progress', jobId: 'running', progress: 0 } })
    for (let i = 0; i < 20; i++) {
      advance(JOB_HARD_TIMEOUT_MS / 20 - 10)
      w.fromWorker({ type: 'event', event: { type: 'progress', jobId: 'running', progress: i / 20 } })
    }
    w.fromWorker({ type: 'event', event: { type: 'done', jobId: 'running', outputPaths: ['/tmp/x'] } })
    w.fromWorker({ type: 'event', event: { type: 'progress', jobId: 'waiting', progress: 0 } })
    expect(w.killed).toBe(false)
    w.fromWorker({ type: 'event', event: { type: 'done', jobId: 'waiting', outputPaths: ['/tmp/y'] } })
    expect(events.filter((e) => e.type === 'error')).toEqual([])
  })

  it('a crash after a cancel reports CANCELLED for that job', () => {
    const { host, workers, events } = setup()
    host.start()
    workers[0]!.fromWorker({ type: 'ready' })
    host.run(req('c1'))
    host.cancel('c1')
    workers[0]!.crash()
    expect(events).toEqual([{ type: 'error', jobId: 'c1', error: CANCELLED_ERROR }])
  })
})
