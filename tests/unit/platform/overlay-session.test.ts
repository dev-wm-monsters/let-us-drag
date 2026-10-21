import { describe, expect, it } from 'vitest'
import {
  ARMED_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  initialOverlaySession,
  isBusy,
  overlaySessionReducer as reduce,
  RELEASED_TIMEOUT_MS,
  safetyTimeout,
  shouldSendDisarm,
  type OverlaySession,
  type OverlaySessionEvent
} from '../../../src/main/windows/overlay-session'

function run(events: OverlaySessionEvent[], s: OverlaySession = initialOverlaySession()): OverlaySession {
  return events.reduce(reduce, s)
}

describe('overlay session', () => {
  it('follows the documented lifecycle', () => {
    let s = initialOverlaySession()
    s = reduce(s, { type: 'arm', follow: true })
    expect(s.phase).toBe('armed')
    s = reduce(s, { type: 'engaged' })
    expect(s.phase).toBe('engaged')
    const before = s
    s = reduce(s, { type: 'disarm' })
    expect(s.phase).toBe('released')
    expect(shouldSendDisarm(before, s)).toBe(true)
    s = reduce(s, { type: 'done' })
    expect(s).toEqual(initialOverlaySession())
  })

  it('ignores arm while busy, allows re-arm during an idle leave', () => {
    const armed = run([{ type: 'arm', follow: true }])
    expect(reduce(armed, { type: 'arm', follow: false })).toBe(armed)
    const chewing = run([{ type: 'arm', follow: true }, { type: 'jobStarted', jobId: 'j' }, { type: 'disarm' }])
    expect(isBusy(chewing)).toBe(true)
    expect(reduce(chewing, { type: 'arm', follow: true })).toBe(chewing)
    const leaving = run([{ type: 'arm', follow: true }, { type: 'disarm' }])
    expect(isBusy(leaving)).toBe(false)
    expect(reduce(leaving, { type: 'arm', follow: true }).phase).toBe('armed')
  })

  it('a started job implies engagement and is tracked until finished', () => {
    let s = run([{ type: 'arm', follow: true }, { type: 'jobStarted', jobId: 'a' }, { type: 'jobStarted', jobId: 'a' }])
    expect(s.phase).toBe('engaged')
    expect(s.jobs).toEqual(['a'])
    s = reduce(s, { type: 'jobFinished', jobId: 'zzz' })
    expect(s.jobs).toEqual(['a'])
    s = reduce(s, { type: 'jobFinished', jobId: 'a' })
    expect(s.jobs).toEqual([])
  })

  it('hidden ignores everything except arm', () => {
    const h = initialOverlaySession()
    for (const e of [{ type: 'engaged' }, { type: 'disarm' }, { type: 'interactive', value: true }, { type: 'jobStarted', jobId: 'x' }] as OverlaySessionEvent[]) {
      expect(reduce(h, e)).toBe(h)
    }
  })

  it('disarm is sent only once', () => {
    const released = run([{ type: 'arm', follow: true }, { type: 'disarm' }])
    expect(reduce(released, { type: 'disarm' })).toBe(released)
  })

  it('safety timeouts never hide a running conversion', () => {
    expect(safetyTimeout(initialOverlaySession())).toBeNull()
    expect(safetyTimeout(run([{ type: 'arm', follow: true }]))).toEqual({ ms: ARMED_TIMEOUT_MS, action: 'disarm' })
    expect(safetyTimeout(run([{ type: 'arm', follow: true }, { type: 'engaged' }]))).toEqual({ ms: IDLE_TIMEOUT_MS, action: 'hide' })
    expect(safetyTimeout(run([{ type: 'arm', follow: true }, { type: 'jobStarted', jobId: 'j' }, { type: 'disarm' }]))).toBeNull()
    expect(safetyTimeout(run([{ type: 'arm', follow: true }, { type: 'disarm' }]))).toEqual({ ms: RELEASED_TIMEOUT_MS, action: 'hide' })
    expect(
      safetyTimeout(run([{ type: 'arm', follow: true }, { type: 'engaged' }, { type: 'interactive', value: true }, { type: 'disarm' }]))
    ).toEqual({ ms: IDLE_TIMEOUT_MS, action: 'hide' })
  })
})
