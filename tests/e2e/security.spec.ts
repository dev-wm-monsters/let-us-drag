// E2E-SECURITY: renderer isolation, navigation/window.open blocked, IPC input validation, CSP.
// Test plan IDs: E2E-60..E2E-66, SEC-01..SEC-11 (docs/qa/TEST_PLAN.md); CHECKLIST SEC-82 (htmlToPdf).
import type { ElectronApplication, Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LudApi } from '../../src/shared/api'
import { startBeacon } from '../helpers/beacon'
import { NEEDS_INTEGRATION, expect, hook, hooksInstalled, jobEvents, test, waitForPage, type WindowKind } from './support/app'
import { convertViaDrop, outputsOf } from './support/flows'
import { pdfPageTexts } from './support/pdf'

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

  // CHECKLIST SEC-82: the htmlToPdf path must not fetch anything, run scripts, follow refreshes or
  // read local files. The engine sanitises the HTML and the host window blocks requests (two layers);
  // this checks the combined, user-visible result against a local beacon server.
  for (const [id, ext] of [
    ['E2E-65', 'html'],
    ['E2E-66', 'md']
  ] as const) {
    test(`${id} ${ext.toUpperCase()} → PDF with remote/file resources, <script> and meta refresh: zero beacon hits, no script effect`, async ({ lud }, testInfo) => {
      const beacon = await startBeacon()
      try {
        // Positive control: the beacon really counts requests.
        await (await fetch(beacon.url('/control'))).text()
        expect(beacon.hits.map((h) => h.url)).toEqual(['/control'])
        const app = await lud.launchReady()
        const secret = join(lud.workDir, 'secret.txt')
        writeFileSync(secret, 'LUDSECRETFILE')
        const secretUrl = `file://${secret}`
        const b = (tag: string): string => beacon.url(`/${tag}`)
        const hostile = [
          `<meta http-equiv="refresh" content="0;url=${b('meta-refresh')}">`,
          `<base href="${b('base')}/">`,
          `<link rel="stylesheet" href="${b('link-css')}">`,
          `<link rel="prefetch" href="${b('prefetch')}">`,
          `<style>@import url("${b('import-css')}"); body { background: url("${b('bg-css')}") } @font-face { font-family: x; src: url("${b('font')}") }</style>`,
          `<script>document.title = 'SCRIPTRAN'; document.write('<p>SCRIPTRAN</p>'); fetch('${b('fetch')}'); new Image().src = '${b('script-img')}'</script>`,
          `<h1>Beacon document LUDSAFETEXT</h1>`,
          `<p>Visible paragraph.</p>`,
          `<img src="${b('img')}" alt="">`,
          `<img src="relative-to-base.png" alt="">`,
          `<img srcset="${b('srcset')} 1x" alt="">`,
          `<picture><source srcset="${b('picture')}"><img alt=""></picture>`,
          `<iframe src="file:///etc/hostname"></iframe>`,
          `<iframe src="${secretUrl}"></iframe>`,
          `<iframe src="${b('iframe')}"></iframe>`,
          `<iframe srcdoc="<img src='${b('srcdoc')}'>"></iframe>`,
          `<object data="${secretUrl}"></object>`,
          `<object data="${b('object')}"></object>`,
          `<embed src="${b('embed')}">`,
          `<video poster="${b('poster')}" src="${b('video')}"></video>`,
          `<audio src="${b('audio')}"></audio>`,
          `<svg width="10" height="10"><image href="${b('svg-image')}" width="10" height="10"/></svg>`,
          `<img src="x" onerror="fetch('${b('onerror')}')">`,
          `<form action="${b('form')}"><input type="image" src="${b('input-image')}"></form>`,
          `<p style="background-image: url('${b('inline-style')}')">Styled.</p>`
        ].join('\n')
        const input = join(lud.workDir, `hostile.${ext}`)
        writeFileSync(input, ext === 'html' ? `<!doctype html><html><head><title>t</title></head><body>${hostile}</body></html>` : `# Markdown LUDMDTEXT\n\n${hostile}\n`)

        const { event } = await convertViaDrop(app, testInfo, `beacon-${ext}`, [input], 'to-pdf')
        expect(event.type, JSON.stringify(event)).toBe('done')
        const [pdf] = outputsOf(event)
        await new Promise((r) => setTimeout(r, 1_500)) // late requests (refresh, lazy loads)
        expect(beacon.hits.slice(1), 'the PDF renderer must not touch the network').toEqual([])

        const text = (await pdfPageTexts(pdf!)).join(' ')
        expect(text).toContain('LUDSAFETEXT')
        if (ext === 'md') expect(text).toContain('LUDMDTEXT')
        expect(text, 'a <script> must not run').not.toContain('SCRIPTRAN')
        expect(text, 'local files must not be embedded').not.toContain('LUDSECRETFILE')
      } finally {
        await beacon.close()
      }
    })
  }
})
