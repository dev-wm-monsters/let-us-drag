// Electron launch + E2E test-hook helpers. Drives the app ONLY through the contract in
// src/shared/test-hooks.ts (globalThis.__ludTest in main, DOM test ids in renderers) and the
// preload API in src/shared/api.ts (window.lud).
import { _electron, expect, test as base, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { LudApi } from '../../../src/shared/api'
import type { LudTestHooks } from '../../../src/shared/test-hooks'
import type { JobEvent, Settings } from '../../../src/shared/types'
import { makeTempDir, removeDir } from './fixtures'
import { safeFileStem } from './naming'
import { BUILT_MAIN, REPO_ROOT, SCREENS_DIR } from './paths'

/** Uncle states from the DOM contract (src/shared/test-hooks.ts). */
export type UncleState = 'hidden' | 'appear' | 'hover' | 'feedMe' | 'eat' | 'chew' | 'spit' | 'choke' | 'refuse' | 'leave'

export type WindowKind = 'overlay' | 'feed' | 'settings'

/** Tag for tests that need the Platform/Frontend/Engine implementation (expected to fail on the scaffold). */
export const NEEDS_INTEGRATION = '@needs-integration'

/** Generous timeouts: CI runners under Xvfb are slow, and chew has a 700 ms minimum. */
export const T = {
  hooks: 20_000,
  window: 15_000,
  state: 15_000,
  job: 60_000,
  hide: 10_000
} as const

export interface LaunchOptions {
  /** Install the test hooks (env LUD_E2E=1). Default true. */
  e2e?: boolean
  /** Extra env vars for the app process. */
  env?: Record<string, string>
}

function appEnv(e2e: boolean, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v
  // Always run the built files, never a dev server; never run Electron as plain Node.
  delete env['ELECTRON_RENDERER_URL']
  delete env['ELECTRON_RUN_AS_NODE']
  delete env['LUD_E2E']
  if (e2e) env['LUD_E2E'] = '1'
  return { ...env, ...extra }
}

/**
 * Launch the built app with an isolated userData dir.
 * ASSUMPTION (to confirm with Platform): main does not override app.setPath('userData'), so the
 * Chromium switch --user-data-dir=<dir> decides where settings live. Verified on Electron 45 that
 * app.getPath('userData') honours the switch.
 */
export async function launchApp(userDataDir: string, opts: LaunchOptions = {}): Promise<ElectronApplication> {
  if (!existsSync(BUILT_MAIN)) {
    throw new Error(`Built app not found at ${BUILT_MAIN}. Run "npm run build" before "npm run test:e2e".`)
  }
  return _electron.launch({
    args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    env: appEnv(opts.e2e ?? true, opts.env ?? {}),
    timeout: 60_000
  })
}

/** Whether globalThis.__ludTest exists in the main process right now. */
export async function hooksInstalled(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(() => typeof (globalThis as unknown as { __ludTest?: unknown }).__ludTest === 'object')
}

export async function waitForHooks(app: ElectronApplication): Promise<void> {
  await expect
    .poll(() => hooksInstalled(app), {
      timeout: T.hooks,
      message: 'globalThis.__ludTest was not installed in main (LUD_E2E=1). Platform implementation missing?'
    })
    .toBe(true)
}

type HookName = keyof LudTestHooks
type HookArgs<K extends HookName> = Parameters<LudTestHooks[K]>
type HookResult<K extends HookName> = Awaited<ReturnType<LudTestHooks[K]>>

/** Call one test hook in the main process. Arguments must be JSON-serialisable. */
export async function hook<K extends HookName>(app: ElectronApplication, name: K, ...args: HookArgs<K>): Promise<HookResult<K>> {
  const result = await app.evaluate(
    async (_e, payload: { name: string; args: unknown[] }) => {
      const hooks = (globalThis as unknown as { __ludTest?: Record<string, (...a: unknown[]) => unknown> }).__ludTest
      if (!hooks) throw new Error('globalThis.__ludTest is not installed (start the app with LUD_E2E=1)')
      const fn = hooks[payload.name]
      if (typeof fn !== 'function') throw new Error(`__ludTest.${payload.name} is not a function`)
      return await fn.apply(hooks, payload.args)
    },
    { name: name as string, args: args as unknown[] }
  )
  return result as HookResult<K>
}

export async function jobEvents(app: ElectronApplication): Promise<JobEvent[]> {
  return hook(app, 'jobEvents')
}

/** Events for the jobs started after `before` events had been recorded. */
export async function newJobEvents(app: ElectronApplication, before: number): Promise<JobEvent[]> {
  return (await jobEvents(app)).slice(before)
}

export async function waitForTerminalEvent(app: ElectronApplication, before: number): Promise<JobEvent> {
  let terminal: JobEvent | undefined
  await expect
    .poll(
      async () => {
        terminal = (await newJobEvents(app, before)).find((e) => e.type === 'done' || e.type === 'error')
        return terminal?.type ?? 'pending'
      },
      { timeout: T.job, message: 'no done/error JobEvent arrived' }
    )
    .not.toBe('pending')
  return terminal!
}

const URL_PATTERN: Record<WindowKind, RegExp> = {
  overlay: /\/overlay\/index\.html(?:[?#].*)?$/,
  feed: /\/feed\/index\.html(?:[?#].*)?$/,
  settings: /\/settings\/index\.html(?:[?#].*)?$/
}

export function findPage(app: ElectronApplication, kind: WindowKind): Page | undefined {
  return app.windows().find((p) => URL_PATTERN[kind].test(p.url()))
}

/** Wait until a renderer page of the given kind exists (the window may still be hidden). */
export async function waitForPage(app: ElectronApplication, kind: WindowKind, timeout: number = T.window): Promise<Page> {
  await expect
    .poll(() => findPage(app, kind) !== undefined, { timeout, message: `no ${kind} window (URL ${URL_PATTERN[kind]})` })
    .toBe(true)
  const page = findPage(app, kind)!
  await page.waitForLoadState('domcontentloaded')
  return page
}

/** Main-process view of a window, located by its renderer URL. */
export interface WindowInfo {
  found: boolean
  visible: boolean
  focused: boolean
  alwaysOnTop: boolean
  bounds: { x: number; y: number; width: number; height: number } | null
}

export async function windowInfo(app: ElectronApplication, kind: WindowKind): Promise<WindowInfo> {
  return app.evaluate(
    ({ BrowserWindow }, pattern: string) => {
      const re = new RegExp(pattern)
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && re.test(w.webContents.getURL()))
      if (!win) return { found: false, visible: false, focused: false, alwaysOnTop: false, bounds: null }
      return { found: true, visible: win.isVisible(), focused: win.isFocused(), alwaysOnTop: win.isAlwaysOnTop(), bounds: win.getBounds() }
    },
    URL_PATTERN[kind].source
  )
}

// ---------------------------------------------------------------------------------------------
// Overlay DOM contract
// ---------------------------------------------------------------------------------------------

export function overlayRoot(page: Page) {
  return page.getByTestId('overlay-root')
}

export async function uncleState(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const doc = (globalThis as unknown as { document: { querySelector(s: string): { getAttribute(n: string): string | null } | null } })
      .document
    return doc.querySelector('[data-testid="overlay-root"]')?.getAttribute('data-uncle-state') ?? null
  })
}

export async function expectUncleState(page: Page, state: UncleState | readonly UncleState[], timeout: number = T.state): Promise<void> {
  const wanted: readonly string[] = typeof state === 'string' ? [state] : state
  await expect
    .poll(async () => {
      const s = await uncleState(page)
      return s !== null && wanted.includes(s) ? 'ok' : `data-uncle-state=${String(s)}`
    }, { timeout, message: `waiting for data-uncle-state ∈ {${wanted.join(', ')}}` })
    .toBe('ok')
}

/** One observed overlay state with its page-clock timestamp (ms, performance.now()). */
export interface StateSample {
  state: string
  t: number
}

/**
 * Record every data-uncle-state value the overlay renders, using a MutationObserver inside the
 * page (catches short states like "eat" that polling could miss). Read back with recordedTimeline().
 */
export async function startStateRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    interface El {
      getAttribute(n: string): string | null
    }
    interface G {
      document: { querySelector(s: string): El | null; documentElement: unknown }
      performance: { now(): number }
      MutationObserver: new (cb: () => void) => { observe(target: unknown, opts: Record<string, unknown>): void; disconnect(): void }
      __ludStates?: { state: string; t: number }[]
      __ludStatesObserver?: { disconnect(): void }
    }
    const g = globalThis as unknown as G
    g.__ludStatesObserver?.disconnect()
    const samples: { state: string; t: number }[] = []
    g.__ludStates = samples
    const read = (): void => {
      const state = g.document.querySelector('[data-testid="overlay-root"]')?.getAttribute('data-uncle-state') ?? '(absent)'
      if (samples[samples.length - 1]?.state !== state) samples.push({ state, t: g.performance.now() })
    }
    read()
    const obs = new g.MutationObserver(read)
    obs.observe(g.document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-uncle-state'] })
    g.__ludStatesObserver = obs
  })
}

export async function recordedTimeline(page: Page): Promise<StateSample[]> {
  return page.evaluate(() => [...((globalThis as unknown as { __ludStates?: { state: string; t: number }[] }).__ludStates ?? [])])
}

export async function recordedStates(page: Page): Promise<string[]> {
  return (await recordedTimeline(page)).map((s) => s.state)
}

// ---------------------------------------------------------------------------------------------
// Screenshots (best effort: a failed screenshot never fails a test, it is logged as an annotation)
// ---------------------------------------------------------------------------------------------

export async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  mkdirSync(SCREENS_DIR, { recursive: true })
  const file = join(SCREENS_DIR, `${safeFileStem(testInfo.title)}--${safeFileStem(name)}.png`)
  try {
    await page.screenshot({ path: file, timeout: 5_000, animations: 'allow' })
  } catch (err) {
    testInfo.annotations.push({ type: 'screenshot-failed', description: `${name}: ${(err as Error).message.split('\n')[0]}` })
  }
}

/**
 * Poll the overlay state and screenshot each new state as soon as it is seen.
 * Call stop() to end; it returns the states seen by polling (the MutationObserver record is more complete).
 */
export function watchAndScreenshotStates(page: Page, testInfo: TestInfo, label: string): { stop(): Promise<string[]> } {
  let running = true
  const seen: string[] = []
  const loop = (async () => {
    while (running) {
      let s: string | null = null
      try {
        s = await uncleState(page)
      } catch {
        // page navigating/closing: keep polling until stopped
      }
      if (s !== null && seen[seen.length - 1] !== s) {
        seen.push(s)
        await screenshot(page, testInfo, `${label}-${String(seen.length).padStart(2, '0')}-${s}`)
      }
      await new Promise((r) => setTimeout(r, 25))
    }
  })()
  return {
    async stop() {
      running = false
      await loop
      return seen
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Preload API (window.lud) from a renderer page
// ---------------------------------------------------------------------------------------------

export async function getSettingsFrom(page: Page): Promise<Settings> {
  return page.evaluate(() => (globalThis as unknown as { lud: LudApi }).lud.getSettings())
}

// ---------------------------------------------------------------------------------------------
// Playwright fixture: one isolated session per test (temp userData + temp work dir + app logs)
// ---------------------------------------------------------------------------------------------

export interface LudSession {
  /** Isolated userData dir (kept across relaunches inside one test). */
  userDataDir: string
  /** Temp folder for fixtures and outputs. */
  workDir: string
  /** Launch the app (tracked: closed and its logs attached at teardown). */
  launch(opts?: LaunchOptions): Promise<ElectronApplication>
  /** Launch with hooks and wait until __ludTest is installed. */
  launchReady(opts?: LaunchOptions): Promise<ElectronApplication>
  /** Close one app gracefully and wait for the process to exit. */
  close(app: ElectronApplication): Promise<void>
}

export const test = base.extend<{ lud: LudSession }>({
  lud: async ({}, use, testInfo) => {
    const userDataDir = makeTempDir('userdata')
    const workDir = makeTempDir('work')
    const apps: { app: ElectronApplication; log: string[] }[] = []

    const launch = async (opts?: LaunchOptions): Promise<ElectronApplication> => {
      const app = await launchApp(userDataDir, opts)
      const log: string[] = []
      const proc = app.process()
      proc.stdout?.on('data', (d: Buffer) => log.push(`[stdout] ${d.toString()}`))
      proc.stderr?.on('data', (d: Buffer) => log.push(`[stderr] ${d.toString()}`))
      app.on('console', (m) => log.push(`[main console.${m.type()}] ${m.text()}`))
      apps.push({ app, log })
      return app
    }
    const close = async (app: ElectronApplication): Promise<void> => {
      await app.close().catch(() => undefined)
    }
    const session: LudSession = {
      userDataDir,
      workDir,
      launch,
      async launchReady(opts) {
        const app = await launch({ ...opts, e2e: true })
        await waitForHooks(app)
        return app
      },
      close
    }

    await use(session)

    for (const [i, { app, log }] of apps.entries()) {
      await close(app)
      if (log.length > 0) await testInfo.attach(`app-${i + 1}-log.txt`, { body: log.join(''), contentType: 'text/plain' })
    }
    removeDir(userDataDir)
    removeDir(workDir)
  }
})

export { expect }
