// D29: update decisions, the view, the scheduler, the store and the manager (fake fetch / clock / timers).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { fetchManifest, type UpdateFetchLike } from '../../../src/main/update/checker'
import {
  decideStatus,
  DEFAULT_UPDATE_TIMINGS,
  EMPTY_MEMORY,
  firstCheckDelay,
  makeView,
  resumeCheckDelay,
  type UpdateMemory
} from '../../../src/main/update/logic'
import { UpdateManager } from '../../../src/main/update/manager'
import { parseManifest, type UpdateManifest } from '../../../src/main/update/manifest'
import { parseUpdateState, UPDATE_STATE_FILE, UpdateStore, type UpdateStoreLike } from '../../../src/main/update/store'
import { isUpdateRequired, showsUpdateBanner, updateTrayLabel, formatReleaseDate } from '../../../src/shared/update'

const H = 60 * 60 * 1000
const manifest = (latest: string, minimum: string | null = null, extra: Record<string, unknown> = {}): UpdateManifest =>
  parseManifest({ latest, minimum, notes: ['New: tricks.'], releasedAt: '2026-11-10', ...extra })!

describe('decision', () => {
  it('current / available / required', () => {
    expect(decideStatus('0.1.0', null)).toBe('current') // never fetched → never blocked
    expect(decideStatus('0.1.0', manifest('0.1.0'))).toBe('current')
    expect(decideStatus('0.2.0', manifest('0.1.0'))).toBe('current') // newer than the website (dev build)
    expect(decideStatus('0.1.0', manifest('0.2.0', '0.1.0'))).toBe('available')
    expect(decideStatus('0.1.0', manifest('0.2.0'))).toBe('available')
    expect(decideStatus('0.1.0', manifest('0.2.0', '0.2.0'))).toBe('required')
    expect(decideStatus('0.1.0-beta.8', manifest('0.2.0', '0.1.0'))).toBe('required') // a beta is below its release
    expect(decideStatus('0.1.0-beta.8', manifest('0.1.0-beta.9'))).toBe('available')
    expect(decideStatus('not-a-version', manifest('0.2.0', '0.2.0'))).toBe('current') // our own bug never blocks
  })

  it('builds the view: Later and the once-per-version hint', () => {
    const mem: UpdateMemory = { ...EMPTY_MEMORY, manifest: manifest('0.2.0'), fetchedAt: '2026-11-06T10:00:00.000Z' }
    const v = makeView('0.1.0', mem)
    expect(v).toMatchObject({ status: 'available', latestVersion: '0.2.0', dismissed: false, hint: true, notes: ['New: tricks.'], releasedAt: '2026-11-10' })
    expect(showsUpdateBanner(v)).toBe(true)
    expect(makeView('0.1.0', { ...mem, hintShownVersion: '0.2.0' }).hint).toBe(false)
    const later = makeView('0.1.0', { ...mem, dismissedVersion: '0.2.0' })
    expect(later).toMatchObject({ dismissed: true, hint: false })
    expect(showsUpdateBanner(later)).toBe(false)
    // "Later" for 0.2.0 does not hide 0.3.0.
    expect(makeView('0.1.0', { ...mem, manifest: manifest('0.3.0'), dismissedVersion: '0.2.0' })).toMatchObject({ dismissed: false, hint: true })
    // A forced update cannot be put off.
    const forced = makeView('0.1.0', { ...mem, manifest: manifest('0.2.0', '0.2.0'), dismissedVersion: '0.2.0' })
    expect(forced).toMatchObject({ status: 'required', dismissed: false, hint: false })
    expect(showsUpdateBanner(forced)).toBe(true)
    expect(isUpdateRequired(forced)).toBe(true)
    expect(makeView('0.2.0', mem)).toMatchObject({ status: 'current', notes: [], hint: false })
  })

  it('tray labels and dates', () => {
    expect(updateTrayLabel(null)).toBeNull()
    expect(updateTrayLabel({ status: 'current', latestVersion: '0.1.0' })).toBeNull()
    expect(updateTrayLabel({ status: 'available', latestVersion: '0.2.0' })).toBe('Update available (v0.2.0)…')
    expect(updateTrayLabel({ status: 'required', latestVersion: '0.2.0' })).toBe('Update required (v0.2.0)…')
    expect(formatReleaseDate('2026-11-10')).toBe('Nov 10, 2026')
    expect(formatReleaseDate('soon')).toBeNull()
  })
})

describe('schedule', () => {
  it('first check after 20–60 s, never at start-up itself', () => {
    expect(firstCheckDelay(0)).toBe(20_000)
    expect(firstCheckDelay(1)).toBe(60_000)
    expect(firstCheckDelay(0.5)).toBe(40_000)
    expect(firstCheckDelay(Number.NaN)).toBe(40_000)
  })

  it('after a resume only when 6 h are over', () => {
    const now = 100 * H
    expect(resumeCheckDelay(now - 2 * H, now, 0.5)).toBeNull()
    expect(resumeCheckDelay(now - 7 * H, now, 0)).toBe(DEFAULT_UPDATE_TIMINGS.resumeMinMs)
    expect(resumeCheckDelay(null, now, 1)).toBe(DEFAULT_UPDATE_TIMINGS.resumeMaxMs)
  })
})

// ——— checker ————————————————————————————————————————————————————————————————————————————

type Reply = { status: number; body: string } | 'throw' | 'hang'
function fakeFetch(replies: Reply[] | (() => Reply)) {
  const calls: { url: string; init: Parameters<UpdateFetchLike>[1] }[] = []
  const impl: UpdateFetchLike = (url, init) => {
    calls.push({ url, init })
    const r = typeof replies === 'function' ? replies() : (replies.shift() ?? 'throw')
    if (r === 'throw') return Promise.reject(new Error('offline'))
    if (r === 'hang')
      return new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))))
    return Promise.resolve({ status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => r.body })
  }
  return { impl, calls }
}
const ok = (m: Record<string, unknown>): Reply => ({ status: 200, body: JSON.stringify(m) })

describe('fetchManifest', () => {
  it('one plain GET, no body, no query, Accept only, no redirects', async () => {
    const f = fakeFetch([ok({ latest: '0.2.0' })])
    const r = await fetchManifest(f.impl, 'https://letsdrag.wakeupmonster.com/update.json', 1000)
    expect(r).toMatchObject({ kind: 'ok', manifest: { latest: '0.2.0' } })
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]!.url).toBe('https://letsdrag.wakeupmonster.com/update.json')
    expect(f.calls[0]!.init).toMatchObject({ method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error' })
    expect(Object.keys(f.calls[0]!.init.headers)).toEqual(['Accept'])
    expect(f.calls[0]!.init).not.toHaveProperty('body')
  })

  it('reports every failure kind', async () => {
    expect(await fetchManifest(fakeFetch(['throw']).impl, 'u', 1000)).toEqual({ kind: 'error', reason: 'network' })
    expect(await fetchManifest(fakeFetch(['hang']).impl, 'u', 30)).toEqual({ kind: 'error', reason: 'timeout' })
    expect(await fetchManifest(fakeFetch([{ status: 500, body: '' }]).impl, 'u', 1000)).toEqual({ kind: 'error', reason: 'http', status: 500 })
    expect(await fetchManifest(fakeFetch([{ status: 200, body: '{bad' }]).impl, 'u', 1000)).toEqual({ kind: 'error', reason: 'invalid' })
    expect(await fetchManifest(fakeFetch([{ status: 200, body: 'x'.repeat(70_000) }]).impl, 'u', 1000)).toEqual({ kind: 'error', reason: 'too-big' })
  })
})

// ——— store ——————————————————————————————————————————————————————————————————————————————

const dir = mkdtempSync(join(tmpdir(), 'lud-update-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('UpdateStore', () => {
  it('round-trips and re-validates the cached manifest', async () => {
    const d = mkdtempSync(join(dir, 's-'))
    const store = new UpdateStore({ dir: d })
    expect(await store.load()).toEqual(EMPTY_MEMORY) // missing file
    const mem: UpdateMemory = { manifest: manifest('0.2.0', '0.2.0'), fetchedAt: '2026-11-06T10:00:00.000Z', dismissedVersion: '0.2.0', hintShownVersion: null }
    await store.save(mem)
    expect(await store.load()).toEqual(mem)
    expect(JSON.parse(readFileSync(join(d, UPDATE_STATE_FILE), 'utf8'))).toMatchObject({ v: 1, dismissedVersion: '0.2.0' })
  })

  it('anything corrupt or invalid reads as "nothing known" (never blocks)', async () => {
    const d = mkdtempSync(join(dir, 'c-'))
    const store = new UpdateStore({ dir: d })
    writeFileSync(join(d, UPDATE_STATE_FILE), '{oops')
    expect(await store.load()).toEqual(EMPTY_MEMORY)
    expect(parseUpdateState({ v: 2, manifest: { latest: '9.9.9', minimum: '9.9.9' } })).toEqual(EMPTY_MEMORY)
    expect(parseUpdateState({ v: 1, manifest: { latest: 'x', minimum: '9.9.9' }, fetchedAt: '2026-11-06T10:00:00.000Z', dismissedVersion: 'nope' })).toEqual(
      EMPTY_MEMORY
    )
    expect(parseUpdateState({ v: 1, manifest: { latest: '0.2.0' }, fetchedAt: 'yesterday', dismissedVersion: '0.2.0' })).toMatchObject({
      fetchedAt: null,
      dismissedVersion: '0.2.0'
    })
  })
})

// ——— manager ————————————————————————————————————————————————————————————————————————————

class MemStore implements UpdateStoreLike {
  saved: UpdateMemory[] = []
  constructor(public mem: UpdateMemory = { ...EMPTY_MEMORY }) {}
  async load() {
    return { ...this.mem }
  }
  async save(m: UpdateMemory) {
    this.mem = { ...m }
    this.saved.push({ ...m })
  }
}

function fakeTimers() {
  const pending: { fn: () => void; ms: number; cancelled: boolean }[] = []
  return {
    pending,
    setTimer: (fn: () => void, ms: number) => {
      const t = { fn, ms, cancelled: false }
      pending.push(t)
      return { cancel: () => void (t.cancelled = true) }
    },
    active: () => pending.filter((t) => !t.cancelled),
    fireLast: () => {
      const t = pending.filter((x) => !x.cancelled).pop()
      if (!t) throw new Error('no timer')
      t.cancelled = true
      t.fn()
    }
  }
}

function makeManager(opts: { current?: string; replies?: Reply[] | (() => Reply); mem?: UpdateMemory; platform?: 'linux-x64' | 'win-x64' } = {}) {
  let now = 1_000 * H
  const store = new MemStore(opts.mem)
  const f = fakeFetch(opts.replies ?? [])
  const timers = fakeTimers()
  const m = new UpdateManager({
    currentVersion: opts.current ?? '0.1.0',
    manifestUrl: 'https://letsdrag.wakeupmonster.com/update.json',
    fetchImpl: f.impl,
    store,
    platformKey: opts.platform ?? 'linux-x64',
    now: () => now,
    random: () => 0.5,
    setTimer: timers.setTimer,
    timeoutMs: 50
  })
  return { m, store, f, timers, advance: (ms: number) => void (now += ms) }
}

const DL = {
  'linux-x64': 'https://letsdrag.wakeupmonster.com/downloads/LetsDrag-0.2.0.AppImage',
  'win-x64': 'https://letsdrag.wakeupmonster.com/downloads/LetsDrag-0.2.0.exe',
  page: 'https://letsdrag.wakeupmonster.com/#download'
}

describe('UpdateManager', () => {
  it('starts with nothing known and makes no request until the timer fires', async () => {
    const { m, f, timers } = makeManager({ replies: [ok({ latest: '0.2.0' })] })
    await m.init()
    expect(m.view().status).toBe('current')
    expect(m.isBlocked()).toBe(false)
    m.start()
    expect(f.calls).toHaveLength(0)
    expect(timers.active().map((t) => t.ms)).toEqual([40_000])
    timers.fireLast()
    await vi.waitFor(() => expect(m.view().status).toBe('available'))
    expect(f.calls).toHaveLength(1)
    // Next check in 6 h.
    expect(timers.active().map((t) => t.ms)).toEqual([6 * H])
  })

  it('soft update: Later and the hint persist per version; a newer version shows again', async () => {
    const replies: Reply[] = [ok({ latest: '0.2.0', downloads: DL }), ok({ latest: '0.3.0' })]
    const { m, store } = makeManager({ replies })
    await m.init()
    const seen: string[] = []
    m.onChange((v) => seen.push(`${v.status}:${v.latestVersion}:${v.dismissed}:${v.hint}`))
    expect((await m.checkForUpdates()).ok).toBe(true)
    expect(m.view()).toMatchObject({ status: 'available', hint: true, dismissed: false })
    await m.hintSeen()
    expect(m.view().hint).toBe(false)
    expect(store.mem.hintShownVersion).toBe('0.2.0')
    expect(await m.dismiss()).toMatchObject({ dismissed: true })
    expect(store.mem.dismissedVersion).toBe('0.2.0')
    expect(m.isBlocked()).toBe(false)
    expect(m.downloadUrl()).toBe(DL['linux-x64'])
    await m.checkNow()
    expect(m.view()).toMatchObject({ latestVersion: '0.3.0', dismissed: false, hint: true })
    expect(m.downloadUrl()).toBe('https://letsdrag.wakeupmonster.com/#download')
    expect(seen.at(-1)).toBe('available:0.3.0:false:true')
  })

  it('force update blocks, survives a restart offline, and a lower minimum unblocks', async () => {
    const first = makeManager({ replies: [ok({ latest: '0.2.0', minimum: '0.2.0', downloads: DL })], platform: 'win-x64' })
    await first.m.init()
    await first.m.checkNow()
    expect(first.m.isBlocked()).toBe(true)
    expect(first.m.view().status).toBe('required')
    expect(first.m.downloadUrl()).toBe(DL['win-x64'])
    expect(await first.m.dismiss()).toMatchObject({ status: 'required', dismissed: false }) // no "Later"

    // Restart, offline: the cached manifest keeps it blocked; failed checks change nothing.
    const second = makeManager({ replies: ['throw', { status: 500, body: '' }, { status: 200, body: 'nope' }], mem: first.store.mem })
    await second.m.init()
    expect(second.m.isBlocked()).toBe(true)
    expect(await second.m.checkNow()).toBe(false)
    expect(await second.m.checkNow()).toBe(false)
    expect((await second.m.checkForUpdates()).ok).toBe(false)
    expect(second.m.isBlocked()).toBe(true)

    // The website lowers the minimum → unblocked (still a soft update).
    const third = makeManager({ replies: [ok({ latest: '0.2.0', minimum: '0.1.0' })], mem: second.store.mem })
    await third.m.init()
    await third.m.checkNow()
    expect(third.m.isBlocked()).toBe(false)
    expect(third.m.view().status).toBe('available')
  })

  it('failed checks never block and never clear a known soft update', async () => {
    const { m } = makeManager({ replies: ['throw', 'hang', { status: 503, body: '' }, ok({ latest: 'oops' })] })
    await m.init()
    for (let i = 0; i < 4; i++) expect(await m.checkNow()).toBe(false)
    expect(m.view().status).toBe('current')
    expect(m.isBlocked()).toBe(false)
    const soft = makeManager({ replies: ['throw'], mem: { ...EMPTY_MEMORY, manifest: manifest('0.2.0') } })
    await soft.m.init()
    await soft.m.checkNow()
    expect(soft.m.view().status).toBe('available')
  })

  it('a check in flight is shared; resume re-checks only after 6 h', async () => {
    const { m, f, timers, advance } = makeManager({ replies: () => ok({ latest: '0.1.0' }) })
    await m.init()
    m.start()
    await Promise.all([m.checkNow(), m.checkNow()])
    expect(f.calls).toHaveLength(1)
    const before = timers.active().map((t) => t.ms)
    expect(before).toEqual([6 * H])
    advance(2 * H)
    m.onResume()
    expect(timers.active().map((t) => t.ms)).toEqual([6 * H]) // unchanged
    advance(5 * H)
    m.onResume()
    expect(timers.active().map((t) => t.ms)).toEqual([40_000])
    m.stop()
    expect(timers.active()).toEqual([])
    m.onResume()
    expect(timers.active()).toEqual([])
  })
})
