// E2E-MORE (D31): the paged options ring ("More…" / "Back") in both interaction modes, and the ZIP
// guess bubble for drags whose file types Chromium can't tell.
// Real catalog (D30): a PNG offers 9 options (PNG itself hidden, ZIP last), so the ring shows
// JPG, WEBP, PDF, Remove BG, Compress, Half size, AVIF + More (+2) and, on page 2, ICO, ZIP + Back.
import { dirname, join } from 'node:path'
import type { Page } from '@playwright/test'
import { T, expect, expectUncleState, hook, jobEvents, test, waitForPage, waitForTerminalEvent } from './support/app'
import { magic, makePng } from './support/fixtures'
import { armOverlay, outputsOf } from './support/flows'
import { expectedOutputPath } from './support/naming'
import { expectAttr, hookP2, startStageRecorder } from './support/p2'

/** Dispatch a synthetic FILE drag event on the overlay page at client (x, y). */
async function fileDrag(page: Page, type: 'dragenter' | 'dragover', x: number, y: number, mime = 'image/png', name = 'photo.png'): Promise<void> {
  await page.evaluate(
    ([type, x, y, mime, name]) => {
      interface Target {
        dispatchEvent(e: unknown): boolean
      }
      interface G {
        document: { querySelector(s: string): Target | null; body: Target }
        DataTransfer: new () => { items: { add(f: unknown): unknown } }
        File: new (bits: string[], name: string, opts: { type: string }) => unknown
        DragEvent: new (type: string, init: Record<string, unknown>) => unknown
      }
      const g = globalThis as unknown as G
      const dt = new g.DataTransfer()
      dt.items.add(new g.File(['x'], name as string, { type: mime as string }))
      const target = g.document.querySelector('[data-testid="overlay-root"]') ?? g.document.body
      target.dispatchEvent(new g.DragEvent(type as string, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }))
    },
    [type, x, y, mime, name] as const
  )
}

async function centerOf(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(testId).boundingBox()
  expect(box, `${testId} has a box`).not.toBeNull()
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
}

async function ringPage(page: Page, testId = 'options-ring'): Promise<string | null> {
  return page.getByTestId(testId).getAttribute('data-page')
}

test.describe('More bubble (D31)', () => {
  test('E2E-90 drag mode: resting on More turns the page; a drop on a page-2 option converts', async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = await makePng(join(lud.workDir, 'paged.png'))
    const armed = await armOverlay(app, testInfo, 'more-drag')
    try {
      const overlay = armed.overlay
      await fileDrag(overlay, 'dragenter', 20, 20)
      await expectUncleState(overlay, 'appear')
      await expect(overlay.getByTestId('ring-more')).toBeVisible()
      await expect(overlay.getByTestId('ring-more')).toHaveAttribute('data-nav', 'more')
      await expect(overlay.getByTestId('option-to-jpg')).toBeVisible()
      await expect(overlay.getByTestId('option-to-ico'), 'page-2 option hidden on page 1').toHaveCount(0)
      expect(await ringPage(overlay)).toBe('0')
      // Let the fan-out animation settle, then rest on More (dragover events, no clicks during a drag).
      await overlay.waitForTimeout(500)
      const more = await centerOf(overlay, 'ring-more')
      await fileDrag(overlay, 'dragover', more.x + 3, more.y - 2)
      await expectUncleState(overlay, 'hover')
      await expect.poll(() => ringPage(overlay), { timeout: T.state }).toBe('1')
      await expect(overlay.getByTestId('ring-more')).toHaveAttribute('data-nav', 'back')
      await expect(overlay.getByTestId('option-to-jpg')).toHaveCount(0)
      // Staying on Back does not flip back (latched until the pointer leaves it).
      await fileDrag(overlay, 'dragover', more.x, more.y)
      await overlay.waitForTimeout(700)
      expect(await ringPage(overlay)).toBe('1')
      // Hit-testing on page 2: dragging over the ICO bubble hovers it.
      await overlay.waitForTimeout(300)
      const ico = await centerOf(overlay, 'option-to-ico')
      await fileDrag(overlay, 'dragover', ico.x, ico.y)
      await expect(overlay.getByTestId('option-to-ico')).toHaveClass(/is-hover/)
      await expect(overlay.getByTestId('hover-hint')).toHaveText('Make an icon (.ico)')
      // Drop on it (the hook targets the option id, same path as a real drop once paths are known).
      await hook(app, 'dropFiles', [input], 'to-ico')
      const event = await waitForTerminalEvent(app, armed.eventsBefore)
      expect(event.type, JSON.stringify(event)).toBe('done')
      expect(outputsOf(event)).toEqual([expectedOutputPath(input, 'ico')])
      await expectUncleState(overlay, 'spit')
    } finally {
      await armed.stopScreens()
    }
  })

  test('E2E-91 dropFiles(paths, optionId) converts an option that is on the page not shown', async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = await makePng(join(lud.workDir, 'offpage.png'))
    const armed = await armOverlay(app, testInfo, 'more-offpage')
    try {
      await fileDrag(armed.overlay, 'dragenter', 20, 20)
      await expectUncleState(armed.overlay, 'appear')
      await expect(armed.overlay.getByTestId('option-to-ico')).toHaveCount(0)
      await hook(app, 'dropFiles', [input], 'to-ico')
      const event = await waitForTerminalEvent(app, armed.eventsBefore)
      expect(event.type, JSON.stringify(event)).toBe('done')
      expect(outputsOf(event)).toEqual([expectedOutputPath(input, 'ico')])
    } finally {
      await armed.stopScreens()
    }
  })

  test('E2E-92 feedMe: click More, Enter on Back (keyboard), then click a page-2 option', async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = await makePng(join(lud.workDir, 'held.png'))
    const armed = await armOverlay(app, testInfo, 'more-feedme')
    try {
      const overlay = armed.overlay
      await hook(app, 'dropFiles', [input], null)
      await expectUncleState(overlay, 'feedMe')
      await expect(overlay.getByTestId('held-files')).toBeVisible()
      await expect(overlay.getByTestId('option-to-jpg')).toBeVisible()
      await expect(overlay.getByTestId('option-zip')).toHaveCount(0)
      await overlay.getByTestId('ring-more').click()
      await expect(overlay.getByTestId('option-zip')).toBeVisible()
      await expect(overlay.getByTestId('option-to-jpg')).toHaveCount(0)
      expect(await ringPage(overlay)).toBe('1')
      // Keyboard: Back keeps the focus; Enter turns the page back, Enter again forward.
      await overlay.getByTestId('ring-more').focus()
      await overlay.keyboard.press('Enter')
      await expect.poll(() => ringPage(overlay)).toBe('0')
      await expect(overlay.getByTestId('option-to-jpg')).toBeVisible()
      await overlay.keyboard.press('Enter')
      await expect.poll(() => ringPage(overlay)).toBe('1')
      // More never sits on the held-files chip.
      const nav = await overlay.getByTestId('ring-more').boundingBox()
      const chip = await overlay.getByTestId('held-files').boundingBox()
      expect(nav!.y + nav!.height).toBeLessThan(chip!.y)
      await overlay.getByTestId('option-zip').click()
      const event = await waitForTerminalEvent(app, armed.eventsBefore)
      expect(event.type, JSON.stringify(event)).toBe('done')
      const out = outputsOf(event)
      expect(out).toHaveLength(1)
      expect(dirname(out[0]!)).toBe(lud.workDir)
      expect(magic.zip(out[0]!)).toBe(true)
    } finally {
      await armed.stopScreens()
    }
  })

  test('E2E-93 feedMe on page 2: Esc still closes him without converting', async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    const input = await makePng(join(lud.workDir, 'esc.png'))
    const armed = await armOverlay(app, testInfo, 'more-esc')
    try {
      await hook(app, 'dropFiles', [input], null)
      await expectUncleState(armed.overlay, 'feedMe')
      await armed.overlay.getByTestId('ring-more').click()
      await expect.poll(() => ringPage(armed.overlay)).toBe('1')
      await armed.overlay.keyboard.press('Escape')
      await expectUncleState(armed.overlay, ['leave', 'hidden'])
      expect((await jobEvents(app)).length).toBe(armed.eventsBefore)
    } finally {
      await armed.stopScreens()
    }
  })

  test('E2E-94 Feed Window: More / Back by click, then convert a page-2 option', async ({ lud }) => {
    const app = await lud.launchReady()
    await hook(app, 'openFeedWindow')
    const feed = await waitForPage(app, 'feed')
    await expect(feed.getByTestId('feed-dropzone')).toBeVisible({ timeout: T.window })
    await startStageRecorder(feed, 'feed-root')
    const input = await makePng(join(lud.workDir, 'fed.png'))
    const before = (await jobEvents(app)).length
    await hookP2(app, 'dropFilesOnFeed', [input], null)
    await expectAttr(feed, 'feed-root', 'data-uncle-state', 'feedMe')
    await feed.getByTestId('ring-more').click()
    await expect.poll(() => ringPage(feed)).toBe('1')
    await feed.getByTestId('ring-more').click()
    await expect.poll(() => ringPage(feed)).toBe('0')
    await feed.getByTestId('ring-more').click()
    await feed.getByTestId('option-zip').click()
    const event = await waitForTerminalEvent(app, before)
    expect(event.type, JSON.stringify(event)).toBe('done')
    expect(magic.zip(outputsOf(event)[0]!)).toBe(true)
  })

  test('E2E-95 a drag of an unknown file type shows a ZIP bubble (not an empty "Feed me!")', async ({ lud }) => {
    const app = await lud.launchReady()
    await hook(app, 'arm')
    await expect.poll(() => hook(app, 'overlayVisible'), { timeout: T.state }).toBe(true)
    const overlay = await waitForPage(app, 'overlay')
    await fileDrag(overlay, 'dragenter', 20, 20, '', 'logo.svg')
    await expectUncleState(overlay, 'appear')
    await expect(overlay.getByTestId('option-zip')).toBeVisible()
    await expect(overlay.locator('[data-testid^="option-"]')).toHaveCount(1)
    await expect(overlay.getByTestId('ring-more')).toHaveCount(0)
    await expect(overlay.getByTestId('speech-bubble')).toHaveText(/ZIP it/)
    await hook(app, 'disarm')
    await expect.poll(() => hook(app, 'overlayVisible'), { timeout: T.hide }).toBe(false)
  })
})
