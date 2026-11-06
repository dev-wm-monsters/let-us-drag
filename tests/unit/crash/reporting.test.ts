// D28: the crash reporting controller (when the SDK is loaded, what renderers / the engine get,
// live consent, sentry-test.flag). The SDK module is faked: no Sentry, no electron.
import { describe, expect, it } from 'vitest'
import { crashReportingMode, DEFAULT_SENTRY_DSN, type CrashReportingMode } from '../../../src/main/crash/config'
import { CrashReporting } from '../../../src/main/crash/reporting'
import type { SentryInitOptions } from '../../../src/main/crash/sdk'
import { CRASH_REPORTS_ARG } from '../../../src/shared/crash'

const ON: CrashReportingMode = crashReportingMode({ isPackaged: true, e2e: false, env: {}, buildDsn: DEFAULT_SENTRY_DSN })
const OFF: CrashReportingMode = { enabled: false, reason: 'unpackaged' }

function setup(mode: CrashReportingMode, consent: boolean, flag = false) {
  const state = { consent, flag, loads: 0, inits: [] as SentryInitOptions[], tests: [] as string[], tags: [] as [string, string][], logs: [] as string[] }
  const crash = new CrashReporting({
    mode,
    consent: () => state.consent,
    load: async () => {
      state.loads++
      return {
        initSentry: (opts: SentryInitOptions) => {
          state.inits.push(opts)
          return {
            setTag: (k: string, v: string) => void state.tags.push([k, v]),
            sendTestEvent: async (source: string) => {
              state.tests.push(source)
              return true
            },
            flush: async () => true
          }
        }
      }
    },
    tagInput: { version: '0.1.0', platform: 'darwin', arch: 'arm64', character: 'uncle', licensingEnabled: true, dodoEnv: 'test' },
    scrub: { appRoots: ['/app'], homeDir: '/Users/jane' },
    os: { name: 'macOS', version: '15.1' },
    testFlag: {
      exists: () => state.flag,
      remove: () => {
        state.flag = false
      }
    },
    log: (m) => void state.logs.push(m)
  })
  return { crash, state }
}

describe('CrashReporting', () => {
  it('off in this run (dev / E2E without the mock / no DSN): nothing loaded, no flags anywhere', async () => {
    const { crash, state } = setup(OFF, true, true)
    await crash.start()
    expect(state.loads).toBe(0)
    expect(crash.rendererArgs()).toEqual([])
    expect(crash.engineArgs()).toEqual([])
    expect(await crash.sendTestEvent('tray')).toBe(false)
    expect(state.flag).toBe(true) // the test flag is not consumed
  })

  it('packaged + setting on: SDK starts with the release, environment, tags and the live consent', async () => {
    const { crash, state } = setup(ON, true)
    await crash.start()
    expect(state.loads).toBe(1)
    expect(crash.active).toBe(true)
    const init = state.inits[0]!
    expect(init.release).toBe('lets-drag@0.1.0')
    expect(init.environment).toBe('production')
    expect(init.origin).toBe('https://o4512383055626240.ingest.us.sentry.io')
    expect(init.tags).toMatchObject({ channel: 'user', character: 'uncle', dodo_env: 'test' })
    expect(crash.rendererArgs()).toEqual([CRASH_REPORTS_ARG])
    expect(crash.engineArgs()).toEqual([CRASH_REPORTS_ARG])
    state.consent = false
    expect(init.consent()).toBe(false) // beforeSend / transport see the change at once
  })

  it('setting off at launch: SDK not loaded; renderers still get the flag (main drops), the engine does not', async () => {
    const { crash, state } = setup(ON, false)
    await crash.start()
    expect(state.loads).toBe(0)
    expect(crash.rendererArgs()).toEqual([CRASH_REPORTS_ARG])
    expect(crash.engineArgs()).toEqual([])
    expect(await crash.sendTestEvent('tray')).toBe(false)
  })

  it('turning the setting on later starts the SDK once (live)', async () => {
    const { crash, state } = setup(ON, false)
    await crash.start()
    state.consent = true
    await Promise.all([crash.setConsent(true), crash.setConsent(true)])
    expect(state.loads).toBe(1)
    expect(crash.engineArgs()).toEqual([CRASH_REPORTS_ARG])
    state.consent = false
    await crash.setConsent(false)
    expect(state.inits).toHaveLength(1)
  })

  it('sentry-test.flag: one test event, flag deleted first; ignored when the setting is off', async () => {
    const a = setup(ON, true, true)
    await a.crash.start()
    await new Promise((r) => setTimeout(r, 0))
    expect(a.state.flag).toBe(false)
    expect(a.state.tests).toEqual(['sentry-test.flag'])

    const b = setup(ON, false, true)
    await b.crash.start()
    expect(b.state.flag).toBe(true)
    expect(b.state.tests).toEqual([])
  })

  it('character changes update the tag', async () => {
    const { crash, state } = setup(ON, true)
    crash.setCharacter('sumo-san') // not started yet: ignored
    await crash.start()
    crash.setCharacter('sumo-san')
    expect(state.tags).toEqual([['character', 'sumo-san']])
  })

  it('a failing SDK load is logged, never thrown', async () => {
    const { crash, state } = setup(ON, true)
    ;(crash as unknown as { deps: { load: () => Promise<never> } }).deps.load = () => Promise.reject(new Error('boom'))
    await expect(crash.start()).resolves.toBeUndefined()
    expect(crash.active).toBe(false)
    expect(state.logs.some((l) => l.includes('could not start'))).toBe(true)
  })
})
