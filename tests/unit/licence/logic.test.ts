// D26: pure licence logic (error mapping, re-check classification + procedure, scheduling, labels, masking).
import { hostname, userInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  LICENCE_MESSAGES,
  isUnlocked,
  lockedExplanation,
  maskLicenceKey,
  normaliseLicenceKey,
  unlockTitle,
  type LicenceErrorCode
} from '../../../src/shared/licence'
import type { DodoCall, ValidateData } from '../../../src/main/licence/dodo-client'
import {
  DEFAULT_TIMINGS,
  HOUR_MS,
  RECHECK_INTERVAL_MS,
  activateErrorMessage,
  classifyValidate,
  deviceLabel,
  isCheckDue,
  isInstallId,
  mapActivate,
  mapDeactivate,
  nextCheckDelay,
  retryDelay,
  runRecheck,
  shouldRecheck,
  statusAfterRecheck
} from '../../../src/main/licence/logic'

const PRODUCT = 'pdt_0Nqn0nhO4z3NeUwcXy0n3'
const ok = <T>(data: T): DodoCall<T> => ({ kind: 'ok', data })
const http = (status: number): DodoCall<never> => ({ kind: 'http', status, code: null })
const net = (reason = 'timeout'): DodoCall<never> => ({ kind: 'network', reason })

describe('activation error mapping', () => {
  it('maps every documented status to its code', () => {
    expect(mapActivate(ok({ instanceId: 'lki_1', productId: PRODUCT }), PRODUCT)).toEqual({ ok: true, instanceId: 'lki_1' })
    expect(mapActivate(ok({ instanceId: 'lki_1', productId: null }), PRODUCT)).toEqual({ ok: true, instanceId: 'lki_1' })
    expect(mapActivate(http(404), PRODUCT)).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(mapActivate(http(403), PRODUCT)).toEqual({ ok: false, code: 'NOT_ACTIVE' })
    expect(mapActivate(http(422), PRODUCT)).toEqual({ ok: false, code: 'LIMIT_REACHED' })
    expect(mapActivate(net(), PRODUCT)).toEqual({ ok: false, code: 'NETWORK' })
    for (const s of [400, 401, 429, 500, 502, 503]) expect(mapActivate(http(s), PRODUCT)).toEqual({ ok: false, code: 'UNKNOWN' })
  })

  it('refuses a key for another Dodo product', () => {
    expect(mapActivate(ok({ instanceId: 'lki_1', productId: 'pdt_someoneelse1' }), PRODUCT)).toEqual({ ok: false, code: 'WRONG_PRODUCT' })
  })

  it('has the owner-approved wording for each error', () => {
    expect(activateErrorMessage('NETWORK')).toBe('Activating needs the internet once. Check your connection and try again.')
    expect(activateErrorMessage('NOT_FOUND')).toBe("We couldn't find that key. Check it against your email from Dodo Payments.")
    expect(activateErrorMessage('NOT_ACTIVE')).toBe("This key isn't active (it may have been refunded). Write to support@wakeupmonster.com.")
    expect(activateErrorMessage('LIMIT_REACHED')).toBe(
      "This key is already active on 2 computers. On one of them, go to Settings → Deactivate this computer, then try again. If that computer is lost or broken, write to support@wakeupmonster.com and we'll free the seat."
    )
    expect(activateErrorMessage('UNKNOWN')).toContain('support@wakeupmonster.com')
  })

  it('never uses an em dash in user-facing text', () => {
    const codes: LicenceErrorCode[] = ['NETWORK', 'NOT_FOUND', 'NOT_ACTIVE', 'LIMIT_REACHED', 'WRONG_PRODUCT', 'EMPTY_KEY', 'NO_LICENCE', 'ALREADY_ACTIVE', 'BUSY', 'UNKNOWN']
    for (const c of codes) expect(activateErrorMessage(c)).not.toContain('—')
    for (const m of Object.values(LICENCE_MESSAGES)) expect(m).not.toContain('—')
  })
})

describe('deactivation mapping', () => {
  it('frees on success, clears when the seat is already gone, keeps offline / on server errors', () => {
    expect(mapDeactivate(ok(true))).toBe('freed')
    expect(mapDeactivate(http(404))).toBe('gone')
    expect(mapDeactivate(http(403))).toBe('gone')
    expect(mapDeactivate(net())).toBe('offline')
    expect(mapDeactivate(http(500))).toBe('error')
    expect(mapDeactivate(http(429))).toBe('error')
  })
})

describe('re-check classification', () => {
  it('locks only on a definite answer', () => {
    expect(classifyValidate(ok({ valid: true, productId: null }), PRODUCT)).toBe('valid')
    expect(classifyValidate(ok({ valid: false, productId: null }), PRODUCT)).toBe('invalid')
    expect(classifyValidate(http(404), PRODUCT)).toBe('invalid')
    expect(classifyValidate(http(403), PRODUCT)).toBe('invalid')
    expect(classifyValidate(ok({ valid: true, productId: 'pdt_otherproduct' }), PRODUCT)).toBe('invalid')
  })
  it('treats offline, timeouts, 5xx and anything unexpected as transient', () => {
    for (const s of [400, 401, 408, 422, 429, 500, 502, 503, 504]) expect(classifyValidate(http(s), PRODUCT)).toBe('transient')
    expect(classifyValidate(net('timeout'), PRODUCT)).toBe('transient')
    expect(classifyValidate(net('unexpected response'), PRODUCT)).toBe('transient')
  })
})

describe('runRecheck', () => {
  function script(answers: DodoCall<ValidateData>[]) {
    const calls: { key: string; instance: string | null }[] = []
    const sleeps: number[] = []
    return {
      calls,
      sleeps,
      deps: {
        validate: async (key: string, instance: string | null) => {
          calls.push({ key, instance })
          const a = answers.shift()
          if (!a) throw new Error('unexpected validate call')
          return a
        },
        sleep: async (ms: number) => void sleeps.push(ms),
        confirmDelayMs: 1234,
        productId: PRODUCT
      }
    }
  }
  const V = ok({ valid: true, productId: null })
  const X = ok({ valid: false, productId: null })

  it('valid on the first answer: one call, no confirm', async () => {
    const s = script([V])
    expect(await runRecheck(s.deps, 'K', 'lki_1')).toBe('valid')
    expect(s.calls).toEqual([{ key: 'K', instance: 'lki_1' }])
    expect(s.sleeps).toEqual([])
  })

  it('transient answers never lock and stop at once', async () => {
    for (const a of [net(), http(500), http(503)]) {
      const s = script([a])
      expect(await runRecheck(s.deps, 'K', 'lki_1')).toBe('transient')
      expect(s.calls).toHaveLength(1)
    }
  })

  it('definite invalid is confirmed after the delay, then the key alone decides: disabled', async () => {
    const s = script([X, X, X])
    expect(await runRecheck(s.deps, 'K', 'lki_1')).toBe('disabled')
    expect(s.sleeps).toEqual([1234])
    expect(s.calls).toEqual([
      { key: 'K', instance: 'lki_1' },
      { key: 'K', instance: 'lki_1' },
      { key: 'K', instance: null }
    ])
  })

  it('a glitch (invalid then valid) does not lock', async () => {
    const s = script([X, V])
    expect(await runRecheck(s.deps, 'K', 'lki_1')).toBe('valid')
  })

  it('invalid then offline on the confirm keeps the state', async () => {
    const s = script([http(404), net()])
    expect(await runRecheck(s.deps, 'K', 'lki_1')).toBe('transient')
  })

  it('deleted instance but valid key → activate again (not disabled)', async () => {
    const s = script([http(404), http(404), V])
    expect(await runRecheck(s.deps, 'K', 'lki_1')).toBe('reactivate')
  })

  it('key check offline after two definite answers → transient', async () => {
    const s = script([X, X, net()])
    expect(await runRecheck(s.deps, 'K', 'lki_1')).toBe('transient')
  })

  it('status transitions', () => {
    expect(statusAfterRecheck('valid')).toBe('active')
    expect(statusAfterRecheck('disabled')).toBe('disabled')
    expect(statusAfterRecheck('reactivate')).toBe('reactivate')
    expect(statusAfterRecheck('transient')).toBeNull()
    expect(shouldRecheck('active')).toBe(true)
    expect(shouldRecheck('disabled')).toBe(true)
    expect(shouldRecheck('reactivate')).toBe(false)
    expect(shouldRecheck('unlicensed')).toBe(false)
  })
})

describe('re-check scheduling', () => {
  const now = Date.parse('2026-11-02T12:00:00Z')
  it('is due when never checked, after 24 h, or when the clock went far back', () => {
    expect(isCheckDue(null, now)).toBe(true)
    expect(isCheckDue(now - RECHECK_INTERVAL_MS, now)).toBe(true)
    expect(isCheckDue(now - RECHECK_INTERVAL_MS + 1000, now)).toBe(false)
    expect(isCheckDue(now + 2 * HOUR_MS, now)).toBe(true)
    expect(isCheckDue(Number.NaN, now)).toBe(true)
  })
  it('a due check waits a random start-up delay (never at once)', () => {
    const t = DEFAULT_TIMINGS
    expect(nextCheckDelay(null, now, 0)).toBe(t.startupMinMs)
    expect(nextCheckDelay(null, now, 1)).toBe(t.startupMinMs + t.startupSpreadMs)
    expect(nextCheckDelay(now - 30 * HOUR_MS, now, 0.5)).toBe(t.startupMinMs + 0.5 * t.startupSpreadMs)
    expect(nextCheckDelay(null, now, 0)).toBeGreaterThanOrEqual(30_000)
  })
  it('a check that is not due yet waits for the end of the 24 h (+ jitter), at most once a day', () => {
    const d = nextCheckDelay(now - 2 * HOUR_MS, now, 0)
    expect(d).toBe(22 * HOUR_MS)
    expect(nextCheckDelay(now - 2 * HOUR_MS, now, 1)).toBe(22 * HOUR_MS + DEFAULT_TIMINGS.jitterMs)
    expect(nextCheckDelay(now - 1000, now, 0)).toBeGreaterThan(23 * HOUR_MS)
  })
  it('retries transient failures later with growing delays', () => {
    expect(retryDelay(1, 0.5)).toBe(HOUR_MS)
    expect(retryDelay(2, 0.5)).toBe(3 * HOUR_MS)
    expect(retryDelay(4, 0.5)).toBe(12 * HOUR_MS)
    expect(retryDelay(40, 0.5)).toBe(12 * HOUR_MS)
    expect(retryDelay(1, 0)).toBe(Math.round(0.9 * HOUR_MS))
    expect(retryDelay(1, 1)).toBe(Math.round(1.1 * HOUR_MS))
  })
})

describe('device label', () => {
  const id = '3f9a2c51-7d0e-4b8a-9c11-2a6f0e9d4b77'
  it('is generic: OS, CPU and the start of the anonymous ID', () => {
    expect(deviceLabel('darwin', 'arm64', '24.1.0', id)).toBe('macOS · Apple silicon · 3f9a2c')
    expect(deviceLabel('darwin', 'x64', '24.1.0', id)).toBe('macOS · Intel · 3f9a2c')
    expect(deviceLabel('win32', 'x64', '10.0.22631', id)).toBe('Windows 11 · x64 · 3f9a2c')
    expect(deviceLabel('win32', 'x64', '10.0.19045', id)).toBe('Windows 10 · x64 · 3f9a2c')
    expect(deviceLabel('linux', 'x64', '6.8.0-45-generic', id)).toBe('Linux · x64 · 3f9a2c')
  })
  it('never contains the host or user name', () => {
    const label = deviceLabel('linux', 'x64', '6.8.0', id)
    expect(label).not.toContain(hostname())
    expect(label).not.toContain(userInfo().username)
  })
  it('validates install IDs as UUID v4', () => {
    expect(isInstallId(id)).toBe(true)
    expect(isInstallId('3f9a2c51-7d0e-1b8a-9c11-2a6f0e9d4b77')).toBe(false)
    expect(isInstallId('my-macbook')).toBe(false)
  })
})

describe('key helpers (shared)', () => {
  it('masks keys: first 4 and last 4 only', () => {
    expect(maskLicenceKey('LD7Q-29XK-PM3A-1A2B')).toBe('LD7Q-…-1A2B')
    expect(maskLicenceKey('  abcdefghijklmnop  ')).toBe('abcd-…-mnop')
    expect(maskLicenceKey('short')).toBe('…rt')
    expect(maskLicenceKey('')).toBeNull()
    expect(maskLicenceKey(null)).toBeNull()
    const masked = maskLicenceKey('ABCDEFGH-SECRET-MIDDLE-WXYZ')!
    expect(masked).not.toContain('SECRET')
  })
  it('trims spaces and line breaks around a pasted key', () => {
    expect(normaliseLicenceKey('  LD7Q-29XK\n')).toBe('LD7Q-29XK')
    expect(normaliseLicenceKey('\r\n\tKEY-1​\r\n')).toBe('KEY-1')
    expect(normaliseLicenceKey(42)).toBe('')
  })
  it('explains each locked state', () => {
    expect(lockedExplanation('disabled')).toBe(
      'This licence key was disabled (for example after a refund). Buy a new licence, or write to support@wakeupmonster.com if this is a mistake.'
    )
    expect(lockedExplanation('reactivate')).toContain('activate it again')
    expect(lockedExplanation('unlicensed')).toBe('Feed me a licence first! One-time, works on 2 computers.')
    expect(unlockTitle('unlicensed')).toBe('Unlock for $9.50')
    expect(unlockTitle('disabled')).toBe('Unlock for $9.50')
    expect(unlockTitle('reactivate')).toBe('Activate me again')
    expect(isUnlocked({ status: 'active' })).toBe(true)
    expect(isUnlocked({ status: 'reactivate' })).toBe(false)
    expect(isUnlocked(null)).toBe(false)
  })
})
