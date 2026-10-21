// Platform smoke test against the BUILT app (not part of `npm test`).
// Usage (Linux):  npm run build && xvfb-run -a node tests/unit/platform/smoke/electron-smoke.mjs
// Checks: boot, windows at boot, tray, overlay hidden → arm → visible, preload API surface,
// engine worker protocol (fake worker), htmlToPdf adapter, crash + restart, test drop channel,
// IPC validation, feed/settings windows.
import { _electron as electron } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')
const work = await mkdtemp(join(tmpdir(), 'lud-smoke-'))
const input = join(work, 'input.txt')
await writeFile(input, 'hello')
const crashInput = join(work, 'crash.txt')
await writeFile(crashInput, 'x')
const hangInput = join(work, 'hang.txt')
await writeFile(hangInput, 'x')

const stderr = []
const app = await electron.launch({
  // userData isolation through the Chromium switch (main never calls app.setPath, TPM D5).
  args: [repo, '--no-sandbox', '--disable-gpu', `--user-data-dir=${join(work, 'userData')}`],
  cwd: repo,
  env: {
    ...process.env,
    LUD_E2E: '1',
    LUD_E2E_ENGINE_WORKER: join(here, 'fake-engine-worker.cjs')
  }
})
app.process().stderr?.on('data', (d) => stderr.push(String(d)))

const step = (name) => process.stdout.write(`- ${name}\n`)
const waitFor = async (fn, what, ms = 15_000) => {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

try {
  await waitFor(() => app.evaluate(() => typeof globalThis.__ludTest === 'object'), '__ludTest')
  step('boot ok, __ludTest installed')

  // The overlay page may still be loading when __ludTest appears (hooks await it internally).
  await waitFor(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL() !== '')), 'overlay page load')
  const windows = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), visible: w.isVisible(), url: w.webContents.getURL(), bounds: w.getBounds() }))
  )
  console.log('  windows at boot:', JSON.stringify(windows))
  assert.equal(windows.length, 1, 'only the overlay window exists at boot')
  assert.match(windows[0].url, /\/renderer\/overlay\/index\.html$/)
  assert.equal(windows[0].visible, false)
  step('overlay exists and is hidden')

  // stderr is attached after launch() resolves, so very early lines can be missed; the tray is
  // created before the hooks are installed, so wait for that line and require no tray failure.
  await waitFor(async () => stderr.join('').includes('tray created') || stderr.join('').includes('e2e hooks installed'), 'startup log')
  assert.ok(!stderr.join('').includes('tray creation failed'), 'tray creation failed')
  step('tray created (no tray failure logged)')
  await waitFor(async () => stderr.join('').includes('engine ready'), 'engine ready')
  step('engine worker started and answered ready')

  const overlay = await waitFor(async () => app.windows().find((p) => p.url().includes('/overlay/')), 'overlay page')
  const apiKeys = await overlay.evaluate(() => Object.keys(window.lud).sort())
  console.log('  window.lud keys:', apiKeys.join(','))
  assert.ok(apiKeys.includes('pathsForFiles') && apiKeys.includes('onTestDrop') && apiKeys.includes('overlayEngaged'))
  assert.equal(await overlay.evaluate(() => typeof window.require), 'undefined', 'no node in renderer')

  await overlay.evaluate(() => {
    window.__arms = []
    window.__disarms = 0
    window.__drops = []
    window.__cursor = 0
    window.lud.onOverlayArm((i) => window.__arms.push(i))
    window.lud.onOverlayDisarm(() => window.__disarms++)
    window.lud.onTestDrop((p) => window.__drops.push(p))
    window.lud.onCursor(() => window.__cursor++)
  })

  assert.equal(await app.evaluate(() => globalThis.__ludTest.overlayVisible()), false)
  await app.evaluate(() => globalThis.__ludTest.arm())
  assert.equal(await app.evaluate(() => globalThis.__ludTest.overlayVisible()), true)
  const armInfo = await waitFor(() => overlay.evaluate(() => window.__arms[0]), 'overlayArm')
  const ob = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('/overlay/'))
    return { bounds: w.getBounds(), wa: screen.getPrimaryDisplay().workArea, top: w.isAlwaysOnTop() }
  })
  console.log('  arm info:', JSON.stringify(armInfo), 'overlay:', JSON.stringify(ob))
  assert.equal(ob.top, true)
  assert.equal(ob.bounds.width, 560)
  assert.equal(armInfo.settings.triggerKey, 'shift')
  await waitFor(() => overlay.evaluate(() => window.__cursor > 0), 'cursor messages')
  step('arm(): overlay shown always-on-top, overlayArm + cursor messages received')

  await app.evaluate((_e, p) => globalThis.__ludTest.dropFiles([p], 'to-png'), input)
  const drop = await waitFor(() => overlay.evaluate(() => window.__drops[0]), 'test drop')
  assert.deepEqual(drop, { paths: [input], optionId: 'to-png' })
  step('dropFiles(): TEST_DROP_CHANNEL delivered to the overlay renderer')

  // The renderer would now start the job; do it like the renderer does.
  await overlay.evaluate((p) => window.lud.startJob({ id: 'smoke-png', optionId: 'to-png', inputPaths: [p] }), input)
  await waitFor(() => app.evaluate(() => globalThis.__ludTest.jobEvents().some((e) => e.jobId === 'smoke-png' && e.type === 'done')), 'job done')
  const evs = await app.evaluate(() => globalThis.__ludTest.jobEvents().filter((e) => e.jobId === 'smoke-png').map((e) => e.type))
  assert.deepEqual(evs, ['queued', 'progress', 'done'])
  step('startJob → engine host → worker → events recorded')

  const denied = await overlay.evaluate((p) => window.lud.revealPath(p).then(() => 'ok', (e) => String(e)), input)
  assert.match(denied, /not made by Let us drag/)
  const badJob = await overlay.evaluate(() => window.lud.startJob({ id: '../x', optionId: 'to-png', inputPaths: ['relative'] }).then(() => 'ok', (e) => String(e)))
  assert.match(badJob, /Invalid job request/)
  const notAllowed = await overlay.evaluate(() => window.lud.setSettings({ triggerKey: 'alt' }).then(() => 'ok', (e) => String(e)))
  assert.match(notAllowed, /Request rejected/, 'the overlay may not change settings (SEC-12 allowlist)')
  const notAllowed2 = await overlay.evaluate(() => window.lud.requestAccessibility().then(() => 'ok', (e) => String(e)))
  assert.match(notAllowed2, /Request rejected/)
  step('IPC validation rejects bad input / unrevealable paths; per-page allowlist enforced')

  await overlay.evaluate((p) => window.lud.startJob({ id: 'smoke-pdf', optionId: 'to-pdf', inputPaths: [p] }), input)
  await waitFor(() => app.evaluate(() => globalThis.__ludTest.jobEvents().some((e) => e.jobId === 'smoke-pdf' && (e.type === 'done' || e.type === 'error'))), 'pdf job', 40_000)
  const pdfEv = await app.evaluate(() => globalThis.__ludTest.jobEvents().find((e) => e.jobId === 'smoke-pdf' && (e.type === 'done' || e.type === 'error')))
  assert.equal(pdfEv.type, 'done', JSON.stringify(pdfEv))
  const pdf = await readFile(pdfEv.outputPaths[0])
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-')
  step(`htmlToPdf adapter produced a ${pdf.length}-byte PDF`)

  await app.evaluate(() => globalThis.__ludTest.disarm())
  await waitFor(() => overlay.evaluate(() => window.__disarms === 1), 'overlayDisarm')
  assert.equal(await app.evaluate(() => globalThis.__ludTest.overlayVisible()), true, 'stays visible until overlayDone')
  await overlay.evaluate(() => window.lud.overlayDone())
  assert.equal(await app.evaluate(() => globalThis.__ludTest.overlayVisible()), false)
  step('disarm → overlayDisarm; overlayDone hides the overlay')

  await overlay.evaluate((p) => window.lud.startJob({ id: 'smoke-crash', optionId: 'zip', inputPaths: [p] }), crashInput)
  await waitFor(() => app.evaluate(() => globalThis.__ludTest.jobEvents().some((e) => e.jobId === 'smoke-crash' && e.type === 'error')), 'crash error')
  const crashEv = await app.evaluate(() => globalThis.__ludTest.jobEvents().find((e) => e.jobId === 'smoke-crash' && e.type === 'error'))
  assert.equal(crashEv.error.code, 'INTERNAL')
  await overlay.evaluate((p) => window.lud.startJob({ id: 'after-crash', optionId: 'to-png', inputPaths: [p] }), input)
  await waitFor(() => app.evaluate(() => globalThis.__ludTest.jobEvents().some((e) => e.jobId === 'after-crash' && e.type === 'done')), 'job after restart')
  step('worker crash → INTERNAL error; worker restarted and serves the next job')

  // P2 watchdog: a job stuck in synchronous code ignores the cancel → killed + CANCELLED after ~5 s.
  await overlay.evaluate((p) => window.lud.startJob({ id: 'smoke-hang', optionId: 'zip', inputPaths: [p] }), hangInput)
  await waitFor(() => app.evaluate(() => globalThis.__ludTest.jobEvents().some((e) => e.jobId === 'smoke-hang' && e.type === 'progress')), 'hang job started')
  await new Promise((r) => setTimeout(r, 300))
  const tCancel = Date.now()
  await overlay.evaluate(() => window.lud.cancelJob('smoke-hang'))
  await waitFor(() => app.evaluate(() => globalThis.__ludTest.jobEvents().some((e) => e.jobId === 'smoke-hang' && e.type === 'error')), 'watchdog', 15_000)
  const waited = Date.now() - tCancel
  const hangEv = await app.evaluate(() => globalThis.__ludTest.jobEvents().find((e) => e.jobId === 'smoke-hang' && e.type === 'error'))
  assert.equal(hangEv.error.code, 'CANCELLED')
  assert.ok(waited >= 4_500 && waited < 10_000, `watchdog fired after ${waited} ms`)
  await overlay.evaluate((p) => window.lud.startJob({ id: 'after-hang', optionId: 'to-png', inputPaths: [p] }), input)
  await waitFor(() => app.evaluate(() => globalThis.__ludTest.jobEvents().some((e) => e.jobId === 'after-hang' && e.type === 'done')), 'job after watchdog restart')
  step(`watchdog: stuck job killed after ${waited} ms → CANCELLED; new worker serves the next job`)

  await app.evaluate(() => globalThis.__ludTest.openFeedWindow())
  await app.evaluate(() => globalThis.__ludTest.openSettingsWindow())
  const urls = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).map((w) => w.webContents.getURL()))
  console.log('  visible windows:', JSON.stringify(urls))
  assert.ok(urls.some((u) => u.includes('/feed/')))
  assert.ok(urls.some((u) => u.includes('/settings/')))
  step('feed + settings windows open')

  const settingsPage = await waitFor(async () => app.windows().find((p) => p.url().includes('/settings/')), 'settings page')
  const badSettings = await settingsPage.evaluate(() => window.lud.setSettings({ triggerKey: 'capslock' }).then(() => 'ok', (e) => String(e)))
  assert.match(badSettings, /Invalid settings/)
  const extraKey = await settingsPage.evaluate(() => window.lud.setSettings({ sounds: false, evil: 1 }).then(() => 'ok', (e) => String(e)))
  assert.match(extraKey, /Invalid settings/, 'strict schema rejects unknown keys')
  step('settings window: strict settings validation')

  // SEC-01/02/19: every window (incl. hidden helper windows) has the hardened webPreferences.
  const prefs = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => {
      const p = w.webContents.getLastWebPreferences()
      return { url: w.webContents.getURL(), contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, webviewTag: p.webviewTag, webSecurity: p.webSecurity }
    })
  )
  for (const p of prefs) {
    assert.deepEqual({ ...p, url: undefined }, { url: undefined, contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, webSecurity: true }, p.url)
  }
  step(`webPreferences hardened on all ${prefs.length} windows`)

  // SEC-150: renderers cannot reach the network.
  const fetched = await settingsPage.evaluate(() => fetch('https://example.com/').then(() => 'ok', (e) => String(e)))
  assert.notEqual(fetched, 'ok')
  step('remote fetch from a renderer is blocked')

  // E2E hooks added in phase 2 (TPM D2/D3): delivered to the renderers.
  const feedPage = await waitFor(async () => app.windows().find((p) => p.url().includes('/feed/')), 'feed page')
  await feedPage.evaluate(() => {
    window.__feedDrops = []
    window.__cancels = 0
    window.lud.onTestFeedDrop((p) => window.__feedDrops.push(p))
    window.lud.onTestCancel(() => window.__cancels++)
  })
  await app.evaluate((_e, p) => globalThis.__ludTest.dropFilesOnFeed([p], 'zip'), input)
  const feedDrop = await waitFor(() => feedPage.evaluate(() => window.__feedDrops[0]), 'feed test drop')
  assert.deepEqual(feedDrop, { paths: [input], optionId: 'zip' })
  await app.evaluate(() => globalThis.__ludTest.cancelActive())
  await waitFor(() => feedPage.evaluate(() => window.__cancels === 1), 'test cancel')
  step('dropFilesOnFeed / cancelActive delivered to the feed renderer')

  const status = await overlay.evaluate(() => window.lud.getPlatformStatus())
  console.log('  platform status:', JSON.stringify(status))
  const appLog = stderr.join('').split('\n').filter((l) => l.startsWith('[lud]'))
  console.log('  app log:\n    ' + appLog.join('\n    '))
  // The remote <img> in the fake engine's HTML is stopped by the injected CSP inside the renderer,
  // so the session-level webRequest filter (second layer) normally never even sees it.
  assert.ok(!appLog.some((l) => l.includes('example.com') && !l.includes('blocked')), 'no remote request allowed')
  console.log('\nSMOKE OK')
} catch (err) {
  console.error('\nSMOKE FAILED:', err)
  console.error('--- app stderr ---\n' + stderr.join(''))
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
  await rm(work, { recursive: true, force: true })
}
