import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySettingsPatch, parseSettings, SETTINGS_FILE_NAME, SettingsStore } from '../../../src/main/settings-store'
import { DEFAULT_SETTINGS } from '../../../src/shared/types'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lud-settings-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('parseSettings', () => {
  it('returns defaults for garbage', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('x')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings([1, 2])).toEqual(DEFAULT_SETTINGS)
  })
  it('keeps valid fields and replaces invalid ones with defaults', () => {
    const s = parseSettings({ triggerKey: 'alt', sounds: 'yes', hungryMode: true, extra: 1 })
    expect(s).toEqual({ ...DEFAULT_SETTINGS, triggerKey: 'alt', hungryMode: true })
    expect('extra' in s).toBe(false)
  })
})

describe('applySettingsPatch', () => {
  it('applies a partial patch', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, { sounds: false })).toEqual({ ...DEFAULT_SETTINGS, sounds: false })
  })
  it('rejects unknown keys and wrong types', () => {
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { evil: true })).toThrow()
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { triggerKey: 'capslock' })).toThrow()
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, null)).toThrow()
  })
})

describe('SettingsStore', () => {
  it('keeps the saved value and notifies nobody when the write fails', async () => {
    await writeFile(join(dir, 'a-file'), 'x')
    const store = new SettingsStore(join(dir, 'a-file', 'nested')) // mkdir/write under a file fails
    await store.load()
    let notified = 0
    store.onChange(() => notified++)
    await expect(store.update({ triggerKey: 'alt' })).rejects.toThrow()
    expect(store.get().triggerKey).toBe(DEFAULT_SETTINGS.triggerKey)
    expect(notified).toBe(0)
  })
  it('starts from defaults when the file is missing', async () => {
    const store = new SettingsStore(dir)
    expect(await store.load()).toEqual(DEFAULT_SETTINGS)
  })

  it('falls back to defaults on a corrupt file', async () => {
    await writeFile(join(dir, SETTINGS_FILE_NAME), '{not json', 'utf8')
    const store = new SettingsStore(dir)
    expect(await store.load()).toEqual(DEFAULT_SETTINGS)
  })

  it('persists updates atomically and notifies listeners', async () => {
    const store = new SettingsStore(join(dir, 'nested'))
    await store.load()
    const seen: [boolean, boolean][] = []
    store.onChange((next, prev) => seen.push([prev.plainMode, next.plainMode]))
    const next = await store.update({ plainMode: true, triggerKey: 'meta' })
    expect(next.plainMode).toBe(true)
    expect(seen).toEqual([[false, true]])
    const onDisk = JSON.parse(await readFile(join(dir, 'nested', SETTINGS_FILE_NAME), 'utf8'))
    expect(onDisk).toEqual({ ...DEFAULT_SETTINGS, plainMode: true, triggerKey: 'meta' })
    // no temp files left behind
    expect(await readdir(join(dir, 'nested'))).toEqual([SETTINGS_FILE_NAME])
    // round trip
    const again = new SettingsStore(join(dir, 'nested'))
    expect(await again.load()).toEqual(next)
  })

  it('serializes concurrent writes (last write wins)', async () => {
    const store = new SettingsStore(dir)
    await store.load()
    await Promise.all([store.update({ sounds: false }), store.update({ hungryMode: true }), store.update({ sounds: true })])
    const onDisk = JSON.parse(await readFile(join(dir, SETTINGS_FILE_NAME), 'utf8'))
    expect(onDisk).toEqual({ ...DEFAULT_SETTINGS, sounds: true, hungryMode: true })
  })

  it('does not change state on an invalid patch', async () => {
    const store = new SettingsStore(dir)
    await store.load()
    await expect(store.update({ sounds: 'loud' })).rejects.toThrow()
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('get() returns a copy', async () => {
    const store = new SettingsStore(dir)
    await store.load()
    const s = store.get()
    s.sounds = false
    expect(store.get().sounds).toBe(true)
  })
})
