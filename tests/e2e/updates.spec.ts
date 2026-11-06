// E2E-UPD: soft and force update notices (TPM D29) against a local stand-in for the website's manifest.
// The app reads it from LUD_E2E_UPDATE_URL (honoured only with LUD_E2E=1 in an unpackaged build; loopback
// only). Without it (the default fixture) the checker points at an unroutable address: no update state.
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { LudApi } from '../../src/shared/api'
import type { UpdateView } from '../../src/shared/update'
import { T, expect, expectUncleState, hook, screenshot, test, waitForPage, waitForTerminalEvent, jobEvents, type LudSession } from './support/app'
import { makePng } from './support/fixtures'
import { expectOverlayHidesItself, outputsOf } from './support/flows'
import { expectedOutputPath } from './support/naming'
import { expectedDownload, makeManifest, startUpdateMock, type UpdateMock } from './support/update-mock'

let mock: UpdateMock | null = null
test.afterEach(async () => {
  await mock?.close()
  mock = null
})

async function launchWith(lud: LudSession, url: string): Promise<ElectronApplication> {
  return lud.launchReady({ env: { LUD_E2E_UPDATE_URL: url } })
}

async function view(app: ElectronApplication): Promise<UpdateView> {
  return (await hook(app, 'update')) as UpdateView
}

async function openSettings(app: ElectronApplication): Promise<Page> {
  await hook(app, 'openSettingsWindow')
  const page = await waitForPage(app, 'settings')
  await expect(page.getByTestId('update-card')).toBeVisible({ timeout: T.window })
  return page
}

async function openFeed(app: ElectronApplication): Promise<Page> {
  await hook(app, 'openFeedWindow')
  const feed = await waitForPage(app, 'feed')
  await expect(feed.getByTestId('feed-dropzone')).toBeVisible({ timeout: T.window })
  return feed
}

/** One conversion through the Feed Window (or the overlay: the Feed Window shows its result card for 6 s). */
async function convertOnFeed(app: ElectronApplication, input: string, via: 'feed' | 'overlay' = 'feed'): Promise<void> {
  const before = (await jobEvents(app)).length
  if (via === 'feed') await hook(app, 'dropFilesOnFeed', [input], 'to-jpg')
  else await hook(app, 'dropFiles', [input], 'to-jpg')
  const event = await waitForTerminalEvent(app, before)
  expect(event.type, JSON.stringify(event)).toBe('done')
  expect(outputsOf(event)).toEqual([expectedOutputPath(input, 'jpg')])
}

/** A real file dragenter/dragover on the overlay page (synthetic DragEvent carrying a PNG File). */
async function dragPngOver(overlay: Page): Promise<void> {
  await overlay.evaluate(`(() => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(8)], 'photo.png', { type: 'image/png' }))
    for (const type of ['dragenter', 'dragover']) {
      window.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: 280, clientY: 320, dataTransfer: dt }))
    }
  })()`)
}

test.describe('update notices (D29)', () => {
  test('E2E-UPD-01 default fixture: no update state, no request; up to date after a check; the request carries nothing', async ({ lud }, testInfo) => {
    // Default E2E launch (no manifest URL): nothing known, nothing blocked.
    const plain = await lud.launchReady()
    expect(await view(plain)).toMatchObject({ status: 'current', latestVersion: null, hint: false })
    const s0 = await openSettings(plain)
    await expect(s0.getByTestId('update-banner')).toHaveCount(0)
    await expect(s0.getByTestId('update-status-text')).toHaveText("You're up to date (v0.1.0).")
    await lud.close(plain)

    mock = await startUpdateMock(makeManifest('0.1.0', '0.1.0'))
    const app = await launchWith(lud, mock.url)
    const settings = await openSettings(app)
    expect(mock.requests, 'never a request at start-up').toEqual([])
    await settings.getByTestId('update-check').click()
    await expect.poll(() => mock!.requests.length, { timeout: T.state }).toBe(1)
    await expect(settings.getByTestId('update-status-text')).toHaveText("You're up to date (v0.1.0).")
    await expect(settings.getByTestId('update-check-failed')).toHaveCount(0)
    await screenshot(settings, testInfo, 'settings-up-to-date')

    // Privacy: a plain GET of the manifest, no query, no body, no cookies, generic user agent.
    const req = mock.requests[0]!
    expect(req.method).toBe('GET')
    expect(req.url).toBe('/update.json')
    expect(req.body).toBe('')
    expect(req.headers['cookie']).toBeUndefined()
    expect(req.headers['authorization']).toBeUndefined()
    expect(req.headers['accept-language']).toBeUndefined()
    expect(req.headers['user-agent']).toBe('LetsDrag/0.1.0')
    expect((await view(app)).status).toBe('current')
  })

  test('E2E-UPD-02 soft update: banner + tray + one Uncle bubble; Later persists across a restart; conversions keep working', async ({ lud }, testInfo) => {
    const manifest = makeManifest('0.2.0', '0.1.0')
    mock = await startUpdateMock(manifest)
    const app = await launchWith(lud, mock.url)
    expect(await hook(app, 'updateCheckNow')).toBe(true)
    expect(await view(app)).toMatchObject({ status: 'available', latestVersion: '0.2.0', hint: true, dismissed: false })

    // The Uncle announces it once, when he next appears; it never blocks the gesture.
    await hook(app, 'arm')
    const overlay = await waitForPage(app, 'overlay')
    // The hidden overlay may only get the broadcast once main shows its sensor (a person's drag comes later).
    await expect(overlay.getByTestId('overlay-root')).toHaveAttribute('data-update-status', 'available', { timeout: T.state })
    await dragPngOver(overlay)
    await expectUncleState(overlay, ['appear', 'hover'])
    await expect(overlay.getByTestId('update-hint')).toHaveText('★I learned new tricks! Update in Settings.')
    await expect(overlay.locator('[data-testid^="option-"]').first()).toBeVisible()
    await screenshot(overlay, testInfo, 'overlay-soft-hint')
    await expect.poll(async () => (await view(app)).hint, { timeout: T.state }).toBe(false)
    await hook(app, 'disarm')
    await expectOverlayHidesItself(app)
    // Next time: no bubble.
    await hook(app, 'arm')
    await dragPngOver(overlay)
    await expectUncleState(overlay, ['appear', 'hover'])
    await expect(overlay.getByTestId('update-hint')).toHaveCount(0)
    await hook(app, 'disarm')
    await expectOverlayHidesItself(app)

    // Conversions still work.
    const input = await makePng(join(lud.workDir, 'soft.png'))
    await convertOnFeed(app, input)

    // Settings: banner with notes, Download (this computer's installer) and Later.
    const settings = await openSettings(app)
    const banner = settings.getByTestId('update-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toHaveAttribute('data-update-status', 'available')
    await expect(banner).toContainText('Update available: v0.2.0')
    await expect(settings.getByTestId('update-notes')).toContainText('HEIC')
    await screenshot(settings, testInfo, 'settings-soft')
    await settings.getByTestId('update-download').click()
    await expect.poll(() => hook(app, 'openedUrls'), { timeout: T.state }).toEqual([expectedDownload(manifest)])
    await settings.getByTestId('update-later').click()
    await expect(banner).toHaveCount(0)
    await expect(settings.getByTestId('update-status-text')).toHaveText('v0.2.0 is available.')
    expect(await view(app)).toMatchObject({ dismissed: true, hint: false })

    // Restart: Later is remembered (its own file in userData, not settings.json).
    await lud.close(app)
    expect(existsSync(join(lud.userDataDir, 'update-state.json'))).toBe(true)
    const app2 = await launchWith(lud, mock.url)
    expect(await view(app2)).toMatchObject({ status: 'available', dismissed: true })
    const s2 = await openSettings(app2)
    await expect(s2.getByTestId('update-banner')).toHaveCount(0)
    await expect(s2.getByTestId('update-card-download')).toBeVisible()
    await convertOnFeed(app2, await makePng(join(lud.workDir, 'soft-2.png')))
  })

  test('E2E-UPD-03 force update: main refuses jobs; overlay, Feed and Settings say "update"; survives an offline restart; a lower minimum unblocks', async ({
    lud
  }, testInfo) => {
    const manifest = makeManifest('0.2.0', '0.2.0')
    mock = await startUpdateMock(manifest)
    const port = Number(new URL(mock.url).port)
    const app = await launchWith(lud, mock.url)
    expect(await hook(app, 'updateCheckNow')).toBe(true)
    expect((await view(app)).status).toBe('required')
    const input = await makePng(join(lud.workDir, 'old.png'))

    // Overlay: one big "Please update me" bubble + Download; nothing is eaten.
    await hook(app, 'dropFiles', [input], 'to-jpg')
    const overlay = await waitForPage(app, 'overlay')
    await expectUncleState(overlay, 'locked')
    await expect(overlay.getByTestId('overlay-root')).toHaveAttribute('data-lock-reason', 'update')
    await expect(overlay.getByTestId('update-bubble')).toContainText('Please update me')
    await expect(overlay.getByTestId('unlock-buy')).toHaveCount(0)
    await screenshot(overlay, testInfo, 'overlay-force')
    await overlay.getByTestId('update-download').click()
    await expect.poll(() => hook(app, 'openedUrls'), { timeout: T.state }).toEqual([expectedDownload(manifest)])
    await expectOverlayHidesItself(app)
    // × closes him too (Remove BG: no job, so no model download).
    await hook(app, 'dropFiles', [input], 'remove-bg')
    await expectUncleState(overlay, 'locked')
    await overlay.getByTestId('update-close').click()
    await expectOverlayHidesItself(app)

    // Feed Window rests on the update bubble; main refuses a direct startJob.
    const feed = await openFeed(app)
    await expect(feed.getByTestId('update-bubble')).toContainText('Please update me')
    await screenshot(feed, testInfo, 'feed-force')
    const direct = await feed.evaluate(
      (p) => (globalThis as unknown as { lud: LudApi }).lud.startJob({ id: 'direct-upd-1', optionId: 'to-jpg', inputPaths: [p] }),
      input
    )
    expect(direct).toEqual({ started: false, reason: 'UPDATE_REQUIRED' })

    // Settings: red banner, no "Later".
    const settings = await openSettings(app)
    await expect(settings.getByTestId('update-banner')).toHaveAttribute('data-update-status', 'required')
    await expect(settings.getByTestId('update-required-text')).toContainText("can't convert files anymore")
    await expect(settings.getByTestId('update-later')).toHaveCount(0)
    await screenshot(settings, testInfo, 'settings-force')

    await new Promise((r) => setTimeout(r, 800))
    expect(await jobEvents(app), 'no job may run while an update is required').toEqual([])
    expect(existsSync(expectedOutputPath(input, 'jpg'))).toBe(false)
    expect(existsSync(join(lud.userDataDir, 'models')), 'no Remove BG model download').toBe(false)

    // Restart offline: the cached manifest keeps it blocked.
    await lud.close(app)
    await mock.close()
    mock = null
    const app2 = await launchWith(lud, `http://127.0.0.1:${port}/update.json`)
    expect((await view(app2)).status).toBe('required')
    expect(await hook(app2, 'updateCheckNow')).toBe(false)
    expect((await view(app2)).status).toBe('required')
    const feed2 = await openFeed(app2)
    const refused = await feed2.evaluate(
      (p) => (globalThis as unknown as { lud: LudApi }).lud.startJob({ id: 'direct-upd-2', optionId: 'to-jpg', inputPaths: [p] }),
      input
    )
    expect(refused).toEqual({ started: false, reason: 'UPDATE_REQUIRED' })

    // Back online, the website lowered the minimum: unblocked (a soft update remains), the Feed Window converts.
    mock = await startUpdateMock(makeManifest('0.2.0', '0.1.0'), port)
    expect(await hook(app2, 'updateCheckNow')).toBe(true)
    expect((await view(app2)).status).toBe('available')
    await expect(feed2.getByTestId('update-bubble')).toHaveCount(0)
    await convertOnFeed(app2, input)
  })

  test('E2E-UPD-04 offline, 500 and bad JSON never block and keep the previous state', async ({ lud }) => {
    mock = await startUpdateMock(makeManifest('0.2.0', '0.1.0'))
    const app = await launchWith(lud, mock.url)
    for (const mode of ['drop', 'down', 'bad'] as const) {
      mock.mode = mode
      expect(await hook(app, 'updateCheckNow'), mode).toBe(false)
      expect((await view(app)).status, mode).toBe('current')
    }
    const settings = await openSettings(app)
    await settings.getByTestId('update-check').click()
    await expect(settings.getByTestId('update-check-failed')).toHaveText("Couldn't reach our website. Try again later.")
    await expect(settings.getByTestId('update-banner')).toHaveCount(0)
    await convertOnFeed(app, await makePng(join(lud.workDir, 'offline.png')))

    // A known soft update survives later failures; still nothing blocked.
    mock.mode = 'normal'
    expect(await hook(app, 'updateCheckNow')).toBe(true)
    mock.mode = 'down'
    expect(await hook(app, 'updateCheckNow')).toBe(false)
    expect((await view(app)).status).toBe('available')
    await convertOnFeed(app, await makePng(join(lud.workDir, 'offline-2.png')), 'overlay')
  })
})
