// E2E-CRASH (TPM D28): crash reports go only to the (mock) ingest server, only when there is an
// error, scrubbed (no home path, no file names), and never while "Send crash reports" is off.
// The app is pointed at a loopback mock with LUD_E2E_SENTRY_URL (honoured only with LUD_E2E=1 in an
// unpackaged build; without it crash reporting is off in every other E2E spec).
import type { ElectronApplication, Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { T, expect, hook, test, waitForPage } from './support/app'
import { startSentryMock, type SentryMock } from './support/sentry-mock'

let mock: SentryMock

test.beforeEach(async () => {
  mock = await startSentryMock()
})
test.afterEach(async () => {
  await mock.close()
})

const HOME = homedir()
/** A message that names the user's home, a folder with a space and a file. */
const secretPath = (what: string): string => join(HOME, 'Secret Folder', `${what} tax-return 2025.pdf`)

async function openSettings(app: ElectronApplication): Promise<Page> {
  await hook(app, 'openSettingsWindow')
  const page = await waitForPage(app, 'settings')
  await expect(page.getByTestId('setting-crashReports')).toBeVisible({ timeout: T.window })
  return page
}

/** Throw an uncaught error inside the renderer (window.onerror path). */
async function throwInRenderer(page: Page, message: string): Promise<void> {
  await page.evaluate((m) => {
    setTimeout(() => {
      throw new Error(m)
    }, 0)
  }, message)
}

function expectScrubbed(json: string): void {
  expect(json).not.toContain(HOME)
  expect(json).not.toContain('Secret Folder')
  expect(json).not.toContain('tax-return')
  expect(json).not.toMatch(/\.pdf\b/)
}

async function settle(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

test.describe('crash reports', () => {
  test('E2E-CRASH-01 nothing is sent at launch when nothing breaks', async ({ lud }) => {
    const app = await lud.launchReady({ env: { LUD_E2E_SENTRY_URL: mock.url } })
    await openSettings(app)
    await settle(4_000)
    expect(mock.requests).toEqual([])
  })

  test('E2E-CRASH-02 a renderer error and an engine error arrive scrubbed', async ({ lud }, testInfo) => {
    const app = await lud.launchReady({
      env: { LUD_E2E_SENTRY_URL: mock.url, LUD_E2E_ENGINE_ERROR: `engine broke on ${secretPath('engine')}` }
    })
    const page = await openSettings(app)
    await throwInRenderer(page, `renderer broke on ${secretPath('renderer')}`)

    await expect
      .poll(() => mock.events().length, { timeout: T.job, message: 'expected a renderer and an engine event at the mock ingest' })
      .toBeGreaterThanOrEqual(2)
    const events = mock.events()
    const byProcess = (p: string) => events.find((e) => (e['tags'] as Record<string, string> | undefined)?.['event.process'] === p)
    const renderer = events.find((e) => JSON.stringify(e).includes('renderer broke on'))
    const engine = events.find((e) => JSON.stringify(e).includes('engine broke on'))
    expect(renderer, 'renderer event').toBeDefined()
    expect(engine, 'engine event').toBeDefined()
    expect(byProcess('utility'), 'engine event tagged event.process=utility').toBeDefined()

    for (const r of mock.requests) {
      expect(r.method).toBe('POST')
      expect(r.url).toMatch(/^\/api\/1\/envelope\/\?/)
      expectScrubbed(r.body)
      // Only events (and minidumps) leave the app: no sessions, no client reports, no spans.
      for (const item of r.envelope?.items ?? []) expect(['event', 'attachment']).toContain(item.headers['type'])
    }
    const value = (e: Record<string, unknown>) => (e['exception'] as { values: { value: string }[] }).values[0]!.value
    expect(value(renderer!)).toBe('renderer broke on ~/<path>')
    expect(value(engine!)).toBe('engine broke on ~/<path>')
    for (const e of [renderer!, engine!]) {
      expect(e['user']).toEqual({ ip_address: null })
      expect(e['request']).toBeUndefined()
      expect(e['server_name']).toBeUndefined()
      expect(e['release']).toMatch(/^lets-drag@\d/)
      expect(e['environment']).toBe('e2e')
      const tags = e['tags'] as Record<string, string>
      expect(Object.keys(tags).sort()).toEqual(expect.arrayContaining(['app.version', 'arch', 'channel', 'character', 'dodo_env', 'os']))
      for (const k of Object.keys(tags)) {
        expect(['app.version', 'os', 'arch', 'character', 'channel', 'dodo_env', 'event.process', 'event.environment', 'exit.reason']).toContain(k)
      }
    }
    // Kept in test-results/ for review: exactly what a report contains.
    for (const [name, e] of [['scrubbed-renderer-event.json', renderer], ['scrubbed-engine-event.json', engine]] as const) {
      const path = testInfo.outputPath(name)
      writeFileSync(path, JSON.stringify(e, null, 2))
      await testInfo.attach(name, { path, contentType: 'application/json' })
    }
  })

  test('E2E-CRASH-03 nothing is sent while "Send crash reports" is off; turning it on applies live', async ({ lud }) => {
    writeFileSync(join(lud.userDataDir, 'settings.json'), JSON.stringify({ firstRunDone: true, crashReports: false }))
    const app = await lud.launchReady({
      env: { LUD_E2E_SENTRY_URL: mock.url, LUD_E2E_ENGINE_ERROR: `engine broke on ${secretPath('engine')}` }
    })
    const page = await openSettings(app)
    const toggle = page.getByTestId('setting-crashReports')
    await expect(toggle).not.toBeChecked()
    await throwInRenderer(page, `renderer broke on ${secretPath('off')}`)
    await settle(4_000)
    expect(mock.requests).toEqual([])

    await toggle.click()
    await expect(toggle).toBeChecked()
    await throwInRenderer(page, `renderer broke on ${secretPath('on')}`)
    await expect.poll(() => mock.events().length, { timeout: T.job }).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(mock.events())).toContain('renderer broke on ~/<path>')
    for (const r of mock.requests) expectScrubbed(r.body)

    // Off again: dropped at once, in the same run.
    const before = mock.requests.length
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await throwInRenderer(page, `renderer broke on ${secretPath('off-again')}`)
    await settle(3_000)
    expect(mock.requests.length).toBe(before)
  })

  test('E2E-CRASH-04 "Report a problem" opens a prefilled e-mail and sends nothing', async ({ lud }) => {
    const app = await lud.launchReady({ env: { LUD_E2E_SENTRY_URL: mock.url } })
    const page = await openSettings(app)
    await page.getByTestId('report-problem').click()
    await expect.poll(async () => (await hook(app, 'openedUrls')).filter((u) => u.startsWith('mailto:')).length, { timeout: T.state }).toBe(1)
    const url = (await hook(app, 'openedUrls')).find((u) => u.startsWith('mailto:'))!
    expect(url).toMatch(/^mailto:support@wakeupmonster\.com\?subject=/)
    const body = decodeURIComponent(url.split('&body=')[1] ?? '')
    expect(body).toMatch(/App version: \d+\.\d+\.\d+/)
    expect(body).toMatch(/OS: (Linux|macOS|Windows) /)
    expect(url).not.toContain(encodeURIComponent(HOME))
    expect(mock.requests).toEqual([])
  })
})
