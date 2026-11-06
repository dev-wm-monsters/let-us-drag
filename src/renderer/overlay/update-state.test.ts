// D29: forced-update lock and the once-per-version soft-update hint in the pure reducer.
import { describe, expect, it } from 'vitest'
import type { LicenceView } from '../../shared/licence'
import type { DroppedItem } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import type { UpdateStatus, UpdateView } from '../../shared/update'
import {
  type Action,
  type Host,
  initialModel,
  isLicenceLocked,
  isLocked,
  lockPanel,
  type Model,
  reducer,
  showsUpdateHint,
  speech,
  wantsInteractive
} from './state'

const upd = (status: UpdateStatus, extra: Partial<UpdateView> = {}): UpdateView => ({
  status,
  currentVersion: '0.1.0',
  latestVersion: status === 'current' ? '0.1.0' : '0.2.0',
  releasedAt: null,
  notes: [],
  dismissed: false,
  hint: status === 'available',
  lastCheckedAt: null,
  ...extra
})
const lic = (status: LicenceView['status']): LicenceView => ({
  status,
  maskedKey: null,
  activatedAt: null,
  lastCheckedAt: null,
  environment: 'test',
  testMode: true,
  teamBuild: false
})
const png: DroppedItem = { path: '/home/u/a.png', name: 'a.png', ext: 'png', isDirectory: false, sizeBytes: 10 }
const probePng = { mimeTypes: ['image/png'], count: 1 }

const run = (m: Model, ...actions: Action[]): Model => actions.reduce(reducer, m)
function start(host: Host, update: UpdateView | null, licence: LicenceView | null = lic('active')): Model {
  let m = initialModel(host, DEFAULT_SETTINGS)
  if (licence) m = reducer(m, { type: 'LICENCE', view: licence })
  if (update) m = reducer(m, { type: 'UPDATE', view: update })
  return m
}

describe('forced update (D29)', () => {
  it('every path leads to the "Please update me" bubble; nothing is eaten', () => {
    const m = run(start('overlay', upd('required')), { type: 'ARM' }, { type: 'ENGAGE', probe: probePng })
    expect(m.state).toBe('locked')
    expect(m.lockReason).toBe('update')
    expect(lockPanel(m)).toBe('update')
    expect(isLocked(m)).toBe(true)
    expect(isLicenceLocked(m)).toBe(false)
    expect(speech(m)).toBeNull()
    expect(m.options).toEqual([])
    // Dropped on an option: still locked, no job.
    const dropped = run(m, { type: 'DROP_START' }, { type: 'DROP_RESOLVED', items: [png], target: 'to-jpg', jobId: 'j1' })
    expect(dropped.state).toBe('locked')
    expect(dropped.job).toBeNull()
    expect(wantsInteractive(dropped)).toBe(true)
    // Esc / × close him.
    expect(run(dropped, { type: 'ESC' }).state).toBe('leave')
  })

  it('wins over a missing licence (updating has to happen first)', () => {
    const m = run(start('overlay', upd('required'), lic('unlicensed')), { type: 'ENGAGE', probe: probePng })
    expect(lockPanel(m)).toBe('update')
    // Once the update lock is gone, the licence lock remains and the bubble switches.
    const next = run(m, { type: 'UPDATE', view: upd('available') })
    expect(next.state).toBe('locked')
    expect(lockPanel(next)).toBe('licence')
  })

  it('main refusing the job (UPDATE_REQUIRED) turns eat into the update bubble', () => {
    const m = run(
      start('overlay', null),
      { type: 'ENGAGE', probe: probePng },
      { type: 'DROP_START' },
      { type: 'DROP_RESOLVED', items: [png], target: 'to-jpg', jobId: 'j1' }
    )
    expect(m.state).toBe('eat')
    const locked = run(m, { type: 'LOCKED', jobId: 'j1', reason: 'update' })
    expect(locked.state).toBe('locked')
    expect(lockPanel(locked)).toBe('update')
    // The fresh state arrives right after: still update.
    expect(lockPanel(run(locked, { type: 'UPDATE', view: upd('required') }))).toBe('update')
  })

  it('a manifest that lowers the minimum unlocks: he leaves (overlay) or rests (feed)', () => {
    const o = run(start('overlay', upd('required')), { type: 'ENGAGE', probe: probePng })
    expect(run(o, { type: 'UPDATE', view: upd('available') }).state).toBe('leave')
    const f = start('feed', upd('required'))
    expect(f.state).toBe('idle')
    expect(lockPanel(f)).toBe('update') // the Feed Window rests on the bubble
    expect(lockPanel(run(f, { type: 'UPDATE', view: upd('current') }))).toBeNull()
  })

  it('a soft update never locks', () => {
    const m = run(start('overlay', upd('available')), { type: 'ENGAGE', probe: probePng })
    expect(m.state).toBe('appear')
    expect(isLocked(m)).toBe(false)
    const eating = run(m, { type: 'DROP_START' }, { type: 'DROP_RESOLVED', items: [png], target: 'to-jpg', jobId: 'j1' })
    expect(eating.state).toBe('eat')
  })
})

describe('soft update hint (D29)', () => {
  it('shows once per session while he offers options or waits, never over held files', () => {
    const m = run(start('overlay', upd('available')), { type: 'ARM' }, { type: 'ENGAGE', probe: probePng })
    expect(m.updateHint).toBe(true)
    expect(showsUpdateHint(m)).toBe(true)
    const held = run(m, { type: 'DROP_START' }, { type: 'DROP_RESOLVED', items: [png], target: 'mouth', jobId: 'j1' })
    expect(held.state).toBe('feedMe')
    expect(showsUpdateHint(held)).toBe(false)
    const eating = run(m, { type: 'DROP_START' }, { type: 'DROP_RESOLVED', items: [png], target: 'to-jpg', jobId: 'j2' })
    expect(showsUpdateHint(eating)).toBe(false)
  })

  it('main clearing the hint keeps it for this session, not the next one', () => {
    const m = run(start('overlay', upd('available')), { type: 'ENGAGE', probe: probePng })
    const seen = run(m, { type: 'UPDATE', view: upd('available', { hint: false }) })
    expect(showsUpdateHint(seen)).toBe(true)
    const next = run(seen, { type: 'DISARM' }, { type: 'LEAVE_DONE' }, { type: 'ARM' }, { type: 'ENGAGE', probe: probePng })
    expect(showsUpdateHint(next)).toBe(false)
  })

  it('no hint when up to date, put off with Later, or locked', () => {
    expect(showsUpdateHint(run(start('overlay', upd('current')), { type: 'ENGAGE', probe: probePng }))).toBe(false)
    expect(showsUpdateHint(run(start('overlay', upd('available', { dismissed: true, hint: false })), { type: 'ENGAGE', probe: probePng }))).toBe(false)
    expect(showsUpdateHint(run(start('overlay', upd('available'), lic('unlicensed')), { type: 'ENGAGE', probe: probePng }))).toBe(false)
  })
})
