// Phase-2 E2E helpers: test hooks decided in docs/TPM_DECISIONS.md (D2 dropFilesOnFeed, D3
// cancelActive) that are being added to src/shared/test-hooks.ts by Platform in parallel, a
// generic state + mood recorder (D1 data-uncle-mood), settings changes and /proc process checks.
//
// The hook names are typed locally on purpose: QA does not edit the shared contract, and this file
// keeps compiling whether or not the contract already lists them.
import type { ElectronApplication, Page } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { LudApi } from '../../../src/shared/api'
import type { OptionId, Settings } from '../../../src/shared/types'
import { T, expect, waitForPage } from './app'

/** Tag for tests that need phase-2 work (Platform/Frontend/Engine) — expected red until merged. */
export const NEEDS_P2 = '@needs-p2'

/** Hooks added in phase 2 (TPM decisions D2/D3). */
export interface LudTestHooksP2 {
  /** D2: simulate dropping files on the Feed Window (optionId null = drop on the Uncle, then pick). */
  dropFilesOnFeed(paths: string[], optionId: OptionId | null): Promise<unknown>
  /** D3: cancel the running job through the same code path as the cancel button. */
  cancelActive(): Promise<unknown>
}

/** Call a phase-2 hook; fails with a readable message while it does not exist yet. */
export async function hookP2<K extends keyof LudTestHooksP2>(app: ElectronApplication, name: K, ...args: Parameters<LudTestHooksP2[K]>): Promise<unknown> {
  return app.evaluate(
    async (_e, payload: { name: string; args: unknown[] }) => {
      const hooks = (globalThis as unknown as { __ludTest?: Record<string, (...a: unknown[]) => unknown> }).__ludTest
      if (!hooks) throw new Error('globalThis.__ludTest is not installed (start the app with LUD_E2E=1)')
      const fn = hooks[payload.name]
      if (typeof fn !== 'function') throw new Error(`__ludTest.${payload.name} is not a function (phase-2 hook, TPM decision D2/D3)`)
      return await fn.apply(hooks, payload.args)
    },
    { name: name as string, args: args as unknown[] }
  )
}

// ---------------------------------------------------------------------------------------------
// State + mood recorder for any stage root (overlay-root, feed-root)
// ---------------------------------------------------------------------------------------------

export interface StageSample {
  state: string
  mood: string
  plain: string
  t: number
}

/**
 * Record every (data-uncle-state, data-uncle-mood, data-plain) combination rendered by the element
 * with the given test id, using a MutationObserver inside the page so short states are not missed.
 */
export async function startStageRecorder(page: Page, testId: string): Promise<void> {
  await page.evaluate((id) => {
    interface El {
      getAttribute(n: string): string | null
    }
    interface G {
      document: { querySelector(s: string): El | null; documentElement: unknown }
      performance: { now(): number }
      MutationObserver: new (cb: () => void) => { observe(target: unknown, opts: Record<string, unknown>): void; disconnect(): void }
      __ludStage?: Record<string, { state: string; mood: string; plain: string; t: number }[]>
      __ludStageObs?: Record<string, { disconnect(): void }>
    }
    const g = globalThis as unknown as G
    g.__ludStage ??= {}
    g.__ludStageObs ??= {}
    g.__ludStageObs[id]?.disconnect()
    const samples: { state: string; mood: string; plain: string; t: number }[] = []
    g.__ludStage[id] = samples
    const read = (): void => {
      const el = g.document.querySelector(`[data-testid="${id}"]`)
      const s = {
        state: el?.getAttribute('data-uncle-state') ?? '(absent)',
        mood: el?.getAttribute('data-uncle-mood') ?? '(absent)',
        plain: el?.getAttribute('data-plain') ?? '(absent)',
        t: g.performance.now()
      }
      const last = samples[samples.length - 1]
      if (!last || last.state !== s.state || last.mood !== s.mood || last.plain !== s.plain) samples.push(s)
    }
    read()
    const obs = new g.MutationObserver(read)
    obs.observe(g.document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-uncle-state', 'data-uncle-mood', 'data-plain']
    })
    g.__ludStageObs[id] = obs
  }, testId)
}

export async function stageSamples(page: Page, testId: string): Promise<StageSample[]> {
  return page.evaluate(
    (id) => [...((globalThis as unknown as { __ludStage?: Record<string, StageSample[]> }).__ludStage?.[id] ?? [])],
    testId
  )
}

export async function attr(page: Page, testId: string, name: string): Promise<string | null> {
  return page.evaluate(
    ({ id, n }) => {
      const doc = (globalThis as unknown as { document: { querySelector(s: string): { getAttribute(a: string): string | null } | null } }).document
      return doc.querySelector(`[data-testid="${id}"]`)?.getAttribute(n) ?? null
    },
    { id: testId, n: name }
  )
}

export async function expectAttr(page: Page, testId: string, name: string, wanted: string | readonly string[], timeout: number = T.state): Promise<void> {
  const ok: readonly string[] = typeof wanted === 'string' ? [wanted] : wanted
  await expect
    .poll(async () => {
      const v = await attr(page, testId, name)
      return v !== null && ok.includes(v) ? 'ok' : `${name}=${String(v)}`
    }, { timeout, message: `waiting for [data-testid=${testId}] ${name} ∈ {${ok.join(', ')}}` })
    .toBe('ok')
}

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

/** Change settings through the Settings window's preload API (as the real toggles do). */
export async function changeSettings(app: ElectronApplication, patch: Partial<Settings>): Promise<Settings> {
  await app.evaluate(async () => {
    const hooks = (globalThis as unknown as { __ludTest: { openSettingsWindow(): Promise<void> } }).__ludTest
    await hooks.openSettingsWindow()
  })
  const settings = await waitForPage(app, 'settings')
  const result = await settings.evaluate((p) => (globalThis as unknown as { lud: LudApi }).lud.setSettings(p), patch)
  for (const [k, v] of Object.entries(patch)) expect(result[k as keyof Settings], `setting ${k}`).toBe(v)
  return result
}

// ---------------------------------------------------------------------------------------------
// Processes (Linux /proc): detect orphaned ffmpeg children after a cancel
// ---------------------------------------------------------------------------------------------

/** PIDs of live processes whose command line mentions `needle` (Linux only; [] elsewhere). */
export function processesMentioning(needle: string): number[] {
  if (process.platform !== 'linux') return []
  const pids: number[] = []
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    let cmd = ''
    try {
      cmd = readFileSync(join('/proc', name, 'cmdline'), 'utf8').replace(/\0/g, ' ')
    } catch {
      continue // process exited meanwhile
    }
    if (cmd.includes(needle)) pids.push(Number(name))
  }
  return pids
}
