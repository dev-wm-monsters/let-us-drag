// E2E-BOOT: the app starts, stays up, installs the test hooks only under LUD_E2E=1 and quits cleanly.
// Test plan IDs: E2E-01..E2E-04, SEC-10 (docs/qa/TEST_PLAN.md).
import { NEEDS_INTEGRATION, T, expect, hooksInstalled, test, waitForHooks } from './support/app'

test.describe('boot', () => {
  test('E2E-01 main process boots, becomes ready and stays alive', async ({ lud }) => {
    const app = await lud.launch()
    const exited: number[] = []
    app.process().on('exit', (code) => exited.push(code ?? -1))
    await expect.poll(() => app.evaluate(({ app: electronApp }) => electronApp.isReady()), { timeout: T.hooks }).toBe(true)
    // A background app must not quit by itself after boot (e.g. because no window is open).
    await new Promise((r) => setTimeout(r, 2_000))
    expect(exited, 'app process exited on its own after boot').toEqual([])
    expect(await app.evaluate(({ app: electronApp }) => electronApp.getName())).toBeTruthy()
  })

  test('E2E-02 test hooks are installed when LUD_E2E=1', { tag: NEEDS_INTEGRATION }, async ({ lud }) => {
    const app = await lud.launch({ e2e: true })
    await waitForHooks(app)
    const shape = await app.evaluate(() => {
      const h = (globalThis as unknown as { __ludTest: Record<string, unknown> }).__ludTest
      return ['arm', 'dropFiles', 'disarm', 'overlayVisible', 'jobEvents', 'openFeedWindow', 'openSettingsWindow'].filter(
        (k) => typeof h[k] !== 'function'
      )
    })
    expect(shape, 'missing __ludTest functions').toEqual([])
  })

  test('E2E-03 / SEC-10 test hooks are NOT installed without LUD_E2E', async ({ lud }) => {
    const app = await lud.launch({ e2e: false })
    await expect.poll(() => app.evaluate(({ app: electronApp }) => electronApp.isReady()), { timeout: T.hooks }).toBe(true)
    // Give main time to finish its startup work before asserting absence.
    await new Promise((r) => setTimeout(r, 2_000))
    expect(await hooksInstalled(app)).toBe(false)
  })

  test('E2E-04 single-instance: a second launch on the same profile exits', { tag: NEEDS_INTEGRATION }, async ({ lud }) => {
    const first = await lud.launchReady()
    expect(await hooksInstalled(first)).toBe(true)
    // Same userData dir → same single-instance lock. The second process must quit on its own.
    // Playwright may either fail the launch (process gone before it connected) or connect and then
    // see the process exit; both mean the lock worked.
    const secondExited = await lud.launch({ e2e: true }).then(
      (second) =>
        new Promise<boolean>((resolve) => {
          const proc = second.process()
          if (proc.exitCode !== null || proc.signalCode !== null) return resolve(true)
          const timer = setTimeout(() => resolve(false), 15_000)
          proc.once('exit', () => {
            clearTimeout(timer)
            resolve(true)
          })
        }),
      () => true
    )
    expect(secondExited, 'second instance should exit (requestSingleInstanceLock)').toBe(true)
    expect(await hooksInstalled(first), 'first instance must survive').toBe(true)
  })
})
