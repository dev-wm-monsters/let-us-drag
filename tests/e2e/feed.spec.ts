// E2E-FEED: the Feed Window fallback (Wayland / no macOS permission / preference).
// Test plan IDs: E2E-50..E2E-55, FEED-01..FEED-04 (docs/qa/TEST_PLAN.md).
// E2E-53..55 drive the Feed Window through __ludTest.dropFilesOnFeed (TPM decision D2, phase 2).
import type { ElectronApplication, Page } from '@playwright/test'
import { join } from 'node:path'
import { NEEDS_INTEGRATION, T, expect, hook, jobEvents, screenshot, test, waitForPage, waitForTerminalEvent, windowInfo } from './support/app'
import { listNames, makeBlocked, makePng } from './support/fixtures'
import { expectNoNewJob, outputsOf } from './support/flows'
import { expectedOutputPath, isSubsequence } from './support/naming'
import { NEEDS_P2, expectAttr, hookP2, stageSamples, startStageRecorder } from './support/p2'

async function openFeed(app: ElectronApplication): Promise<Page> {
  await hook(app, 'openFeedWindow')
  const feed = await waitForPage(app, 'feed')
  await expect(feed.getByTestId('feed-dropzone')).toBeVisible({ timeout: T.window })
  await startStageRecorder(feed, 'feed-root')
  return feed
}

test.describe('feed window', () => {
  test('E2E-50 feed window opens and shows the drop zone', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    await hook(app, 'openFeedWindow')
    const feed = await waitForPage(app, 'feed')
    await expect(feed.getByTestId('feed-dropzone')).toBeVisible({ timeout: T.window })
    await expect.poll(async () => (await windowInfo(app, 'feed')).visible, { timeout: T.window }).toBe(true)
    await screenshot(feed, testInfo, 'feed-window')
  })

  test('E2E-51 opening the feed window twice reuses one window', { tag: NEEDS_INTEGRATION }, async ({ lud }) => {
    const app = await lud.launchReady()
    await hook(app, 'openFeedWindow')
    await waitForPage(app, 'feed')
    await hook(app, 'openFeedWindow')
    await new Promise((r) => setTimeout(r, 1_000))
    const count = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && /\/feed\/index\.html/.test(w.webContents.getURL())).length
    )
    expect(count).toBe(1)
  })

  test('E2E-52 the preload API can open the feed window from a renderer', { tag: NEEDS_INTEGRATION }, async ({ lud }) => {
    // Settings → "Open Feed Window" uses window.lud.openFeedWindow() (PLAN §2).
    const app = await lud.launchReady()
    await hook(app, 'openSettingsWindow')
    const settings = await waitForPage(app, 'settings')
    await settings.evaluate(() => (globalThis as unknown as { lud: { openFeedWindow(): Promise<void> } }).lud.openFeedWindow())
    const feed = await waitForPage(app, 'feed')
    await expect(feed.getByTestId('feed-dropzone')).toBeVisible({ timeout: T.window })
  })

  test('E2E-53 drop a PNG on the Feed Window\'s JPG option → eat → chew → spit, output next to the input', { tag: NEEDS_P2 }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const feed = await openFeed(app)
    const input = await makePng(join(lud.workDir, 'fed.png'))
    const before = (await jobEvents(app)).length
    await hookP2(app, 'dropFilesOnFeed', [input], 'to-jpg')
    const event = await waitForTerminalEvent(app, before)
    expect(event.type, JSON.stringify(event)).toBe('done')
    expect(outputsOf(event)).toEqual([expectedOutputPath(input, 'jpg')])
    await expectAttr(feed, 'feed-root', 'data-uncle-state', 'spit')
    await screenshot(feed, testInfo, 'feed-spit')
    await expect(feed.getByTestId('output-card')).toContainText('fed.jpg')
    const states = (await stageSamples(feed, 'feed-root')).map((s) => s.state)
    expect(isSubsequence(['eat', 'chew', 'spit'], states), states.join(' → ')).toBe(true)
    // The Feed Window stays open and returns to rest (it is not the overlay: it never hides itself).
    await expectAttr(feed, 'feed-root', 'data-uncle-state', 'idle', T.hide)
    expect((await windowInfo(app, 'feed')).visible).toBe(true)
    expect(listNames(lud.workDir)).toEqual(['fed.jpg', 'fed.png'])
  })

  test('E2E-54 drop on the Feed Window Uncle (no option) → pick an option → done', { tag: NEEDS_P2 }, async ({ lud }) => {
    const app = await lud.launchReady()
    const feed = await openFeed(app)
    const input = await makePng(join(lud.workDir, 'held.png'))
    const before = (await jobEvents(app)).length
    await hookP2(app, 'dropFilesOnFeed', [input], null)
    await expectAttr(feed, 'feed-root', 'data-uncle-state', 'feedMe')
    await expect(feed.getByTestId('held-files')).toBeVisible()
    await expect(feed.getByTestId('option-to-png'), 'no-op option hidden').toHaveCount(0)
    await feed.getByTestId('option-to-webp').click()
    const event = await waitForTerminalEvent(app, before)
    expect(event.type, JSON.stringify(event)).toBe('done')
    expect(outputsOf(event)).toEqual([expectedOutputPath(input, 'webp')])
  })

  test('E2E-55 a blocked file dropped on the Feed Window is refused ("Nope"), no job', { tag: NEEDS_P2 }, async ({ lud }) => {
    const app = await lud.launchReady()
    const feed = await openFeed(app)
    const input = makeBlocked(join(lud.workDir, 'virus.scr'))
    const before = (await jobEvents(app)).length
    await hookP2(app, 'dropFilesOnFeed', [input], 'zip')
    await expectAttr(feed, 'feed-root', 'data-uncle-state', 'refuse')
    await expect(feed.getByTestId('speech-bubble')).toHaveText(/nope/i)
    await expectNoNewJob(app, before)
    expect(listNames(lud.workDir)).toEqual(['virus.scr'])
  })
})
