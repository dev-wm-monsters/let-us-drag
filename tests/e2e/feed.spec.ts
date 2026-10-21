// E2E-FEED: the Feed Window fallback (Wayland / no macOS permission / preference).
// Test plan IDs: E2E-50..E2E-52, FEED-01..FEED-03 (docs/qa/TEST_PLAN.md).
import { NEEDS_INTEGRATION, T, expect, hook, screenshot, test, waitForPage, windowInfo } from './support/app'

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
})
