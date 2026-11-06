// D28: when crash reporting may run, tags / channel, release name, the "Report a problem" URL,
// the crashReports setting (migration of older files) and the developer tray item.
import { describe, expect, it } from 'vitest'
import {
  buildChannel,
  buildSentryDsn,
  crashReportingMode,
  crashTags,
  DEFAULT_SENTRY_DSN,
  e2eSentryDsn,
  parseDsn,
  releaseName,
  reportProblemUrl,
  shouldSend
} from '../../../src/main/crash/config'
import { parseSettings, settingsPatchSchema } from '../../../src/main/settings-store'
import { trayMenuTemplate } from '../../../src/main/tray'
import { DEFAULT_SETTINGS } from '../../../src/shared/types'

const DSN = DEFAULT_SENTRY_DSN

describe('parseDsn', () => {
  it('accepts the project DSN', () => {
    expect(parseDsn(DSN)).toEqual({
      origin: 'https://o4512383055626240.ingest.us.sentry.io',
      publicKey: 'a2dd68eda7b45b6b81a8592402434940',
      projectId: '4512383176867840'
    })
  })
  it('refuses anything else', () => {
    for (const bad of ['', '  ', 'nope', 'http://a2dd68eda7b45b6b@sentry.io/1', 'https://sentry.io/1', 'https://a2dd68eda7b45b6b:pw@sentry.io/1', 'https://a2dd68eda7b45b6b@sentry.io/x', 'ftp://a2dd68eda7b45b6b@h/1', 42]) {
      expect(parseDsn(bad), String(bad)).toBeNull()
    }
  })
  it('http only on loopback (E2E mock)', () => {
    expect(parseDsn('http://e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0@127.0.0.1:4567/1')?.origin).toBe('http://127.0.0.1:4567')
  })
  it('build DSN defaults to the project DSN under vitest (no define)', () => {
    expect(buildSentryDsn()).toBe(DSN)
  })
})

describe('crashReportingMode', () => {
  const base = { isPackaged: true, e2e: false, env: {}, buildDsn: DSN }
  it('packaged + DSN → on (production)', () => {
    expect(crashReportingMode(base)).toEqual({ enabled: true, dsn: DSN, origin: 'https://o4512383055626240.ingest.us.sentry.io', environment: 'production' })
  })
  it('empty or invalid DSN → off', () => {
    expect(crashReportingMode({ ...base, buildDsn: '' })).toEqual({ enabled: false, reason: 'no-dsn' })
    expect(crashReportingMode({ ...base, buildDsn: 'garbage' })).toEqual({ enabled: false, reason: 'no-dsn' })
  })
  it('unpackaged (dev, E2E) → off by default', () => {
    expect(crashReportingMode({ ...base, isPackaged: false })).toEqual({ enabled: false, reason: 'unpackaged' })
    expect(crashReportingMode({ ...base, isPackaged: false, e2e: true })).toEqual({ enabled: false, reason: 'unpackaged' })
  })
  it('E2E switch: loopback mock only, unpackaged only', () => {
    const on = crashReportingMode({ ...base, isPackaged: false, e2e: true, env: { LUD_E2E_SENTRY_URL: 'http://127.0.0.1:4567' } })
    expect(on).toMatchObject({ enabled: true, origin: 'http://127.0.0.1:4567', environment: 'e2e' })
    expect(crashReportingMode({ ...base, isPackaged: false, e2e: true, env: { LUD_E2E_SENTRY_URL: 'http://evil.example:4567' } }).enabled).toBe(false)
    expect(crashReportingMode({ ...base, isPackaged: false, e2e: true, env: { LUD_E2E_SENTRY_URL: 'https://o1.ingest.sentry.io' } }).enabled).toBe(false)
    // A packaged build ignores the switch (e2e is false there anyway, D12) and uses the build DSN.
    expect(crashReportingMode({ ...base, env: { LUD_E2E_SENTRY_URL: 'http://127.0.0.1:4567' } })).toMatchObject({ origin: 'https://o4512383055626240.ingest.us.sentry.io' })
  })
  it('developer switch LUD_SENTRY_DEV=1: unpackaged, not E2E, build DSN', () => {
    expect(crashReportingMode({ ...base, isPackaged: false, env: { LUD_SENTRY_DEV: '1' } })).toMatchObject({ enabled: true, environment: 'development', dsn: DSN })
    expect(crashReportingMode({ ...base, isPackaged: false, e2e: true, env: { LUD_SENTRY_DEV: '1' } }).enabled).toBe(false)
    expect(crashReportingMode({ ...base, isPackaged: false, env: { LUD_SENTRY_DEV: '1' }, buildDsn: '' }).enabled).toBe(false)
  })
  it('e2eSentryDsn', () => {
    expect(e2eSentryDsn(undefined)).toBeNull()
    expect(e2eSentryDsn('http://localhost')).toBeNull()
    expect(e2eSentryDsn('http://[::1]:9/')).toBe('http://e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0@[::1]:9/1')
  })
  it('shouldSend needs both an enabled mode and the user setting', () => {
    const on = crashReportingMode(base)
    expect(shouldSend(on, true)).toBe(true)
    expect(shouldSend(on, false)).toBe(false)
    expect(shouldSend({ enabled: false, reason: 'unpackaged' }, true)).toBe(false)
  })
})

describe('tags, channel and release', () => {
  it('build channel: team when licensing is off', () => {
    expect(buildChannel(false)).toBe('team')
    expect(buildChannel(true)).toBe('user')
  })
  it('only the allowed tags', () => {
    expect(crashTags({ version: '1.2.3', platform: 'darwin', arch: 'arm64', character: 'nonna-pina', licensingEnabled: false, dodoEnv: 'live' })).toEqual({
      'app.version': '1.2.3',
      os: 'darwin',
      arch: 'arm64',
      character: 'nonna-pina',
      channel: 'team',
      dodo_env: 'live'
    })
  })
  it('release name', () => {
    expect(releaseName('0.1.0')).toBe('lets-drag@0.1.0')
  })
})

describe('reportProblemUrl', () => {
  it('mailto with version and OS only', () => {
    const url = reportProblemUrl({ version: '0.1.0', platform: 'win32', osRelease: '10.0.22631', arch: 'x64' })
    expect(url.startsWith('mailto:support@wakeupmonster.com?subject=')).toBe(true)
    const body = decodeURIComponent(url.split('&body=')[1]!)
    expect(body).toContain('App version: 0.1.0')
    expect(body).toContain('OS: Windows 10.0.22631 (x64)')
    expect(url).not.toContain('+')
  })
  it('cannot be used to inject other headers', () => {
    const url = reportProblemUrl({ version: '0.1.0', platform: 'linux', osRelease: '6.1&cc=evil@x.com', arch: 'x64&bcc=a' })
    expect(url).not.toMatch(/&cc=|&bcc=/)
  })
})

describe('crashReports setting', () => {
  it('defaults to on, also for settings files written before it existed', () => {
    expect(DEFAULT_SETTINGS.crashReports).toBe(true)
    expect(parseSettings({ triggerKey: 'alt', sounds: false }).crashReports).toBe(true)
    expect(parseSettings({ crashReports: 'no' }).crashReports).toBe(true)
    expect(parseSettings({ crashReports: false }).crashReports).toBe(false)
  })
  it('renderers may patch it (boolean only)', () => {
    expect(settingsPatchSchema.parse({ crashReports: false })).toEqual({ crashReports: false })
    expect(() => settingsPatchSchema.parse({ crashReports: 'off' })).toThrow()
  })
})

describe('developer tray item', () => {
  const deps = {
    openFeedWindow: () => undefined,
    openSettingsWindow: () => undefined,
    setPaused: () => undefined,
    quit: () => undefined,
    buyLicence: () => undefined,
    openActivation: () => undefined
  }
  const labels = (d: Parameters<typeof trayMenuTemplate>[1]) => trayMenuTemplate({ paused: false, gestureUnavailable: null, licensed: true }, d).map((i) => i.label)
  it('only when main passes the action (unpackaged builds)', () => {
    expect(labels(deps)).not.toContain('Send test crash report (development)')
    let sent = 0
    const items = trayMenuTemplate({ paused: false, gestureUnavailable: null, licensed: true }, { ...deps, sendTestCrashReport: () => sent++ })
    const item = items.find((i) => i.label === 'Send test crash report (development)')
    expect(item).toBeDefined()
    ;(item!.click as () => void)()
    expect(sent).toBe(1)
  })
})
