// E2E-OVERLAY: arming, sensor behaviour, focus, disarm/hide, text drags.
// Test plan IDs: E2E-10..E2E-14, OVL-01, OVL-03, OVL-09 (docs/qa/TEST_PLAN.md).
// All tests need the Platform (__ludTest, overlay window) and Frontend (overlay DOM contract).
import type { Page } from '@playwright/test'
import {
  NEEDS_INTEGRATION,
  T,
  expect,
  expectUncleState,
  hook,
  screenshot,
  test,
  uncleState,
  waitForPage,
  windowInfo
} from './support/app'

/** Dispatch synthetic DOM drag events carrying TEXT (no "Files" type) on the overlay page. */
async function dispatchTextDrag(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    interface Target {
      dispatchEvent(e: unknown): boolean
    }
    interface G {
      document: { querySelector(s: string): Target | null; body: Target }
      DataTransfer: new () => { setData(t: string, v: string): void; types: readonly string[] }
      DragEvent: new (type: string, init: Record<string, unknown>) => unknown
    }
    const g = globalThis as unknown as G
    const dt = new g.DataTransfer()
    dt.setData('text/plain', 'just some text, not a file')
    const target = g.document.querySelector('[data-testid="overlay-root"]') ?? g.document.body
    for (const type of ['dragenter', 'dragover', 'dragover']) {
      target.dispatchEvent(new g.DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 50, clientY: 50 }))
    }
    return [...dt.types]
  })
}

test.describe('overlay', () => {
  test('E2E-10 arm shows the overlay as a sensor (Uncle still hidden), on top, without focus', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    await hook(app, 'arm')
    await expect.poll(() => hook(app, 'overlayVisible'), { timeout: T.state }).toBe(true)

    const overlay = await waitForPage(app, 'overlay')
    // PLAN §3.5: arming only places the near-transparent sensor; the Uncle appears on a FILE dragenter.
    await expectUncleState(overlay, 'hidden')
    await screenshot(overlay, testInfo, 'armed-sensor-hidden')

    const info = await windowInfo(app, 'overlay')
    expect(info.found).toBe(true)
    expect(info.visible).toBe(true)
    expect(info.alwaysOnTop, 'overlay must be always-on-top').toBe(true)
    // OVL-01: never steals focus. Under Xvfb without a WM this is an approximation of the real check.
    expect(info.focused, 'overlay must be shown inactive (showInactive), never focused').toBe(false)

    await hook(app, 'disarm')
  })

  test('E2E-11 disarm without a drop hides the overlay (never stuck visible)', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    await hook(app, 'arm')
    await expect.poll(() => hook(app, 'overlayVisible'), { timeout: T.state }).toBe(true)
    const overlay = await waitForPage(app, 'overlay')
    await hook(app, 'disarm')
    await expect.poll(() => hook(app, 'overlayVisible'), { timeout: T.hide, message: 'overlay still visible after disarm' }).toBe(false)
    expect((await windowInfo(app, 'overlay')).visible).toBe(false)
    const s = await uncleState(overlay)
    expect(s === null || s === 'hidden' || s === 'leave', `unexpected state after disarm: ${String(s)}`).toBe(true)
    await screenshot(overlay, testInfo, 'after-disarm')
  })

  test('E2E-12 repeated arm/disarm is idempotent and ends hidden', { tag: NEEDS_INTEGRATION }, async ({ lud }) => {
    const app = await lud.launchReady()
    for (let i = 0; i < 3; i++) {
      await hook(app, 'arm')
      await hook(app, 'arm') // double arm (e.g. key repeat) must not create a second overlay
      await expect.poll(() => hook(app, 'overlayVisible'), { timeout: T.state }).toBe(true)
      await hook(app, 'disarm')
      await hook(app, 'disarm')
      await expect.poll(() => hook(app, 'overlayVisible'), { timeout: T.hide }).toBe(false)
    }
    const overlayWindows = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => /\/overlay\/index\.html/.test(w.webContents.getURL())).length
    )
    // Platform may reuse one overlay window or recreate it per arm; never more than one.
    expect(overlayWindows, 'at most one overlay window may exist').toBeLessThanOrEqual(1)
  })

  test('E2E-13 a TEXT drag over the armed sensor never shows the Uncle', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    // Uses synthetic DOM DragEvents (not part of the hook contract): it checks the renderer's
    // `dataTransfer.types.includes("Files")` gate from PLAN §3.5.
    const app = await lud.launchReady()
    await hook(app, 'arm')
    await expect.poll(() => hook(app, 'overlayVisible'), { timeout: T.state }).toBe(true)
    const overlay = await waitForPage(app, 'overlay')
    await expectUncleState(overlay, 'hidden')

    const types = await dispatchTextDrag(overlay)
    expect(types).not.toContain('Files')
    await new Promise((r) => setTimeout(r, 1_000))
    expect(await uncleState(overlay), 'text drag must not engage the Uncle').toBe('hidden')
    await screenshot(overlay, testInfo, 'text-drag-still-hidden')
    await hook(app, 'disarm')
    await expect.poll(() => hook(app, 'overlayVisible'), { timeout: T.hide }).toBe(false)
  })

  test('E2E-14 overlay stays inside the primary display work area', { tag: NEEDS_INTEGRATION }, async ({ lud }) => {
    const app = await lud.launchReady()
    await hook(app, 'arm')
    await expect.poll(() => hook(app, 'overlayVisible'), { timeout: T.state }).toBe(true)
    const { bounds, display } = await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find((w) => /\/overlay\/index\.html/.test(w.webContents.getURL()))
      return { bounds: win?.getBounds() ?? null, display: screen.getPrimaryDisplay().bounds }
    })
    expect(bounds).not.toBeNull()
    const b = bounds!
    expect(b.x).toBeGreaterThanOrEqual(display.x)
    expect(b.y).toBeGreaterThanOrEqual(display.y)
    expect(b.x + b.width).toBeLessThanOrEqual(display.x + display.width)
    expect(b.y + b.height).toBeLessThanOrEqual(display.y + display.height)
    await hook(app, 'disarm')
  })
})
