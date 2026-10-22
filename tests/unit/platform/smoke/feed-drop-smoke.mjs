// B-055 / QA3-10 regression against the BUILT app (not part of `npm test`, like electron-smoke.mjs):
// __ludTest.dropFilesOnFeed must open the Feed Window itself when it is not open yet, resolve, and
// the drop must reach the feed renderer (a real conversion runs).
// Usage (Linux):  npm run build && xvfb-run -a node tests/unit/platform/smoke/feed-drop-smoke.mjs
import { _electron as electron } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')
const work = await mkdtemp(join(tmpdir(), 'lud-feed-smoke-'))
const png = join(work, 'dot.png')
await writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))

const app = await electron.launch({
  args: [repo, '--no-sandbox', '--disable-gpu', `--user-data-dir=${join(work, 'userData')}`],
  cwd: repo,
  env: { ...process.env, LUD_E2E: '1' }
})
const stderr = []
app.process().stderr?.on('data', (d) => stderr.push(String(d)))

const waitFor = async (fn, what, ms = 20_000) => {
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
  const feedOpen = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('/feed/')))
  assert.equal(await feedOpen(), false, 'the Feed Window is not open yet')
  const t0 = Date.now()
  const result = await Promise.race([
    app.evaluate((_e, p) => globalThis.__ludTest.dropFilesOnFeed([p], 'to-webp').then(() => 'resolved'), png),
    new Promise((r) => setTimeout(() => r('TIMEOUT'), 20_000))
  ])
  assert.equal(result, 'resolved', 'dropFilesOnFeed must resolve when it opens the Feed Window itself')
  console.log(`- dropFilesOnFeed resolved in ${Date.now() - t0} ms`)
  assert.equal(await feedOpen(), true)
  const terminal = await waitFor(
    () => app.evaluate(() => globalThis.__ludTest.jobEvents().find((e) => e.type === 'done' || e.type === 'error')),
    'job result'
  )
  assert.equal(terminal.type, 'done', JSON.stringify(terminal))
  console.log('- the drop reached the feed renderer and the conversion finished')
  console.log('\nFEED DROP SMOKE OK')
} catch (err) {
  console.error('\nFEED DROP SMOKE FAILED:', err)
  console.error('--- app stderr ---\n' + stderr.join(''))
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
  await rm(work, { recursive: true, force: true })
}
