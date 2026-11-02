// E2E-LIC: paid licensing (TPM D26) against a local mock of Dodo's licence endpoints.
// The app starts unlicensed here (LUD_E2E_LICENSE=none) and talks to the mock (LUD_E2E_DODO_URL);
// both are honoured only with LUD_E2E=1 in an unpackaged build (D12, D18).
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { LudApi } from '../../src/shared/api'
import type { LicenceView } from '../../src/shared/licence'
import { T, expect, expectUncleState, hook, jobEvents, screenshot, test, waitForPage, waitForTerminalEvent, type LudSession } from './support/app'
import { startDodoMock, type DodoMock } from './support/dodo-mock'
import { makePng } from './support/fixtures'
import { expectOverlayHidesItself, outputsOf } from './support/flows'
import { expectedOutputPath } from './support/naming'

const KEY = 'LD7Q-29XK-PM3A-1A2B'
const CHECKOUT =
  'https://test.checkout.dodopayments.com/buy/pdt_0Nqn0nhO4z3NeUwcXy0n3?quantity=1&redirect_url=https%3A%2F%2Fletsdrag.wakeupmonster.com%2Fthanks%2F'

let mock: DodoMock
test.beforeEach(async () => {
  mock = await startDodoMock()
})
test.afterEach(async () => {
  await mock.close()
})

async function launchUnlicensed(lud: LudSession, dodoUrl: string = mock.url): Promise<ElectronApplication> {
  return lud.launchReady({ env: { LUD_E2E_LICENSE: 'none', LUD_E2E_DODO_URL: dodoUrl } })
}

async function licence(app: ElectronApplication): Promise<LicenceView> {
  return (await hook(app, 'licence')) as LicenceView
}

async function openSettings(app: ElectronApplication): Promise<Page> {
  await hook(app, 'openSettingsWindow')
  const page = await waitForPage(app, 'settings')
  await expect(page.getByTestId('licence-card')).toBeVisible({ timeout: T.window })
  return page
}

async function activateIn(page: Page, key: string): Promise<string> {
  await page.getByTestId('licence-key').fill(key)
  await page.getByTestId('licence-activate').click()
  const msg = page.getByTestId('licence-message')
  await expect(msg).toBeVisible({ timeout: T.state })
  return (await msg.textContent()) ?? ''
}

async function openFeed(app: ElectronApplication): Promise<Page> {
  await hook(app, 'openFeedWindow')
  const feed = await waitForPage(app, 'feed')
  await expect(feed.getByTestId('feed-dropzone')).toBeVisible({ timeout: T.window })
  return feed
}

const feedState = (feed: Page) => feed.getByTestId('feed-root').getAttribute('data-uncle-state')

test.describe('licensing (D26)', () => {
  test('E2E-LIC-01 unlicensed: the Uncle appears but nothing converts; every path leads to "Unlock for $9.50"', async ({ lud }, testInfo) => {
    const app = await launchUnlicensed(lud)
    expect((await licence(app)).status).toBe('unlicensed')
    const input = await makePng(join(lud.workDir, 'photo.png'))

    // Overlay: drop on an option → unlock bubble, no job.
    await hook(app, 'dropFiles', [input], 'to-jpg')
    const overlay = await waitForPage(app, 'overlay')
    await expectUncleState(overlay, 'locked')
    await expect(overlay.getByTestId('unlock-bubble')).toContainText('Unlock for $9.50')
    await expect(overlay.getByTestId('unlock-buy')).toBeVisible()
    await expect(overlay.getByTestId('unlock-key')).toBeVisible()
    await expect(overlay.locator('[data-testid^="option-"]')).toHaveCount(0)
    await screenshot(overlay, testInfo, 'overlay-locked')

    // Buy opens the checkout in the default browser (recorded in E2E; no browser starts).
    await overlay.getByTestId('unlock-buy').click()
    await expect.poll(() => hook(app, 'openedUrls'), { timeout: T.state }).toEqual([CHECKOUT])
    await expectOverlayHidesItself(app)

    // Remove BG: no job, so no model download either.
    await hook(app, 'dropFiles', [input], 'remove-bg')
    await expectUncleState(overlay, 'locked')
    // × closes him.
    await overlay.getByTestId('unlock-close').click()
    await expectOverlayHidesItself(app)

    // Feed Window rests on the unlock bubble; a drop does not convert either.
    const feed = await openFeed(app)
    await expect(feed.getByTestId('unlock-bubble')).toContainText('Unlock for $9.50')
    await screenshot(feed, testInfo, 'feed-locked')
    await hook(app, 'dropFilesOnFeed', [input], 'to-jpg')
    await expect.poll(() => feedState(feed), { timeout: T.state }).toBe('locked')

    // "I have a key" opens Settings → Activate.
    await feed.getByTestId('unlock-key').click()
    const settings = await waitForPage(app, 'settings')
    await expect(settings.getByTestId('licence-status')).toHaveText('Not activated')
    await expect(settings.getByTestId('licence-key')).toBeFocused()

    // Main enforces it too: a renderer calling startJob directly is refused with a typed result.
    const direct = await feed.evaluate(
      (p) => (globalThis as unknown as { lud: LudApi }).lud.startJob({ id: 'direct-1', optionId: 'to-jpg', inputPaths: [p] }),
      input
    )
    expect(direct).toEqual({ started: false, reason: 'LICENCE_REQUIRED' })

    await new Promise((r) => setTimeout(r, 1_000))
    expect(await jobEvents(app), 'no job may run without a licence').toEqual([])
    expect(existsSync(expectedOutputPath(input, 'jpg'))).toBe(false)
    expect(existsSync(join(lud.userDataDir, 'models')), 'no Remove BG model download').toBe(false)
    expect(mock.requests, 'no licence traffic without a user action').toEqual([])
  })

  test('E2E-LIC-02 activate: success unlocks at once, converts, sends only key + anonymous label, survives a restart', async ({ lud }, testInfo) => {
    mock.addKey(KEY)
    const app = await launchUnlicensed(lud)
    const settings = await openSettings(app)
    await screenshot(settings, testInfo, 'settings-unlicensed')
    const msg = await activateIn(settings, `  ${KEY}\n`)
    expect(msg).toBe('Activated on this computer. Your licence works on 2 computers.')
    await expect(settings.getByTestId('licence-status')).toHaveText('Active')
    await expect(settings.getByTestId('licence-masked-key')).toHaveText('LD7Q-…-1A2B')
    expect(await settings.getByTestId('licence-card').textContent()).not.toContain('29XK')
    await screenshot(settings, testInfo, 'settings-active')

    expect(mock.requests).toHaveLength(1)
    const req = mock.requests[0]!
    expect(req.path).toBe('/licenses/activate')
    expect(Object.keys(req.body).sort()).toEqual(['license_key', 'name'])
    expect(req.body['license_key']).toBe(KEY)
    expect(String(req.body['name'])).toMatch(/^Linux · [a-z0-9_]+ · [0-9a-f]{6}$/)
    expect(req.headers['authorization']).toBeUndefined()
    expect(req.headers['cookie']).toBeUndefined()
    expect(req.headers['user-agent']).toMatch(/^LetsDrag\/\d+\.\d+\.\d+$/)
    expect(req.headers['accept-language']).toBeUndefined()
    expect((await licence(app)).status).toBe('active')

    // Conversions work now.
    const input = await makePng(join(lud.workDir, 'paid.png'))
    const before = (await jobEvents(app)).length
    await hook(app, 'dropFilesOnFeed', [input], 'to-jpg')
    const event = await waitForTerminalEvent(app, before)
    expect(event.type, JSON.stringify(event)).toBe('done')
    expect(outputsOf(event)).toEqual([expectedOutputPath(input, 'jpg')])

    // Restart: still active, offline (no request at launch).
    await lud.close(app)
    const requestsBefore = mock.requests.length
    const app2 = await launchUnlicensed(lud, 'http://127.0.0.1:9')
    expect((await licence(app2)).status).toBe('active')
    expect(mock.requests.length).toBe(requestsBefore)
  })

  test('E2E-LIC-03 activation errors: 404, 403, 422 and offline show the friendly messages', async ({ lud }, testInfo) => {
    mock.addKey('REFUNDED-KEY-0001', { status: 'disabled' })
    mock.addKey('FULL-KEY-0001', { instances: ['lki_a', 'lki_b'] })
    const app = await launchUnlicensed(lud)
    const settings = await openSettings(app)

    expect(await activateIn(settings, 'NO-SUCH-KEY-0001')).toBe("We couldn't find that key. Check it against your email from Dodo Payments.")
    expect(await activateIn(settings, 'REFUNDED-KEY-0001')).toBe(
      "This key isn't active (it may have been refunded). Write to support@wakeupmonster.com."
    )
    expect(await activateIn(settings, 'FULL-KEY-0001')).toBe(
      'This key is already active on 2 computers. On one of them, go to Settings → Deactivate this computer, then try again.'
    )
    await screenshot(settings, testInfo, 'settings-error-422')
    mock.mode = 'drop'
    expect(await activateIn(settings, 'FULL-KEY-0001')).toBe('Activating needs the internet once. Check your connection and try again.')
    mock.mode = 'down'
    expect(await activateIn(settings, 'FULL-KEY-0001')).toContain('support@wakeupmonster.com')
    await expect(settings.getByTestId('licence-status')).toHaveText('Not activated')
    expect((await licence(app)).status).toBe('unlicensed')
  })

  test('E2E-LIC-04 deactivate: confirm first; online frees the seat, offline keeps the licence', async ({ lud }, testInfo) => {
    const key = mock.addKey(KEY)
    const app = await launchUnlicensed(lud)
    const settings = await openSettings(app)
    await activateIn(settings, KEY)
    expect(key.instances.size).toBe(1)

    // Offline: keeps the licence and says so.
    await settings.getByTestId('licence-deactivate').click()
    await expect(settings.getByTestId('deactivate-dialog')).toBeVisible()
    await screenshot(settings, testInfo, 'settings-deactivate-confirm')
    mock.mode = 'drop'
    await settings.getByTestId('deactivate-confirm').click()
    await expect(settings.getByTestId('licence-message')).toHaveText(
      "Deactivating needs the internet so the seat is freed. Try again when you're online."
    )
    expect((await licence(app)).status).toBe('active')
    expect(key.instances.size).toBe(1)

    // "Keep it" cancels without any request.
    mock.mode = 'normal'
    const n = mock.requests.length
    await settings.getByTestId('licence-deactivate').click()
    await settings.getByTestId('deactivate-cancel').click()
    await expect(settings.getByTestId('deactivate-dialog')).toHaveCount(0)
    expect(mock.requests.length).toBe(n)

    // Online: frees the seat and returns to the paywall.
    await settings.getByTestId('licence-deactivate').click()
    await settings.getByTestId('deactivate-confirm').click()
    await expect(settings.getByTestId('licence-status')).toHaveText('Not activated', { timeout: T.state })
    expect(key.instances.size).toBe(0)
    expect(mock.requests.at(-1)?.path).toBe('/licenses/deactivate')
    expect(Object.keys(mock.requests.at(-1)!.body).sort()).toEqual(['license_key', 'license_key_instance_id'])
    expect((await licence(app)).status).toBe('unlicensed')
    const feed = await openFeed(app)
    await expect(feed.getByTestId('unlock-bubble')).toBeVisible()
  })

  test('E2E-LIC-05 background re-check: offline / 5xx / timeout never lock; a disabled key locks after the confirm re-check', async ({ lud }, testInfo) => {
    const key = mock.addKey(KEY)
    const app = await launchUnlicensed(lud)
    const settings = await openSettings(app)
    await activateIn(settings, KEY)

    for (const mode of ['drop', 'down', 'hang'] as const) {
      mock.mode = mode
      expect(await hook(app, 'licenceRecheckNow'), `re-check with mock ${mode}`).toBe('transient')
      expect((await licence(app)).status, `still active after ${mode}`).toBe('active')
    }
    mock.mode = 'normal'
    expect(await hook(app, 'licenceRecheckNow')).toBe('valid')

    // Refunded: Dodo now says not valid. One check, a confirm check, then the key alone.
    key.status = 'disabled'
    const before = mock.requests.length
    expect(await hook(app, 'licenceRecheckNow')).toBe('disabled')
    const checks = mock.requests.slice(before)
    expect(checks.map((r) => r.path)).toEqual(['/licenses/validate', '/licenses/validate', '/licenses/validate'])
    expect(checks.map((r) => 'license_key_instance_id' in r.body)).toEqual([true, true, false])
    expect((await licence(app)).status).toBe('disabled')

    // Settings explains it; the Uncle shows the unlock bubble with the explanation; nothing converts.
    await expect(settings.getByTestId('licence-status')).toHaveText('Disabled')
    await expect(settings.getByTestId('licence-explanation')).toContainText('This licence key was disabled (for example after a refund).')
    await screenshot(settings, testInfo, 'settings-disabled')
    const input = await makePng(join(lud.workDir, 'after-refund.png'))
    const eventsBefore = (await jobEvents(app)).length
    await hook(app, 'dropFiles', [input], 'to-jpg')
    const overlay = await waitForPage(app, 'overlay')
    await expectUncleState(overlay, 'locked')
    await expect(overlay.getByTestId('unlock-explanation')).toContainText('support@wakeupmonster.com')
    await screenshot(overlay, testInfo, 'overlay-disabled')
    await new Promise((r) => setTimeout(r, 800))
    expect((await jobEvents(app)).length).toBe(eventsBefore)

    // A key re-enabled in the dashboard unlocks again at the next check.
    key.status = 'active'
    expect(await hook(app, 'licenceRecheckNow')).toBe('valid')
    expect((await licence(app)).status).toBe('active')
  })

  test('E2E-LIC-06 removed activation but valid key → "activate again", which works', async ({ lud }, testInfo) => {
    const key = mock.addKey(KEY)
    const app = await launchUnlicensed(lud)
    const settings = await openSettings(app)
    await activateIn(settings, KEY)
    key.instances.clear() // removed in the Dodo dashboard

    expect(await hook(app, 'licenceRecheckNow')).toBe('reactivate')
    expect((await licence(app)).status).toBe('reactivate')
    await expect(settings.getByTestId('licence-status')).toHaveText('Needs activating again')
    await expect(settings.getByTestId('licence-explanation')).toContainText('activate it again')
    await expect(settings.getByTestId('licence-activate')).toHaveText('Activate again')
    await screenshot(settings, testInfo, 'settings-reactivate')

    await settings.getByTestId('licence-activate').click()
    await expect(settings.getByTestId('licence-status')).toHaveText('Active', { timeout: T.state })
    expect(key.instances.size).toBe(1)
    expect(mock.requests.at(-1)?.body['license_key']).toBe(KEY)
  })

  test('E2E-LIC-07 the E2E fixture starts licensed; without LUD_E2E=1 the licence test env is ignored', async ({ lud }) => {
    // The fixture default (LUD_E2E_LICENSE=active) keeps the conversion specs meaningful.
    const app = await lud.launchReady()
    expect((await licence(app)).status).toBe('active')
    await lud.close(app)
    // Without LUD_E2E=1 the licence env is ignored: the app starts unlicensed. First run opens
    // Settings (onboarding) outside E2E; read the state it shows.
    const plain = await lud.launch({ e2e: false, env: { LUD_E2E_LICENSE: 'active' } })
    const status = async (): Promise<string | null> =>
      plain.evaluate(async ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && /\/settings\/index\.html/.test(x.webContents.getURL()))
        if (!w || w.webContents.isLoading()) return null
        return (await w.webContents.executeJavaScript('window.lud.getLicence().then((v) => v.status)')) as string
      })
    await expect.poll(status, { timeout: T.window }).toBe('unlicensed')
  })
})
