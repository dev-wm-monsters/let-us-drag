// D26: the Uncle's locked state (no active licence) in the pure reducer.
import { describe, expect, it } from 'vitest'
import type { LicenceStatus, LicenceView } from '../../shared/licence'
import type { DroppedItem } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import {
  type Action,
  type Host,
  initialModel,
  isLocked,
  type Model,
  reducer,
  showsUnlock,
  speech,
  visibleOptions,
  wantsClickThrough,
  wantsInteractive
} from './state'
import { licenceStatusLabel, licenceSummary } from '../settings/labels'

const view = (status: LicenceStatus): LicenceView => ({
  status,
  maskedKey: status === 'unlicensed' ? null : 'LD7Q-…-1A2B',
  activatedAt: null,
  lastCheckedAt: null,
  environment: 'test',
  testMode: true
})
const png: DroppedItem = { path: '/home/u/a.png', name: 'a.png', ext: 'png', isDirectory: false, sizeBytes: 10 }
const exe: DroppedItem = { path: '/home/u/a.exe', name: 'a.exe', ext: 'exe', isDirectory: false, sizeBytes: 10 }
const probePng = { mimeTypes: ['image/png'], count: 1 }

function run(m: Model, ...actions: Action[]): Model {
  return actions.reduce(reducer, m)
}
function start(host: Host, status: LicenceStatus | null): Model {
  const m = initialModel(host, DEFAULT_SETTINGS)
  return status ? reducer(m, { type: 'LICENCE', view: view(status) }) : m
}

describe('locked state (D26)', () => {
  it('unknown licence counts as unlocked (main still refuses)', () => {
    const m = start('overlay', null)
    expect(isLocked(m)).toBe(false)
    expect(run(m, { type: 'ARM' }, { type: 'ENGAGE', probe: probePng }).state).toBe('appear')
  })

  it.each(['unlicensed', 'disabled', 'reactivate'] as const)('%s: a drag shows the unlock bubble instead of options', (status) => {
    const m = run(start('overlay', status), { type: 'ARM' }, { type: 'ENGAGE', probe: probePng })
    expect(m.state).toBe('locked')
    expect(visibleOptions(m)).toEqual([])
    expect(showsUnlock(m)).toBe(true)
    expect(speech(m)).toBeNull()
    expect(wantsClickThrough(m)).toBe(false)
    // Never steal focus during the OS drag.
    expect(wantsInteractive(m)).toBe(false)
  })

  it('a dropped file is not eaten; the bubble stays clickable after the drop', () => {
    const m = run(
      start('overlay', 'unlicensed'),
      { type: 'ARM' },
      { type: 'ENGAGE', probe: probePng },
      { type: 'DROP_START' },
      { type: 'DROP_RESOLVED', items: [png], target: 'to-jpg', jobId: 'j1' }
    )
    expect(m.state).toBe('locked')
    expect(m.job).toBeNull()
    expect(m.lockSettled).toBe(true)
    expect(wantsInteractive(m)).toBe(true)
  })

  it('blocked files lead to the unlock bubble too (every path)', () => {
    const m = run(start('overlay', 'unlicensed'), { type: 'ARM' }, { type: 'ENGAGE', probe: { mimeTypes: ['application/x-msdownload'], count: 1 } })
    expect(m.state).toBe('locked')
    const fed = run(start('feed', 'unlicensed'), { type: 'DROP_START' }, { type: 'DROP_RESOLVED', items: [exe], target: 'mouth', jobId: 'j' })
    expect(fed.state).toBe('locked')
  })

  it('mouse-up keeps the bubble (settled), × / Esc close him', () => {
    const m = run(start('overlay', 'unlicensed'), { type: 'ARM' }, { type: 'ENGAGE', probe: probePng }, { type: 'DISARM' })
    expect(m.state).toBe('locked')
    expect(m.lockSettled).toBe(true)
    const closed = run(m, { type: 'ESC' })
    expect(closed.state).toBe('leave')
    expect(run(closed, { type: 'LEAVE_DONE' }).state).toBe('hidden')
  })

  it('Feed Window rests on the unlock bubble; Esc returns to idle (still showing it)', () => {
    const idle = start('feed', 'unlicensed')
    expect(idle.state).toBe('idle')
    expect(showsUnlock(idle)).toBe(true)
    expect(speech(idle)).toBeNull()
    const m = run(idle, { type: 'ENGAGE', probe: probePng })
    expect(m.state).toBe('locked')
    expect(run(m, { type: 'ESC' }).state).toBe('idle')
    expect(run(m, { type: 'DRAG_CANCEL' }).state).toBe('idle')
  })

  it('activating while the bubble is shown: he leaves (overlay) / rests unlocked (feed)', () => {
    const o = run(start('overlay', 'unlicensed'), { type: 'ARM' }, { type: 'ENGAGE', probe: probePng }, { type: 'LICENCE', view: view('active') })
    expect(o.state).toBe('leave')
    const f = run(start('feed', 'unlicensed'), { type: 'ENGAGE', probe: probePng }, { type: 'LICENCE', view: view('active') })
    expect(f.state).toBe('idle')
    expect(showsUnlock(f)).toBe(false)
    expect(speech(f)).toBe('Drop a file on me!')
  })

  it('main refusing the job (LICENCE_REQUIRED) turns eat into the unlock bubble', () => {
    const eating = run(start('overlay', 'active'), { type: 'ARM' }, { type: 'ENGAGE', probe: probePng }, { type: 'DROP_START' }, {
      type: 'DROP_RESOLVED',
      items: [png],
      target: 'to-jpg',
      jobId: 'j1'
    })
    expect(eating.state).toBe('eat')
    expect(run(eating, { type: 'LOCKED', jobId: 'other' }).state).toBe('eat')
    const locked = run(eating, { type: 'LOCKED', jobId: 'j1' })
    expect(locked.state).toBe('locked')
    expect(locked.job).toBeNull()
    expect(locked.lockSettled).toBe(true)
  })

  it('a licence that turns disabled while files are held locks the choice', () => {
    const held = run(start('feed', 'active'), { type: 'DROP_START' }, { type: 'DROP_RESOLVED', items: [png], target: 'mouth', jobId: 'j' })
    expect(held.state).toBe('feedMe')
    const m = run(held, { type: 'LICENCE', view: view('disabled') }, { type: 'CHOOSE', optionId: 'to-jpg', jobId: 'j2' })
    expect(m.state).toBe('locked')
    expect(m.job).toBeNull()
  })

  it('licence survives rest() and new arms', () => {
    const m = run(start('overlay', 'disabled'), { type: 'ARM' }, { type: 'ENGAGE', probe: probePng }, { type: 'ESC' }, { type: 'LEAVE_DONE' }, { type: 'ARM' })
    expect(m.licence?.status).toBe('disabled')
  })
})

describe('Settings licence labels (D26)', () => {
  it('status pills', () => {
    expect(licenceStatusLabel('active')).toEqual({ text: 'Active', tone: 'ok' })
    expect(licenceStatusLabel('unlicensed')).toEqual({ text: 'Not activated', tone: 'warn' })
    expect(licenceStatusLabel('disabled')).toEqual({ text: 'Disabled', tone: 'bad' })
    expect(licenceStatusLabel('reactivate').tone).toBe('warn')
  })
  it('summary lines', () => {
    expect(licenceSummary({ status: 'active', maskedKey: 'x', activatedAt: '2026-10-30T09:12:00.000Z' }, 'en-GB')).toBe(
      'Activated on this computer on 30 Oct 2026. Works on 2 computers, all v1.x updates included.'
    )
    expect(licenceSummary({ status: 'unlicensed', maskedKey: null, activatedAt: null })).toContain('One-time purchase')
    expect(licenceSummary({ status: 'disabled', maskedKey: 'x', activatedAt: null })).toBe('')
  })
})
