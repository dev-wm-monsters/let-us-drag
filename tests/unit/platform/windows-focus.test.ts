// Windows review regressions:
// - B-073: the overlay must not call setFocusable(false) on a visible window again and again (on
//   Windows that "deactivates" it and hands the foreground to the next window in Z-order), and must
//   stay off the taskbar when it becomes focusable for feedMe.
// - B-074: the input hook can be restarted to resync modifiers lost on the lock screen.
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeLayout } from '../../../src/main/paths'
import { GestureManager } from '../../../src/main/platform/gesture'

type Call = [string, ...unknown[]]
const calls: Call[] = []
class FakeWebContents {
  id = 9
  on(): void {}
  once(): void {}
  setWindowOpenHandler(): void {}
  send(): void {}
}
class FakeBrowserWindow {
  static last: FakeBrowserWindow | null = null
  webContents = new FakeWebContents()
  visible = false
  bounds = { x: 0, y: 0, width: 560, height: 560 }
  constructor(readonly options: Record<string, unknown>) {
    FakeBrowserWindow.last = this
  }
  setAlwaysOnTop(): void {}
  setVisibleOnAllWorkspaces(): void {}
  isAlwaysOnTop(): boolean {
    return true
  }
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
    calls.push(['hide'])
  }
  focus(): void {
    calls.push(['focus'])
  }
  setFocusable(v: boolean): void {
    // Records whether the window was visible: that is when Electron deactivates it on Windows.
    calls.push(['setFocusable', v, this.visible ? 'visible' : 'hidden'])
  }
  setSkipTaskbar(v: boolean): void {
    calls.push(['setSkipTaskbar', v])
  }
  setIgnoreMouseEvents(): void {}
}
vi.mock('electron', () => ({
  BrowserWindow: FakeBrowserWindow,
  screen: {
    getCursorScreenPoint: () => ({ x: 500, y: 400 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })
  }
}))

const layout: RuntimeLayout = { mainDir: '/app/out/main', isPackaged: false, resourcesPath: '/res', appPath: '/repo' }

async function makeOverlay(platform: NodeJS.Platform) {
  const { OverlayController } = await import('../../../src/main/windows/overlay')
  const ctx = { layout, e2e: false, register: () => undefined }
  const overlay = new OverlayController({ ctx, getSettings: () => ({ triggerKey: 'shift' }) as never, isQuitting: () => false, platform })
  return { overlay, win: FakeBrowserWindow.last! }
}

const focusableCalls = (): Call[] => calls.filter((c) => c[0] === 'setFocusable')

describe('B-073: overlay focusable handling', () => {
  beforeEach(() => {
    calls.length = 0
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('win32: a normal gesture (drop on a bubble, card, D21 re-arm, hide) never calls setFocusable', async () => {
    const { overlay } = await makeOverlay('win32')
    overlay.arm({ x: 100, y: 100 })
    overlay.jobStarted('j')
    overlay.disarm()
    overlay.jobFinished('j')
    overlay.arm({ x: 900, y: 500 }) // D21: new gesture over the visible card
    overlay.jobStarted('k')
    overlay.disarm()
    overlay.jobFinished('k')
    overlay.done()
    expect(focusableCalls()).toEqual([])
    expect(calls.some((c) => c[0] === 'focus')).toBe(false)
  })

  it('win32 feedMe: focusable while interactive, stays off the taskbar, never made non-focusable while visible', async () => {
    const { overlay, win } = await makeOverlay('win32')
    overlay.arm({ x: 100, y: 100 })
    overlay.engaged()
    overlay.setInteractive(true)
    expect(focusableCalls()).toEqual([['setFocusable', true, 'visible']])
    expect(calls.findIndex((c) => c[0] === 'setSkipTaskbar' && c[1] === true)).toBeGreaterThan(calls.findIndex((c) => c[0] === 'setFocusable'))
    overlay.setInteractive(false) // option picked: no deactivation while still visible
    expect(focusableCalls()).toHaveLength(1)
    overlay.disarm()
    overlay.done()
    // Reset only once hidden (Focus(false) is a no-op on a hidden window).
    expect(focusableCalls()).toEqual([
      ['setFocusable', true, 'visible'],
      ['setFocusable', false, 'hidden']
    ])
    expect(win.visible).toBe(false)
    expect(calls.filter((c) => c[0] === 'setSkipTaskbar').every((c) => c[1] === true)).toBe(true)
  })

  it('macOS is unchanged: setFocusable at arm and when interaction ends, no taskbar calls', async () => {
    const { overlay } = await makeOverlay('darwin')
    overlay.arm({ x: 100, y: 100 })
    overlay.engaged()
    overlay.setInteractive(true)
    overlay.setInteractive(false)
    expect(focusableCalls()).toEqual([
      ['setFocusable', false, 'hidden'], // arm (unchanged on macOS)
      ['setFocusable', true, 'visible'],
      ['setFocusable', false, 'visible']
    ])
    expect(calls.some((c) => c[0] === 'setSkipTaskbar')).toBe(false)
  })
})

class FakeHook extends EventEmitter {
  started = 0
  stopped = 0
  start(): void {
    this.started++
  }
  stop(): void {
    this.stopped++
  }
}

describe('B-074: GestureManager.restartHook (modifier resync after the lock screen)', () => {
  const make = (hook: FakeHook) =>
    new GestureManager({
      platform: 'win32',
      env: {},
      neverStartHook: false,
      isAccessibilityTrusted: () => true,
      triggerKey: 'meta',
      onArm: () => undefined,
      onDisarm: () => undefined,
      onStatusChanged: () => undefined,
      loadHook: async () => hook
    })

  it('stops and starts a running hook', async () => {
    const hook = new FakeHook()
    const m = make(hook)
    await m.refresh()
    expect(hook.started).toBe(1)
    await m.restartHook()
    expect(hook.stopped).toBe(1)
    expect(hook.started).toBe(2)
    expect(m.isHookRunning).toBe(true)
  })

  it('does nothing while paused or before the hook runs', async () => {
    const hook = new FakeHook()
    const m = make(hook)
    await m.restartHook()
    expect(hook.started).toBe(0)
    await m.refresh()
    await m.setPaused(true)
    const stopped = hook.stopped
    await m.restartHook()
    expect(hook.started).toBe(1)
    expect(hook.stopped).toBe(stopped)
    expect(m.isHookRunning).toBe(false)
  })
})
