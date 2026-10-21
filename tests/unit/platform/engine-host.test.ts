import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { HostToWorker } from '../../../src/engine/api'
import { CRASH_ERROR, EngineHost, MAX_RESTARTS, UNAVAILABLE_ERROR, type WorkerLike } from '../../../src/main/engine-host'
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

function setup(opts: { htmlToPdf?: (html: string) => Promise<Uint8Array> } = {}) {
  const workers: FakeWorker[] = []
  const events: JobEvent[] = []
  const timers: { fn: () => void; ms: number }[] = []
  let now = 0
  const host = new EngineHost({
    fork: () => {
      const w = new FakeWorker()
      workers.push(w)
      return w
    },
    options: { cacheDir: '/tmp/cache', resourcesDir: '/tmp/res' },
    htmlToPdf: opts.htmlToPdf ?? (async () => new Uint8Array([37, 80, 68, 70])),
    onEvent: (e) => events.push(e),
    setTimer: (fn, ms) => {
      timers.push({ fn, ms })
      return timers.length
    },
    clearTimer: () => undefined,
    now: () => now
  })
  return {
    host,
    workers,
    events,
    timers,
    advance: (ms: number) => {
      now += ms
    },
    runTimers: () => {
      const t = timers.splice(0)
      for (const x of t) x.fn()
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
    const { host, workers, events, timers, runTimers } = setup()
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
    expect(timers).toHaveLength(1)
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
})
