// E2E-SECURITY: renderer isolation, navigation/window.open blocked, IPC input validation, CSP.
// Test plan IDs: E2E-60..E2E-64, SEC-01..SEC-09 (docs/qa/TEST_PLAN.md).
import type { ElectronApplication, Page } from '@playwright/test'
import type { LudApi } from '../../src/shared/api'
import { NEEDS_INTEGRATION, expect, hook, hooksInstalled, jobEvents, test, waitForPage, type WindowKind } from './support/app'

async function openAllWindows(app: ElectronApplication): Promise<Record<WindowKind, Page>> {
  await hook(app, 'openFeedWindow')
  await hook(app, 'openSettingsWindow')
  await hook(app, 'arm')
  const pages = {
    overlay: await waitForPage(app, 'overlay'),
    feed: await waitForPage(app, 'feed'),
    settings: await waitForPage(app, 'settings')
  }
  return pages
}

type Lud = { lud: LudApi }

test.describe('security', () => {
  test('E2E-60 every renderer is isolated: window.lud only, no Node globals', { tag: NEEDS_INTEGRATION }, async ({ lud }) => {
    const app = await lud.launchReady()
    const pages = await openAllWindows(app)
    for (const [kind, page] of Object.entries(pages)) {
      const probe = await page.evaluate(() => {
        const g = globalThis as unknown as Record<string, unknown>
        return {
          lud: typeof g['lud'],
          require: typeof g['require'],
          process: typeof g['process'],
          module: typeof g['module'],
          Buffer: typeof g['Buffer'],
          electron: typeof g['electron']
        }
      })
      expect(probe, kind).toEqual({ lud: 'object', require: 'undefined', process: 'undefined', module: 'undefined', Buffer: 'undefined', electron: 'undefined' })
    }
    await hook(app, 'disarm')
  })

  test('E2E-61 navigation away and window.open are blocked', { tag: NEEDS_INTEGRATION }, async ({ lud }) => {
    const app = await lud.launchReady()
    await hook(app, 'openFeedWindow')
    const feed = await waitForPage(app, 'feed')
    const originalUrl = feed.url()
    const windowsBefore = app.windows().length

    const opened = await feed.evaluate(() => {
      const w = (globalThis as unknown as { open(u: string): unknown }).open('https://example.com/')
      return w === null || w === undefined
    })
    expect(opened, 'window.open must be denied (setWindowOpenHandler → deny)').toBe(true)

    await feed.evaluate(() => {
      ;(globalThis as unknown as { location: { href: string } }).location.href = 'https://example.com/'
    })
    await new Promise((r) => setTimeout(r, 1_500))
    expect(feed.url(), 'will-navigate must be prevented').toBe(originalUrl)

    await feed.evaluate(() => {
      ;(globalThis as unknown as { location: { href: string } }).location.href = 'file:///etc/hosts'
    })
    await new Promise((r) => setTimeout(r, 1_500))
    expect(feed.url()).toBe(originalUrl)
    expect(app.windows().length, 'no new window may appear').toBe(windowsBefore)
  })

  test('E2E-62 IPC rejects malformed payloads and never starts a job', { tag: NEEDS_INTEGRATION }, async ({ lud }) => {
    const app = await lud.launchReady()
    await hook(app, 'openFeedWindow')
    const feed = await waitForPage(app, 'feed')
    const before = (await jobEvents(app)).length

    const results = await feed.evaluate(async () => {
      const api = (globalThis as unknown as Lud).lud as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
      const attempt = async (name: string, ...args: unknown[]): Promise<string> => {
        try {
          await api[name]!(...args)
          return 'resolved'
        } catch {
          return 'rejected'
        }
      }
      return {
        badOption: await attempt('startJob', { id: 'x1', optionId: 'rm -rf', inputPaths: ['/etc/passwd'] }),
        badPaths: await attempt('startJob', { id: 'x2', optionId: 'to-png', inputPaths: [42] }),
        noPaths: await attempt('startJob', { id: 'x3', optionId: 'to-png', inputPaths: [] }),
        notObject: await attempt('startJob', 'to-png'),
        describeNotArray: await attempt('describePaths', '/etc'),
        badSettings: await attempt('setSettings', { triggerKey: 'banana', sounds: 'loud' })
      }
    })
    // ASSUMPTION: zod-validated handlers throw → invoke() rejects. A silent ignore would also be safe,
    // so for startJob we additionally assert that no job event was produced for these ids.
    expect(results.badOption).toBe('rejected')
    expect(results.badPaths).toBe('rejected')
    expect(results.notObject).toBe('rejected')
    expect(results.describeNotArray).toBe('rejected')
    await new Promise((r) => setTimeout(r, 1_000))
    const ids = (await jobEvents(app)).slice(before).map((e) => e.jobId)
    for (const id of ['x1', 'x2', 'x3']) expect(ids).not.toContain(id)

    const s = await feed.evaluate(() => (globalThis as unknown as Lud).lud.getSettings())
    expect(['shift', 'alt', 'ctrl', 'meta']).toContain(s.triggerKey)
    expect(typeof s.sounds).toBe('boolean')
    expect(await hooksInstalled(app), 'main process must survive bad IPC').toBe(true)
  })

  test('E2E-63 every page ships a strict Content-Security-Policy', { tag: NEEDS_INTEGRATION }, async ({ lud }) => {
    const app = await lud.launchReady()
    const pages = await openAllWindows(app)
    for (const [kind, page] of Object.entries(pages)) {
      const csp = await page.evaluate(() => {
        const doc = (globalThis as unknown as { document: { querySelector(s: string): { getAttribute(n: string): string | null } | null } }).document
        return doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? ''
      })
      expect(csp, kind).toContain("script-src 'self'")
      expect(csp, kind).not.toContain('unsafe-eval')
    }
    await hook(app, 'disarm')
  })

  test('E2E-64 renderers make no remote network requests (all windows open, idle)', { tag: NEEDS_INTEGRATION }, async ({ lud }) => {
    const app = await lud.launchReady()
    const remote: string[] = []
    const watch = (p: Page): void => {
      p.on('request', (r) => {
        const u = r.url()
        if (/^https?:|^wss?:/i.test(u)) remote.push(u)
      })
    }
    app.windows().forEach(watch)
    app.on('window', watch)
    const pages = await openAllWindows(app)
    Object.values(pages).forEach(watch)
    await hook(app, 'disarm')
    await new Promise((r) => setTimeout(r, 2_000))
    // Main/engine traffic is not observable here; see SEC-07 in the test plan.
    expect(remote, 'renderers must not contact the network').toEqual([])
  })
})
