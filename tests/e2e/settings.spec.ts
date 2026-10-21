// E2E-SETTINGS: toggles persist across restart; corrupted settings file recovers to defaults.
// Test plan IDs: E2E-40..E2E-42, SET-01..SET-06 (docs/qa/TEST_PLAN.md).
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LudApi } from '../../src/shared/api'
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/types'
import { NEEDS_INTEGRATION, T, expect, getSettingsFrom, hook, screenshot, test, waitForPage } from './support/app'

const BOOLEAN_TOGGLES = ['sounds', 'hungryMode', 'plainMode'] as const satisfies readonly (keyof Settings)[]

async function openSettings(app: ElectronApplication): Promise<Page> {
  await hook(app, 'openSettingsWindow')
  const page = await waitForPage(app, 'settings')
  await expect(page.getByTestId('setting-sounds')).toBeVisible({ timeout: T.window })
  return page
}

/** Checked state if the control is a checkbox/switch Playwright understands, else null (contract does not fix the element type). */
async function checkedOrNull(control: Locator): Promise<boolean | null> {
  try {
    return await control.isChecked({ timeout: 2_000 })
  } catch {
    return null
  }
}

/** Top-level JSON files in userData that look like our settings (PLAN §3: "JSON file in userData"). */
function settingsFiles(userDataDir: string): string[] {
  return readdirSync(userDataDir)
    .filter((n) => n.toLowerCase().endsWith('.json'))
    .map((n) => join(userDataDir, n))
    .filter((p) => statSync(p).isFile() && readFileSync(p, 'utf8').includes('"hungryMode"'))
}

test.describe('settings', () => {
  test('E2E-40 boolean toggles persist across an app restart', { tag: NEEDS_INTEGRATION }, async ({ lud }, testInfo) => {
    const app1 = await lud.launchReady()
    const page1 = await openSettings(app1)
    const before = await getSettingsFrom(page1)
    await screenshot(page1, testInfo, 'settings-before')

    for (const key of BOOLEAN_TOGGLES) {
      await page1.getByTestId(`setting-${key}`).click()
      await expect.poll(async () => (await getSettingsFrom(page1))[key], { timeout: T.state, message: `setting ${key} did not flip` }).toBe(!before[key])
    }
    // Trigger key through the preload API (control type for setting-triggerKey is not fixed by the contract).
    await page1.evaluate(() => (globalThis as unknown as { lud: LudApi }).lud.setSettings({ triggerKey: 'alt' }))
    await screenshot(page1, testInfo, 'settings-after-toggle')
    await lud.close(app1)

    const app2 = await lud.launchReady()
    const page2 = await openSettings(app2)
    const after = await getSettingsFrom(page2)
    for (const key of BOOLEAN_TOGGLES) {
      expect(after[key], `${key} after restart`).toBe(!before[key])
      const checked = await checkedOrNull(page2.getByTestId(`setting-${key}`))
      if (checked !== null) expect(checked, `DOM state of setting-${key}`).toBe(after[key])
    }
    expect(after.triggerKey).toBe('alt')
    await screenshot(page2, testInfo, 'settings-after-restart')
  })

  test('E2E-41 corrupted settings file → app still boots with defaults', { tag: NEEDS_INTEGRATION }, async ({ lud }) => {
    const app1 = await lud.launchReady()
    const page1 = await openSettings(app1)
    await page1.getByTestId('setting-hungryMode').click()
    await expect.poll(async () => (await getSettingsFrom(page1)).hungryMode, { timeout: T.state }).toBe(true)
    await lud.close(app1)

    const files = settingsFiles(lud.userDataDir)
    expect(files.length, `no settings JSON found in ${lud.userDataDir} (ASSUMPTION: stored at the userData root)`).toBeGreaterThan(0)
    for (const f of files) writeFileSync(f, '{ "triggerKey": "shift", "sounds": tru')

    const app2 = await lud.launchReady()
    const page2 = await openSettings(app2)
    const s = await getSettingsFrom(page2)
    const { firstRunDone: _ignored, ...rest } = s
    const { firstRunDone: _ignoredDefault, ...defaults } = DEFAULT_SETTINGS
    expect(rest).toEqual(defaults)
    expect(typeof s.firstRunDone).toBe('boolean')
  })

  test('E2E-42 settings with wrong types / unknown keys are sanitised', { tag: NEEDS_INTEGRATION }, async ({ lud }) => {
    const app1 = await lud.launchReady()
    const page1 = await openSettings(app1)
    await page1.getByTestId('setting-sounds').click()
    await expect.poll(async () => (await getSettingsFrom(page1)).sounds, { timeout: T.state }).toBe(false)
    await lud.close(app1)

    const files = settingsFiles(lud.userDataDir)
    expect(files.length).toBeGreaterThan(0)
    const bad = { triggerKey: 'banana', sounds: 'yes', hungryMode: true, plainMode: 1, launchAtLogin: null, firstRunDone: true, evil: '<script>' }
    for (const f of files) writeFileSync(f, JSON.stringify(bad))

    const app2 = await lud.launchReady()
    const page2 = await openSettings(app2)
    const s = await getSettingsFrom(page2)
    expect(['shift', 'alt', 'ctrl', 'meta']).toContain(s.triggerKey)
    for (const key of ['sounds', 'hungryMode', 'plainMode', 'launchAtLogin', 'firstRunDone'] as const) expect(typeof s[key], key).toBe('boolean')
    // ASSUMPTION: valid fields survive (hungryMode=true), invalid ones fall back to defaults field by field.
    expect(s.hungryMode).toBe(true)
    expect(Object.keys(s).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort())
  })
})
