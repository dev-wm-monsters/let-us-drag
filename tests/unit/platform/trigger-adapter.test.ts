import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { GestureManager } from '../../../src/main/platform/gesture'
import { GestureTrigger, modifierForKeycode } from '../../../src/main/platform/trigger'
import type { PlatformStatus } from '../../../src/shared/types'

class FakeHook extends EventEmitter {
  started = 0
  stopped = 0
  failStart: Error | null = null
  start(): void {
    if (this.failStart) throw this.failStart
    this.started++
  }
  stop(): void {
    this.stopped++
  }
}

const mouse = (button: number, x: number, y: number, shift = false) => ({ button, x, y, shiftKey: shift, altKey: false, ctrlKey: false, metaKey: false })

describe('GestureTrigger (uiohook adapter)', () => {
  it('maps hook events to arm/disarm', async () => {
    const hook = new FakeHook()
    const calls: string[] = []
    const t = new GestureTrigger({ onArm: () => calls.push('arm'), onDisarm: () => calls.push('disarm'), triggerKey: 'shift', loadHook: async () => hook, schedule: (fn) => fn() })
    expect(await t.start()).toEqual({ ok: true })
    expect(t.isRunning).toBe(true)
    hook.emit('keydown', { keycode: 42 })
    hook.emit('mousedown', mouse(1, 10, 10, true))
    hook.emit('mousemove', mouse(1, 40, 40, true))
    hook.emit('mouseup', mouse(1, 40, 40, true))
    expect(calls).toEqual(['arm', 'disarm'])
    // start twice registers listeners once
    t.stop()
    await t.start()
    hook.emit('mousedown', mouse(1, 10, 10, true))
    hook.emit('mousemove', mouse(1, 40, 40, true))
    expect(calls).toEqual(['arm', 'disarm', 'arm'])
    expect(hook.started).toBe(2)
  })

  it('stop() disarms an in-progress gesture', async () => {
    const hook = new FakeHook()
    const calls: string[] = []
    const t = new GestureTrigger({ onArm: () => calls.push('arm'), onDisarm: () => calls.push('disarm'), triggerKey: 'alt', loadHook: async () => hook, schedule: (fn) => fn() })
    await t.start()
    hook.emit('keydown', { keycode: 3640 })
    // uiohook mouse events carry the modifier mask; alt is held here
    hook.emit('mousedown', { ...mouse(1, 0, 0), altKey: true })
    hook.emit('mousemove', { ...mouse(1, 0, 50), altKey: true })
    t.stop()
    expect(calls).toEqual(['arm', 'disarm'])
    expect(hook.stopped).toBe(1)
  })

  it('defers arm/disarm out of the hook callback by default (SEC-35)', async () => {
    const hook = new FakeHook()
    const calls: string[] = []
    const t = new GestureTrigger({ onArm: () => calls.push('arm'), onDisarm: () => calls.push('disarm'), triggerKey: 'shift', loadHook: async () => hook })
    await t.start()
    hook.emit('mousedown', mouse(1, 10, 10, true))
    hook.emit('mousemove', mouse(1, 40, 40, true))
    hook.emit('mouseup', mouse(1, 40, 40, true))
    expect(calls).toEqual([])
    await new Promise((r) => setImmediate(r))
    expect(calls).toEqual(['arm', 'disarm'])
  })

  it('arms on the trigger key pressed mid-drag; ignores every non-modifier key (SEC-32)', async () => {
    const hook = new FakeHook()
    const calls: string[] = []
    const t = new GestureTrigger({ onArm: () => calls.push('arm'), onDisarm: () => calls.push('disarm'), triggerKey: 'ctrl', loadHook: async () => hook, schedule: (fn) => fn() })
    await t.start()
    hook.emit('mousedown', mouse(1, 10, 10))
    hook.emit('mousemove', mouse(1, 60, 60))
    for (const keycode of [30, 31, 57, 28, 1, 0x0e53]) hook.emit('keydown', { keycode }) // a, s, space, enter, esc, delete
    expect(calls).toEqual([])
    hook.emit('keydown', { keycode: 3613 }) // CtrlRight, pointer not moving
    expect(calls).toEqual(['arm'])
  })

  it('ignores hook events while stopped', async () => {
    const hook = new FakeHook()
    const calls: string[] = []
    const t = new GestureTrigger({ onArm: () => calls.push('arm'), onDisarm: () => calls.push('disarm'), triggerKey: 'shift', loadHook: async () => hook, schedule: (fn) => fn() })
    await t.start()
    t.stop()
    hook.emit('mousedown', mouse(1, 10, 10, true))
    hook.emit('mousemove', mouse(1, 60, 60, true))
    expect(calls).toEqual([])
  })

  it('maps only the 8 modifier key codes', () => {
    expect([42, 54].map(modifierForKeycode)).toEqual(['shift', 'shift'])
    expect([56, 3640].map(modifierForKeycode)).toEqual(['alt', 'alt'])
    expect([29, 3613].map(modifierForKeycode)).toEqual(['ctrl', 'ctrl'])
    expect([3675, 3676].map(modifierForKeycode)).toEqual(['meta', 'meta'])
    expect([30, 0, -1, 57, '42', undefined].map(modifierForKeycode)).toEqual([null, null, null, null, null, null])
  })

  it('reports start failures instead of throwing', async () => {
    const hook = new FakeHook()
    hook.failStart = new Error('UIOHOOK_ERROR_X_OPEN_DISPLAY')
    const t = new GestureTrigger({ onArm: () => undefined, onDisarm: () => undefined, triggerKey: 'shift', loadHook: async () => hook })
    expect(await t.start()).toEqual({ ok: false, error: 'UIOHOOK_ERROR_X_OPEN_DISPLAY' })
    const t2 = new GestureTrigger({
      onArm: () => undefined,
      onDisarm: () => undefined,
      triggerKey: 'shift',
      loadHook: async () => Promise.reject(new Error('cannot load native module'))
    })
    expect(await t2.start()).toEqual({ ok: false, error: 'cannot load native module' })
  })
})

describe('GestureManager', () => {
  it('never starts the hook under E2E but reports the environment', async () => {
    const statuses: PlatformStatus[] = []
    const m = new GestureManager({
      platform: 'linux',
      env: { DISPLAY: ':99' },
      neverStartHook: true,
      isAccessibilityTrusted: () => true,
      triggerKey: 'shift',
      onArm: () => undefined,
      onDisarm: () => undefined,
      onStatusChanged: (s) => statuses.push(s)
    })
    expect(await m.refresh()).toEqual({ platform: 'linux', gestureAvailable: true })
    expect(m.isHookRunning).toBe(false)
  })

  it('reports Wayland and macOS permission as unavailable', async () => {
    const base = { neverStartHook: true, triggerKey: 'shift' as const, onArm: () => undefined, onDisarm: () => undefined, onStatusChanged: () => undefined }
    const wayland = new GestureManager({ ...base, platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' }, isAccessibilityTrusted: () => true })
    expect(wayland.getStatus()).toEqual({ platform: 'linux', gestureAvailable: false, gestureUnavailableReason: 'wayland' })
    let trusted = false
    const mac = new GestureManager({ ...base, platform: 'darwin', env: {}, isAccessibilityTrusted: () => trusted })
    expect(mac.getStatus()).toEqual({ platform: 'darwin', gestureAvailable: false, gestureUnavailableReason: 'mac-permission', accessibilityTrusted: false })
    trusted = true
    expect(await mac.refresh()).toEqual({ platform: 'darwin', gestureAvailable: true, accessibilityTrusted: true })
  })
})
