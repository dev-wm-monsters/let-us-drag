import { describe, expect, it } from 'vitest'
import type { DroppedItem, JobEvent, Settings } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { type Action, initialModel, isBusy, type Model, reducer, speech, visibleOptions, wantsInteractive } from './state'

const item = (name: string, extra: Partial<DroppedItem> = {}): DroppedItem => {
  const dot = name.lastIndexOf('.')
  return {
    path: `/home/u/${name}`,
    name,
    ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : '',
    isDirectory: false,
    sizeBytes: 2048,
    ...extra
  }
}

const run = (m: Model, ...actions: Action[]): Model => actions.reduce(reducer, m)
const png: Action = { type: 'ENGAGE', probe: { mimeTypes: ['image/png'], count: 1 } }
const ev = (e: JobEvent): Action => ({ type: 'JOB_EVENT', event: e })

describe('overlay state machine', () => {
  it('starts hidden (overlay) / idle (feed)', () => {
    expect(initialModel('overlay').state).toBe('hidden')
    expect(initialModel('feed').state).toBe('idle')
    expect(speech(initialModel('feed'))).toBe('Drop a file on me!')
  })

  it('engage with a known MIME → appear with options; hover toggles hover state', () => {
    let m = run(initialModel('overlay'), png)
    expect(m.state).toBe('appear')
    expect(visibleOptions(m).map((o) => o.id)).toContain('to-jpg')
    expect(m.session).toBe(1)
    m = reducer(m, { type: 'HOVER', optionId: 'to-jpg' })
    expect(m.state).toBe('hover')
    expect(m.hovered).toBe('to-jpg')
    // Hovering something that is not offered is ignored.
    m = reducer(m, { type: 'HOVER', optionId: 'unzip' })
    expect(m.state).toBe('appear')
    expect(m.hovered).toBeNull()
  })

  it('repeated dragenter does not restart the session', () => {
    const m = run(initialModel('overlay'), png, png)
    expect(m.session).toBe(1)
  })

  it('unknown or mixed MIME → feedMe with no options until dropped', () => {
    for (const mimeTypes of [[''], ['image/png', 'video/mp4'], []]) {
      const m = reducer(initialModel('overlay'), { type: 'ENGAGE', probe: { mimeTypes, count: mimeTypes.length } })
      expect(m.state).toBe('feedMe')
      expect(visibleOptions(m)).toEqual([])
      expect(speech(m)).toBe('Feed me!')
      expect(wantsInteractive(m)).toBe(false)
    }
  })

  it('blocked MIME → refuse', () => {
    const m = reducer(initialModel('overlay'), {
      type: 'ENGAGE',
      probe: { mimeTypes: ['application/x-msdownload'], count: 1 }
    })
    expect(m.state).toBe('refuse')
    expect(speech(m)).toBe('Nope, not eating that.')
  })

  it('drop on a valid option → eat → chew → (min chew) → spit', () => {
    let m = run(initialModel('overlay'), png, { type: 'DROP_START' }, {
      type: 'DROP_RESOLVED',
      items: [item('cat.png')],
      target: 'to-jpg',
      jobId: 'j1'
    })
    expect(m.state).toBe('eat')
    expect(m.job).toEqual({ id: 'j1', optionId: 'to-jpg', inputPaths: ['/home/u/cat.png'] })
    expect(isBusy(m)).toBe(true)
    m = run(m, { type: 'EAT_DONE' }, ev({ type: 'progress', jobId: 'j1', progress: 0.5 }))
    expect(m.state).toBe('chew')
    expect(m.progress).toBe(0.5)
    // Job finishes before the minimum chew time: keep chewing.
    m = reducer(m, ev({ type: 'done', jobId: 'j1', outputPaths: ['/home/u/cat.jpg'] }))
    expect(m.state).toBe('chew')
    m = reducer(m, { type: 'MIN_CHEW_ELAPSED' })
    expect(m.state).toBe('spit')
    expect(m.outputPaths).toEqual(['/home/u/cat.jpg'])
    expect(wantsInteractive(m)).toBe(true)
    m = run(m, { type: 'LEAVE' })
    expect(m.state).toBe('leave')
    m = reducer(m, { type: 'LEAVE_DONE' })
    expect(m.state).toBe('hidden')
    expect(m.job).toBeNull()
  })

  it('hungry mode skips the minimum chew', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, hungryMode: true }
    const m = run(
      initialModel('overlay', settings),
      png,
      { type: 'DROP_RESOLVED', items: [item('cat.png')], target: 'to-webp', jobId: 'j' },
      ev({ type: 'done', jobId: 'j', outputPaths: ['/o.webp'] }),
      { type: 'EAT_DONE' }
    )
    expect(m.state).toBe('spit')
  })

  it('job error → choke with friendly message', () => {
    const m = run(
      initialModel('overlay'),
      png,
      { type: 'DROP_RESOLVED', items: [item('cat.png')], target: 'to-jpg', jobId: 'j' },
      { type: 'EAT_DONE' },
      { type: 'MIN_CHEW_ELAPSED' },
      ev({ type: 'error', jobId: 'j', error: { code: 'INPUT_INVALID', message: '' } })
    )
    expect(m.state).toBe('choke')
    expect(m.message).toMatch(/broken/)
  })

  it('ignores job events for other jobs', () => {
    const m = run(
      initialModel('overlay'),
      png,
      { type: 'DROP_RESOLVED', items: [item('cat.png')], target: 'to-jpg', jobId: 'j' },
      { type: 'EAT_DONE' },
      { type: 'MIN_CHEW_ELAPSED' },
      ev({ type: 'done', jobId: 'other', outputPaths: ['/x'] })
    )
    expect(m.state).toBe('chew')
  })

  it('drop on an option that is invalid for the real extension → feedMe with held items', () => {
    // Dragging a PNG: "to-png" is hidden after the drop (no-op), so the drop falls back to feedMe.
    let m = run(initialModel('overlay'), png, {
      type: 'DROP_RESOLVED',
      items: [item('cat.png')],
      target: 'to-png',
      jobId: 'j'
    })
    expect(m.state).toBe('feedMe')
    expect(m.held).toHaveLength(1)
    expect(visibleOptions(m).map((o) => o.id)).not.toContain('to-png')
    expect(wantsInteractive(m)).toBe(true)
    expect(speech(m)).toBe('Pick one!')
    m = reducer(m, { type: 'CHOOSE', optionId: 'to-avif', jobId: 'j2' })
    expect(m.state).toBe('eat')
    expect(m.job?.optionId).toBe('to-avif')
    expect(m.eatenFrom).toBe('to-avif')
  })

  it('feedMe: drop on the mouth holds items; choosing an unavailable option is ignored', () => {
    let m = run(
      initialModel('overlay'),
      { type: 'ENGAGE', probe: { mimeTypes: [''], count: 1 } },
      { type: 'DROP_RESOLVED', items: [item('notes.md')], target: 'mouth', jobId: 'j' }
    )
    expect(m.state).toBe('feedMe')
    expect(visibleOptions(m).map((o) => o.id)).toEqual(['to-pdf', 'to-html', 'to-docx', 'to-txt', 'zip'])
    m = reducer(m, { type: 'CHOOSE', optionId: 'to-mp4', jobId: 'x' })
    expect(m.state).toBe('feedMe')
    // Disarm (mouse released) must not drop the held file.
    m = reducer(m, { type: 'DISARM' })
    expect(m.state).toBe('feedMe')
    // Esc cancels.
    m = reducer(m, { type: 'ESC' })
    expect(m.state).toBe('leave')
  })

  it('dropped blocked file → refuse; empty → choke', () => {
    const r = run(initialModel('overlay'), png, {
      type: 'DROP_RESOLVED',
      items: [item('setup.exe')],
      target: 'to-jpg',
      jobId: 'j'
    })
    expect(r.state).toBe('refuse')
    const c = run(initialModel('overlay'), png, { type: 'DROP_RESOLVED', items: [], target: null, jobId: 'j' })
    expect(c.state).toBe('choke')
  })

  it('hamster for >=3 files and struggle for >200MB', () => {
    const m = run(
      initialModel('overlay'),
      { type: 'ENGAGE', probe: { mimeTypes: ['image/png', 'image/png', 'image/png'], count: 3 } },
      {
        type: 'DROP_RESOLVED',
        items: [item('a.png'), item('b.png'), item('c.png', { sizeBytes: 300 * 1024 * 1024 })],
        target: 'to-jpg',
        jobId: 'j'
      }
    )
    expect(m.hamster).toBe(true)
    expect(m.struggle).toBe(true)
  })

  it('disarm leaves when nothing is in progress, but not after a drop started', () => {
    expect(run(initialModel('overlay'), png, { type: 'DISARM' }).state).toBe('leave')
    expect(run(initialModel('overlay'), png, { type: 'DROP_START' }, { type: 'DISARM' }).state).toBe('appear')
    const chewing = run(
      initialModel('overlay'),
      png,
      { type: 'DROP_RESOLVED', items: [item('a.png')], target: 'to-jpg', jobId: 'j' },
      { type: 'EAT_DONE' },
      { type: 'DISARM' }
    )
    expect(chewing.state).toBe('chew')
    expect(run(initialModel('overlay'), { type: 'DISARM' }).state).toBe('hidden')
  })

  it('Esc while chewing leaves (controller cancels the job); late events are ignored', () => {
    let m = run(
      initialModel('overlay'),
      png,
      { type: 'DROP_RESOLVED', items: [item('a.png')], target: 'to-jpg', jobId: 'j' },
      { type: 'EAT_DONE' },
      { type: 'ESC' }
    )
    expect(m.state).toBe('leave')
    m = reducer(m, ev({ type: 'error', jobId: 'j', error: { code: 'CANCELLED', message: '' } }))
    expect(m.state).toBe('leave')
  })

  it('arm never interrupts a meal, but resets a finished session', () => {
    const chewing = run(
      initialModel('overlay'),
      png,
      { type: 'DROP_RESOLVED', items: [item('a.png')], target: 'to-jpg', jobId: 'j' },
      { type: 'ARM' }
    )
    expect(chewing.state).toBe('eat')
    const refused = run(initialModel('overlay'), { type: 'ENGAGE', probe: { mimeTypes: ['application/x-sh'], count: 1 } }, {
      type: 'ARM',
      settings: { ...DEFAULT_SETTINGS, plainMode: true }
    })
    expect(refused.state).toBe('hidden')
    expect(refused.settings.plainMode).toBe(true)
  })

  it('feed window: drag cancel returns to idle; test-drop style resolve from rest works', () => {
    let m = run(initialModel('feed'), png, { type: 'DRAG_CANCEL' }, { type: 'LEAVE_DONE' })
    expect(m.state).toBe('idle')
    m = reducer(m, { type: 'DROP_RESOLVED', items: [item('song.wav')], target: 'to-mp3', jobId: 'k' })
    expect(m.state).toBe('eat')
    expect(m.session).toBe(2)
  })

  it('progress events clamp to [0,1] or -1', () => {
    let m = run(initialModel('overlay'), png, {
      type: 'DROP_RESOLVED',
      items: [item('a.png')],
      target: 'to-jpg',
      jobId: 'j'
    })
    m = reducer(m, ev({ type: 'progress', jobId: 'j', progress: 7 }))
    expect(m.progress).toBe(1)
    m = reducer(m, ev({ type: 'progress', jobId: 'j', progress: -1, stage: 'thinking' }))
    expect(m.progress).toBe(-1)
    expect(m.stage).toBe('thinking')
  })
})
