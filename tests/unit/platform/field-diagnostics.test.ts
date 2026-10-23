// Field diagnostics: overlay variant overrides (env + debug-overrides.json), diagnostics switch,
// trigger transition descriptions (privacy) and the overlay wiring of the variants.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_OVERLAY_OVERRIDES,
  diagnosticsEnabled,
  parseFlag,
  parseLevel,
  parseOverlayOverrides
} from '../../../src/main/debug-overrides'
import { formatDebugLine } from '../../../src/main/logger'
import { GestureTrigger } from '../../../src/main/platform/trigger'
import { describeTriggerTransition, initialTriggerState, triggerReducer, type TriggerInput } from '../../../src/main/platform/trigger-logic'
import type { RuntimeLayout } from '../../../src/main/paths'

describe('overlay override parsing', () => {
  it('defaults are exactly today’s behaviour', () => {
    const r = parseOverlayOverrides({})
    expect(r.overrides).toEqual({ level: 'screen-saver', sensorFollow: true, focusable: false, panel: false })
    expect(r.overrides).toEqual(DEFAULT_OVERLAY_OVERRIDES)
    expect(r.sources).toEqual({})
    expect(r.warnings).toEqual([])
  })
  it('macOS defaults to field variant A (floating, sensor placed once); other OSes unchanged', () => {
    expect(parseOverlayOverrides({}, undefined, 'darwin').overrides).toEqual({ level: 'floating', sensorFollow: false, focusable: false, panel: false })
    expect(parseOverlayOverrides({}, undefined, 'win32').overrides).toEqual(DEFAULT_OVERLAY_OVERRIDES)
    expect(parseOverlayOverrides({}, undefined, 'linux').overrides).toEqual(DEFAULT_OVERLAY_OVERRIDES)
    // An override file still wins on macOS (e.g. the old behaviour back for a test).
    expect(parseOverlayOverrides({}, { LUD_OVERLAY_LEVEL: 'screen-saver', LUD_SENSOR_FOLLOW: 1 }, 'darwin').overrides).toEqual(DEFAULT_OVERLAY_OVERRIDES)
  })
  it('reads every key from the environment', () => {
    const r = parseOverlayOverrides({
      LUD_OVERLAY_LEVEL: 'pop-up-menu',
      LUD_SENSOR_FOLLOW: '0',
      LUD_OVERLAY_FOCUSABLE: '1',
      LUD_OVERLAY_PANEL: '1'
    })
    expect(r.overrides).toEqual({ level: 'pop-up-menu', sensorFollow: false, focusable: true, panel: true })
    expect(r.sources).toEqual({ LUD_OVERLAY_LEVEL: 'env', LUD_SENSOR_FOLLOW: 'env', LUD_OVERLAY_FOCUSABLE: 'env', LUD_OVERLAY_PANEL: 'env' })
  })
  it('reads the same keys from debug-overrides.json (strings, numbers or booleans)', () => {
    const r = parseOverlayOverrides({}, { LUD_OVERLAY_LEVEL: 'floating', LUD_SENSOR_FOLLOW: 0, LUD_OVERLAY_FOCUSABLE: true, LUD_OVERLAY_PANEL: '1' })
    expect(r.overrides).toEqual({ level: 'floating', sensorFollow: false, focusable: true, panel: true })
    expect(r.sources.LUD_OVERLAY_LEVEL).toBe('file')
    expect(r.warnings).toEqual([])
  })
  it('the environment wins over the file; an invalid env value falls back to the file', () => {
    const r = parseOverlayOverrides({ LUD_OVERLAY_LEVEL: 'normal', LUD_SENSOR_FOLLOW: 'maybe' }, { LUD_OVERLAY_LEVEL: 'floating', LUD_SENSOR_FOLLOW: '0' })
    expect(r.overrides.level).toBe('normal')
    expect(r.overrides.sensorFollow).toBe(false)
    expect(r.sources).toEqual({ LUD_OVERLAY_LEVEL: 'env', LUD_SENSOR_FOLLOW: 'file' })
    expect(r.warnings).toHaveLength(1)
  })
  it('empty env values count as unset', () => {
    expect(parseOverlayOverrides({ LUD_OVERLAY_LEVEL: '', LUD_OVERLAY_PANEL: '  ' })).toEqual({ overrides: DEFAULT_OVERLAY_OVERRIDES, sources: {}, warnings: [] })
  })
  it('invalid values keep the default and are reported', () => {
    const r = parseOverlayOverrides({ LUD_OVERLAY_LEVEL: 'dock' }, { LUD_OVERLAY_FOCUSABLE: 2, LUD_OVERLAY_PANEL: null, LUD_TYPO: 1 })
    expect(r.overrides).toEqual(DEFAULT_OVERLAY_OVERRIDES)
    expect(r.warnings.join('\n')).toMatch(/LUD_OVERLAY_LEVEL/)
    expect(r.warnings.join('\n')).toMatch(/LUD_OVERLAY_FOCUSABLE/)
    expect(r.warnings.join('\n')).toMatch(/LUD_OVERLAY_PANEL/)
    expect(r.warnings.join('\n')).toMatch(/LUD_TYPO/)
  })
  it('a file that is not a JSON object is ignored', () => {
    for (const file of [null, [], 'x', 3]) {
      const r = parseOverlayOverrides({}, file)
      expect(r.overrides).toEqual(DEFAULT_OVERLAY_OVERRIDES)
      expect(r.warnings).toHaveLength(1)
    }
  })
  it('flag and level spellings', () => {
    expect(['1', 'true', 'YES', ' on ', 1, true].map(parseFlag)).toEqual([true, true, true, true, true, true])
    expect(['0', 'false', 'no', 'off', 0, false].map(parseFlag)).toEqual([false, false, false, false, false, false])
    expect(['', '2', 'y', 2, null, undefined, {}].map(parseFlag)).toEqual([null, null, null, null, null, null, null])
    expect(parseLevel('Screen-Saver')).toBe('screen-saver')
    expect(parseLevel('pop-up-menu')).toBe('pop-up-menu')
    expect(parseLevel('status')).toBeNull()
    expect(parseLevel(1)).toBeNull()
  })
})

describe('diagnostics switch', () => {
  it('LUD_DEBUG=1 or debug.flag', () => {
    expect(diagnosticsEnabled({}, false)).toBe(false)
    expect(diagnosticsEnabled({ LUD_DEBUG: '0' }, false)).toBe(false)
    expect(diagnosticsEnabled({ LUD_DEBUG: '1' }, false)).toBe(true)
    expect(diagnosticsEnabled({}, true)).toBe(true)
  })
  it('one timestamped line per message', () => {
    expect(formatDebugLine('a\nb', new Date('2026-01-02T03:04:05.006Z'))).toBe('[lud 2026-01-02T03:04:05.006Z] a b\n')
  })
})

describe('trigger transition log (privacy)', () => {
  const mods = (shift: boolean, alt = false) => ({ shift, alt, ctrl: false, meta: false })
  function log(inputs: TriggerInput[]): string[] {
    let s = initialTriggerState('shift')
    const out: string[] = []
    for (const i of inputs) {
      const r = triggerReducer(s, i)
      out.push(...describeTriggerTransition(s, r.state, r.action))
      s = r.state
    }
    return out
  }
  it('logs button, threshold, trigger key and arm/disarm, never coordinates', () => {
    const lines = log([
      { type: 'down', button: 'left', x: 1234, y: 987, modifiers: mods(false) },
      { type: 'move', x: 1300, y: 987, modifiers: mods(false) },
      { type: 'modifier', key: 'shift', held: true },
      { type: 'move', x: 1310, y: 990, modifiers: mods(true) },
      { type: 'up', button: 'left', x: 1310, y: 990, modifiers: mods(true) },
      { type: 'modifier', key: 'shift', held: false }
    ])
    expect(lines).toEqual(['left down', 'drag threshold passed', 'shift down', 'ARM', 'left up', 'DISARM', 'shift up'])
    expect(lines.join(' ')).not.toMatch(/\d/)
  })
  it('ignores other modifiers and plain moves', () => {
    expect(
      log([
        { type: 'modifier', key: 'alt', held: true },
        { type: 'move', x: 5, y: 5, modifiers: mods(false, true) },
        { type: 'down', button: 'other', x: 5, y: 5, modifiers: mods(false, true) }
      ])
    ).toEqual([])
  })
  it('GestureTrigger reports through schedule only when debug is set', () => {
    const scheduled: (() => void)[] = []
    const lines: string[] = []
    const t = new GestureTrigger({ onArm: () => undefined, onDisarm: () => undefined, triggerKey: 'shift', schedule: (f) => scheduled.push(f), debug: (m) => lines.push(m) })
    t.feed({ type: 'down', button: 'left', x: 0, y: 0, modifiers: mods(false) })
    expect(lines).toEqual([])
    scheduled.splice(0).forEach((f) => f())
    expect(lines).toEqual(['trigger: left down'])
    const quiet = new GestureTrigger({ onArm: () => undefined, onDisarm: () => undefined, triggerKey: 'shift', schedule: (f) => scheduled.push(f) })
    quiet.feed({ type: 'down', button: 'left', x: 0, y: 0, modifiers: mods(false) })
    expect(scheduled).toHaveLength(0)
  })
})

// --- overlay wiring of the variants (fake electron) ----------------------------------------------
const calls: unknown[][] = []
class FakeBrowserWindow {
  static last: FakeBrowserWindow | null = null
  webContents = { id: 9, on() {}, once() {}, setWindowOpenHandler() {}, send() {} }
  visible = false
  bounds = { x: 0, y: 0, width: 560, height: 560 }
  constructor(readonly options: Record<string, unknown>) {
    FakeBrowserWindow.last = this
  }
  setAlwaysOnTop(...a: unknown[]): void {
    calls.push(['setAlwaysOnTop', ...a])
  }
  setVisibleOnAllWorkspaces(): void {}
  on(): void {}
  removeMenu(): void {}
  loadFile(): Promise<void> {
    return Promise.resolve()
  }
  loadURL(): Promise<void> {
    return Promise.resolve()
  }
  isDestroyed(): boolean {
    return false
  }
  isVisible(): boolean {
    return this.visible
  }
  isAlwaysOnTop(): boolean {
    return true
  }
  isFocusable(): boolean {
    return false
  }
  isFocused(): boolean {
    return false
  }
  getBounds(): typeof this.bounds {
    return this.bounds
  }
  setBounds(b: typeof this.bounds): void {
    this.bounds = b
  }
  showInactive(): void {
    this.visible = true
  }
  hide(): void {
    this.visible = false
  }
  focus(): void {}
  setFocusable(v: boolean): void {
    calls.push(['setFocusable', v])
  }
  setIgnoreMouseEvents(): void {}
}
vi.mock('electron', () => ({
  BrowserWindow: FakeBrowserWindow,
  screen: {
    getCursorScreenPoint: () => ({ x: 500, y: 400 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getDisplayMatching: () => ({ id: 1, scaleFactor: 2 })
  }
}))

const layout: RuntimeLayout = { mainDir: '/app/out/main', isPackaged: false, resourcesPath: '/res', appPath: '/repo' }

async function makeOverlay(platform: NodeJS.Platform, env: Record<string, string>, debug?: (m: string) => void) {
  const { OverlayController } = await import('../../../src/main/windows/overlay')
  const ctx = { layout, e2e: false, register: () => undefined }
  const overlay = new OverlayController({
    ctx,
    getSettings: () => ({ triggerKey: 'shift' }) as never,
    isQuitting: () => false,
    platform,
    overrides: parseOverlayOverrides(env).overrides,
    debug
  })
  return { overlay, win: FakeBrowserWindow.last! }
}

describe('overlay variants', () => {
  beforeEach(() => {
    calls.length = 0
  })
  it('defaults: screen-saver level, not focusable, no panel, follows the cursor, no debug flag', async () => {
    const { overlay, win } = await makeOverlay('darwin', {})
    expect(win.options['focusable']).toBe(false)
    expect('type' in win.options).toBe(false)
    expect((win.options['webPreferences'] as { additionalArguments: string[] }).additionalArguments).toEqual([])
    overlay.arm()
    expect(calls.filter((c) => c[0] === 'setAlwaysOnTop')).toEqual([
      ['setAlwaysOnTop', true, 'screen-saver'],
      ['setAlwaysOnTop', true, 'screen-saver']
    ])
    expect(calls).toContainEqual(['setFocusable', false])
    expect((overlay as unknown as { session: { follow: boolean } }).session.follow).toBe(true)
    overlay.dispose()
  })
  it('LUD_OVERLAY_LEVEL / LUD_OVERLAY_FOCUSABLE / LUD_OVERLAY_PANEL / LUD_SENSOR_FOLLOW', async () => {
    const lines: string[] = []
    const env = { LUD_OVERLAY_LEVEL: 'floating', LUD_OVERLAY_FOCUSABLE: '1', LUD_OVERLAY_PANEL: '1', LUD_SENSOR_FOLLOW: '0' }
    const { overlay, win } = await makeOverlay('darwin', env, (m) => lines.push(m))
    expect(win.options['focusable']).toBe(true)
    expect(win.options['type']).toBe('panel')
    expect((win.options['webPreferences'] as { additionalArguments: string[] }).additionalArguments).toEqual(['--lud-debug'])
    overlay.arm()
    expect(calls.filter((c) => c[0] === 'setAlwaysOnTop').every((c) => c[2] === 'floating')).toBe(true)
    expect(calls).toContainEqual(['setFocusable', true])
    expect((overlay as unknown as { session: { follow: boolean } }).session.follow).toBe(false)
    expect(lines.some((l) => l.includes('scale=2'))).toBe(true)
    overlay.engaged()
    overlay.disarm()
    overlay.done()
    expect(lines.some((l) => l.includes('overlayEngaged received'))).toBe(true)
    expect(lines.some((l) => l.includes('overlayDone received'))).toBe(true)
    overlay.dispose()
  })
  it('panel is macOS only', async () => {
    const { win } = await makeOverlay('win32', { LUD_OVERLAY_PANEL: '1' })
    expect('type' in win.options).toBe(false)
  })
})
