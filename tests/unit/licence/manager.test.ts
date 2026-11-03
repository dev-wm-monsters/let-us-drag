// D26: LicenceManager (activation, deactivation, background re-check + scheduling) with fakes.
import { describe, expect, it } from 'vitest'
import type { ActivateData, DodoCall, ValidateData } from '../../../src/main/licence/dodo-client'
import { HOUR_MS, RECHECK_INTERVAL_MS } from '../../../src/main/licence/logic'
import { LicenceManager, type LicenceStoreLike } from '../../../src/main/licence/manager'
import type { StoredLicence } from '../../../src/main/licence/store'
import type { LicenceView } from '../../../src/shared/licence'

const PRODUCT = 'pdt_0Nqn0nhO4z3NeUwcXy0n3'
const T0 = Date.parse('2026-11-02T12:00:00Z')

function memStore(initial: StoredLicence | null = null) {
  let rec = initial
  const s: LicenceStoreLike & { rec(): StoredLicence | null; saves: number } = {
    saves: 0,
    load: async () => rec,
    save: async (r) => {
      s.saves++
      rec = r
    },
    clear: async () => {
      rec = null
    },
    rec: () => rec
  }
  return s
}

function stored(extra: Partial<StoredLicence> = {}): StoredLicence {
  return {
    v: 1,
    licenseKey: 'LD7Q-29XK-PM3A-1A2B',
    instanceId: 'lki_1',
    environment: 'test',
    activatedAt: new Date(T0 - 2 * HOUR_MS).toISOString(),
    lastCheckedAt: new Date(T0 - 2 * HOUR_MS).toISOString(),
    lastResult: 'activated',
    status: 'active',
    ...extra
  }
}

interface Harness {
  m: LicenceManager
  store: ReturnType<typeof memStore>
  activations: { key: string; name: string }[]
  validations: { key: string; instance: string | null }[]
  deactivations: { key: string; instance: string }[]
  timers: { fn: () => void; ms: number; cancelled: boolean }[]
  views: LicenceView[]
  clock: { now: number }
}

function setup(opts: {
  rec?: StoredLicence | null
  activate?: DodoCall<ActivateData>[]
  validate?: DodoCall<ValidateData>[]
  deactivate?: DodoCall<true>[]
  environment?: 'test' | 'live'
}): Harness {
  const store = memStore(opts.rec ?? null)
  const activations: Harness['activations'] = []
  const validations: Harness['validations'] = []
  const deactivations: Harness['deactivations'] = []
  const timers: Harness['timers'] = []
  const clock = { now: T0 }
  const act = [...(opts.activate ?? [])]
  const val = [...(opts.validate ?? [])]
  const deact = [...(opts.deactivate ?? [])]
  const m = new LicenceManager({
    config: { environment: opts.environment ?? 'test', productId: PRODUCT },
    client: {
      activate: async (key, name) => {
        activations.push({ key, name })
        return act.shift() ?? { kind: 'network', reason: 'script' }
      },
      validate: async (key, instance) => {
        validations.push({ key, instance })
        return val.shift() ?? { kind: 'network', reason: 'script' }
      },
      deactivate: async (key, instance) => {
        deactivations.push({ key, instance })
        return deact.shift() ?? { kind: 'network', reason: 'script' }
      }
    },
    store,
    deviceLabel: 'Linux · x64 · 3f9a2c',
    now: () => clock.now,
    random: () => 0,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cancelled: false }
      timers.push(t)
      return { cancel: () => void (t.cancelled = true) }
    },
    sleep: async () => undefined,
    confirmDelayMs: 10
  })
  const views: LicenceView[] = []
  m.onChange((v) => views.push(v))
  return { m, store, activations, validations, deactivations, timers, views, clock }
}

const activeTimers = (h: Harness) => h.timers.filter((t) => !t.cancelled)

describe('LicenceManager: activation', () => {
  it('starts unlicensed and refuses to unlock', async () => {
    const h = setup({})
    await h.m.init()
    expect(h.m.status).toBe('unlicensed')
    expect(h.m.isUnlocked()).toBe(false)
    expect(h.m.view()).toEqual({ status: 'unlicensed', maskedKey: null, activatedAt: null, lastCheckedAt: null, environment: 'test', testMode: true, teamBuild: false })
  })

  it('activates a trimmed key with the device label, stores it and unlocks at once', async () => {
    const h = setup({ activate: [{ kind: 'ok', data: { instanceId: 'lki_new', productId: PRODUCT } }] })
    await h.m.init()
    const r = await h.m.activate('  LD7Q-29XK-PM3A-1A2B \r\n')
    expect(r.ok).toBe(true)
    expect(r.message).toBe('Activated on this computer. Your licence works on 2 computers.')
    expect(h.activations).toEqual([{ key: 'LD7Q-29XK-PM3A-1A2B', name: 'Linux · x64 · 3f9a2c' }])
    expect(h.m.isUnlocked()).toBe(true)
    expect(h.store.rec()).toMatchObject({ licenseKey: 'LD7Q-29XK-PM3A-1A2B', instanceId: 'lki_new', status: 'active', environment: 'test' })
    expect(r.view.maskedKey).toBe('LD7Q-…-1A2B')
    expect(JSON.stringify(r.view)).not.toContain('29XK')
    expect(h.views.at(-1)?.status).toBe('active')
  })

  it.each([
    [{ kind: 'http', status: 404, code: null } as const, 'NOT_FOUND'],
    [{ kind: 'http', status: 403, code: null } as const, 'NOT_ACTIVE'],
    [{ kind: 'http', status: 422, code: null } as const, 'LIMIT_REACHED'],
    [{ kind: 'network', reason: 'ENOTFOUND' } as const, 'NETWORK'],
    [{ kind: 'http', status: 503, code: null } as const, 'UNKNOWN']
  ])('activation error %o → %s, stays locked', async (answer, code) => {
    const h = setup({ activate: [answer] })
    await h.m.init()
    const r = await h.m.activate('KEY')
    expect(r).toMatchObject({ ok: false, code })
    expect(h.m.isUnlocked()).toBe(false)
    expect(h.store.rec()).toBeNull()
  })

  it('a key for another product is refused and its seat freed again', async () => {
    const h = setup({ activate: [{ kind: 'ok', data: { instanceId: 'lki_x', productId: 'pdt_otherproduct' } }], deactivate: [{ kind: 'ok', data: true }] })
    await h.m.init()
    expect(await h.m.activate('KEY')).toMatchObject({ ok: false, code: 'WRONG_PRODUCT' })
    expect(h.deactivations).toEqual([{ key: 'KEY', instance: 'lki_x' }])
    expect(h.m.isUnlocked()).toBe(false)
  })

  it('empty key: no network', async () => {
    const h = setup({})
    await h.m.init()
    expect(await h.m.activate(' \n ')).toMatchObject({ ok: false, code: 'EMPTY_KEY' })
    expect(h.activations).toEqual([])
  })

  it('already active: same key is a no-op, another key is refused', async () => {
    const h = setup({ rec: stored() })
    await h.m.init()
    expect((await h.m.activate('LD7Q-29XK-PM3A-1A2B')).ok).toBe(true)
    expect(await h.m.activate('OTHER')).toMatchObject({ ok: false, code: 'ALREADY_ACTIVE' })
    expect(h.activations).toEqual([])
  })

  it('"Activate again" reuses the stored key after the instance was removed', async () => {
    const h = setup({ rec: stored({ status: 'reactivate', lastResult: 'instance-missing' }), activate: [{ kind: 'ok', data: { instanceId: 'lki_2', productId: null } }] })
    await h.m.init()
    expect(h.m.isUnlocked()).toBe(false)
    expect((await h.m.activate('')).ok).toBe(true)
    expect(h.activations[0]!.key).toBe('LD7Q-29XK-PM3A-1A2B')
    expect(h.store.rec()?.instanceId).toBe('lki_2')
  })

  it('a licence stored for the other Dodo environment is ignored', async () => {
    const h = setup({ rec: stored({ environment: 'test' }), environment: 'live' })
    await h.m.init()
    expect(h.m.status).toBe('unlicensed')
  })
})

describe('LicenceManager: deactivation', () => {
  it('online: frees the seat and locks', async () => {
    const h = setup({ rec: stored(), deactivate: [{ kind: 'ok', data: true }] })
    await h.m.init()
    const r = await h.m.deactivate()
    expect(r.ok).toBe(true)
    expect(h.deactivations).toEqual([{ key: 'LD7Q-29XK-PM3A-1A2B', instance: 'lki_1' }])
    expect(h.m.status).toBe('unlicensed')
    expect(h.store.rec()).toBeNull()
  })

  it('offline: keeps the licence and says so', async () => {
    const h = setup({ rec: stored(), deactivate: [{ kind: 'network', reason: 'timeout' }] })
    await h.m.init()
    const r = await h.m.deactivate()
    expect(r).toMatchObject({ ok: false, code: 'NETWORK', message: "Deactivating needs the internet so the seat is freed. Try again when you're online." })
    expect(h.m.isUnlocked()).toBe(true)
    expect(h.store.rec()).not.toBeNull()
  })

  it('5xx keeps the licence; 404 (already gone) clears it', async () => {
    const h = setup({ rec: stored(), deactivate: [{ kind: 'http', status: 500, code: null }, { kind: 'http', status: 404, code: null }] })
    await h.m.init()
    expect((await h.m.deactivate()).ok).toBe(false)
    expect(h.m.isUnlocked()).toBe(true)
    expect((await h.m.deactivate()).ok).toBe(true)
    expect(h.m.status).toBe('unlicensed')
  })

  it('without a licence: no network', async () => {
    const h = setup({})
    await h.m.init()
    expect(await h.m.deactivate()).toMatchObject({ ok: false, code: 'NO_LICENCE' })
    expect(h.deactivations).toEqual([])
  })
})

describe('LicenceManager: background re-check', () => {
  it('valid: stays active and records the check', async () => {
    const h = setup({ rec: stored(), validate: [{ kind: 'ok', data: { valid: true, productId: null } }] })
    await h.m.init()
    h.clock.now = T0 + 5000
    expect(await h.m.recheckNow()).toBe('valid')
    expect(h.m.isUnlocked()).toBe(true)
    expect(h.store.rec()?.lastCheckedAt).toBe(new Date(T0 + 5000).toISOString())
  })

  it('definite invalid twice + key invalid → disabled (after the confirm re-check)', async () => {
    const no = { kind: 'ok', data: { valid: false, productId: null } } as const
    const h = setup({ rec: stored(), validate: [no, no, no] })
    await h.m.init()
    expect(await h.m.recheckNow()).toBe('disabled')
    expect(h.validations).toHaveLength(3)
    expect(h.m.status).toBe('disabled')
    expect(h.m.isUnlocked()).toBe(false)
    expect(h.views.at(-1)?.status).toBe('disabled')
  })

  it('network errors, 5xx and timeouts never lock', async () => {
    const h = setup({
      rec: stored(),
      validate: [
        { kind: 'network', reason: 'ENOTFOUND' },
        { kind: 'http', status: 502, code: null },
        { kind: 'network', reason: 'timeout' },
        { kind: 'http', status: 404, code: null },
        { kind: 'network', reason: 'timeout' }
      ]
    })
    await h.m.init()
    for (let i = 0; i < 4; i++) {
      expect(await h.m.recheckNow()).toBe('transient')
      expect(h.m.isUnlocked()).toBe(true)
    }
    expect(h.store.saves).toBe(0)
  })

  it('deleted instance but valid key → "activate again", not disabled', async () => {
    const gone = { kind: 'http', status: 404, code: null } as const
    const h = setup({ rec: stored(), validate: [gone, gone, { kind: 'ok', data: { valid: true, productId: null } }] })
    await h.m.init()
    expect(await h.m.recheckNow()).toBe('reactivate')
    expect(h.m.status).toBe('reactivate')
    expect(h.validations.at(-1)).toEqual({ key: 'LD7Q-29XK-PM3A-1A2B', instance: null })
  })

  it('a disabled key that was re-enabled unlocks again', async () => {
    const h = setup({ rec: stored({ status: 'disabled', lastResult: 'invalid' }), validate: [{ kind: 'ok', data: { valid: true, productId: null } }] })
    await h.m.init()
    expect(await h.m.recheckNow()).toBe('valid')
    expect(h.m.isUnlocked()).toBe(true)
  })

  it('nothing to check without a licence', async () => {
    const h = setup({})
    await h.m.init()
    expect(await h.m.recheckNow()).toBeNull()
    expect(h.validations).toEqual([])
  })

  it('an answer that arrives after a local change is discarded', async () => {
    let release: (v: DodoCall<ValidateData>) => void = () => undefined
    const h = setup({ rec: stored(), deactivate: [{ kind: 'ok', data: true }] })
    // Replace validate with a slow one.
    ;(h.m as unknown as { deps: { client: { validate: unknown } } }).deps.client.validate = () => new Promise((r) => (release = r))
    await h.m.init()
    const p = h.m.recheckNow()
    await h.m.deactivate()
    release({ kind: 'ok', data: { valid: true, productId: null } })
    expect(await p).toBeNull()
    expect(h.m.status).toBe('unlicensed')
  })
})

describe('LicenceManager: scheduling', () => {
  it('start(): a recent check waits until the 24 h are over (never at start-up)', async () => {
    const h = setup({ rec: stored() })
    await h.m.init()
    h.m.start()
    const t = activeTimers(h)
    expect(t).toHaveLength(1)
    expect(t[0]!.ms).toBe(RECHECK_INTERVAL_MS - 2 * HOUR_MS)
  })

  it('start(): a due check runs after a random start-up delay, silently', async () => {
    const h = setup({ rec: stored({ lastCheckedAt: new Date(T0 - 30 * HOUR_MS).toISOString() }), validate: [{ kind: 'ok', data: { valid: true, productId: null } }] })
    await h.m.init()
    h.m.start()
    expect(h.validations).toEqual([]) // nothing at start-up itself
    const t = activeTimers(h)[0]!
    expect(t.ms).toBeGreaterThanOrEqual(30_000)
    t.fn()
    await new Promise((r) => setTimeout(r, 20))
    expect(h.validations).toHaveLength(1)
    expect(h.m.isUnlocked()).toBe(true)
    // Next one a day later.
    expect(activeTimers(h).at(-1)!.ms).toBeGreaterThanOrEqual(RECHECK_INTERVAL_MS - 1000)
  })

  it('transient failures retry later with a growing delay', async () => {
    const h = setup({ rec: stored({ lastCheckedAt: null }), validate: [{ kind: 'network', reason: 'x' }, { kind: 'network', reason: 'x' }] })
    await h.m.init()
    h.m.start()
    await h.m.recheckNow()
    const first = activeTimers(h).at(-1)!.ms
    await h.m.recheckNow()
    const second = activeTimers(h).at(-1)!.ms
    expect(first).toBe(Math.round(0.9 * HOUR_MS))
    expect(second).toBe(Math.round(3 * 0.9 * HOUR_MS))
  })

  it('resume after more than 24 h schedules a check soon; nothing for unlicensed', async () => {
    const h = setup({ rec: stored() })
    await h.m.init()
    h.m.start()
    h.clock.now = T0 + 3 * RECHECK_INTERVAL_MS
    h.m.onResume()
    expect(activeTimers(h)).toHaveLength(1)
    expect(activeTimers(h)[0]!.ms).toBeLessThan(5 * 60_000)

    const u = setup({})
    await u.m.init()
    u.m.start()
    u.m.onResume()
    expect(activeTimers(u)).toHaveLength(0)
  })

  it('stop() cancels the timer', async () => {
    const h = setup({ rec: stored() })
    await h.m.init()
    h.m.start()
    h.m.stop()
    expect(activeTimers(h)).toHaveLength(0)
  })
})

describe('LicenceManager: team / demo build (LUD_LICENSING=off)', () => {
  it('is unlocked without a key, never calls Dodo, never stores anything, never schedules checks', async () => {
    const h = setup({})
    await h.m.init()
    h.m.enableTeamBuild()
    h.m.start()
    expect(h.m.isUnlocked()).toBe(true)
    expect(h.m.view()).toMatchObject({ status: 'active', teamBuild: true })
    const a = await h.m.activate('LD7Q-29XK-PM3A-1A2B')
    const d = await h.m.deactivate()
    expect(a.ok && d.ok).toBe(true)
    expect(h.m.isUnlocked()).toBe(true)
    expect(h.activations.length + h.validations.length + h.deactivations.length).toBe(0)
    expect(activeTimers(h)).toHaveLength(0)
    expect(h.store.rec()).toBeNull()
  })
})
