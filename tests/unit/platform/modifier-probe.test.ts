import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { GestureManager } from '../../../src/main/platform/gesture'
import { ModifierProbe, parseModifierLine, type ModifierProbeLike, type ProbeChild } from '../../../src/main/platform/modifier-probe'
import { GestureTrigger } from '../../../src/main/platform/trigger'
import { initialTriggerState, NO_MODIFIERS, triggerReducer, type ModifierFlags } from '../../../src/main/platform/trigger-logic'
import { modifierHelperPath } from '../../../src/main/paths'

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stdin = Object.assign(new EventEmitter(), { ended: 0, end: () => void this.stdin.ended++ })
  killed = 0
  kill(): boolean {
    this.killed++
    return true
  }
}

function probeWith(opts: { exists?: boolean; spawnThrows?: boolean } = {}) {
  const children: FakeChild[] = []
  const seen: ModifierFlags[] = []
  const logs: string[] = []
  const probe = new ModifierProbe({
    helperPath: '/res/bin/lud-modifiers',
    onModifiers: (m) => seen.push(m),
    exists: () => opts.exists ?? true,
    spawn: (file) => {
      expect(file).toBe('/res/bin/lud-modifiers')
      if (opts.spawnThrows) throw new Error('spawn EACCES')
      const c = new FakeChild()
      children.push(c)
      return c as unknown as ProbeChild
    },
    debug: (m) => logs.push(m)
  })
  return { probe, children, seen, logs }
}

const SHIFT: ModifierFlags = { shift: true, ctrl: false, alt: false, meta: false }

describe('parseModifierLine', () => {
  it('parses the exact helper format', () => {
    expect(parseModifierLine('shift=1 ctrl=0 alt=0 meta=0')).toEqual(SHIFT)
    expect(parseModifierLine('shift=0 ctrl=1 alt=1 meta=1\r')).toEqual({ shift: false, ctrl: true, alt: true, meta: true })
  })
  it('rejects anything else', () => {
    for (const bad of ['', 'shift=2 ctrl=0 alt=0 meta=0', 'ctrl=0 shift=1 alt=0 meta=0', 'shift=1 ctrl=0 alt=0', ' shift=1 ctrl=0 alt=0 meta=0', 'shift=1 ctrl=0 alt=0 meta=0 x=1', 'hello']) {
      expect(parseModifierLine(bad)).toBeNull()
    }
  })
})

describe('ModifierProbe', () => {
  it('spawns one helper, parses split chunks, ignores junk', () => {
    const { probe, children, seen } = probeWith()
    probe.start()
    probe.start()
    expect(children).toHaveLength(1)
    expect(probe.isRunning).toBe(true)
    const out = children[0]!.stdout
    out.emit('data', Buffer.from('shift=0 ctrl=0 alt=0 meta=0\nshift=1 ctrl=0'))
    out.emit('data', ' alt=0 meta=0\ngarbage\n')
    expect(seen).toEqual([NO_MODIFIERS, SHIFT])
  })

  it('stop() closes stdin and kills; later output is ignored; restart spawns a new helper', () => {
    const { probe, children, seen, logs } = probeWith()
    probe.start()
    const first = children[0]!
    probe.stop()
    probe.stop()
    expect(first.stdin.ended).toBe(1)
    expect(first.killed).toBe(1)
    expect(probe.isRunning).toBe(false)
    first.stdout.emit('data', 'shift=1 ctrl=0 alt=0 meta=0\n')
    first.emit('exit', null, 'SIGTERM')
    expect(seen).toEqual([])
    probe.start()
    expect(children).toHaveLength(2)
    expect(logs).toEqual(['modifier helper started', 'modifier helper stopped', 'modifier helper started'])
  })

  it('an unexpected exit frees the slot so the next drag restarts it', () => {
    const { probe, children, logs } = probeWith()
    probe.start()
    children[0]!.emit('exit', 1, null)
    expect(probe.isRunning).toBe(false)
    expect(logs).toContain('modifier helper exited (code 1)')
    probe.start()
    expect(children).toHaveLength(2)
  })

  it('a missing binary is logged once and never throws', () => {
    const { probe, children, logs } = probeWith({ exists: false })
    probe.start()
    probe.start()
    probe.stop()
    expect(children).toHaveLength(0)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(/modifier helper not found/)
  })

  it('spawn errors (sync or async) are logged once and never throw', () => {
    const sync = probeWith({ spawnThrows: true })
    sync.probe.start()
    sync.probe.start()
    expect(sync.logs).toEqual(['modifier helper failed: spawn EACCES'])
    const async = probeWith()
    async.probe.start()
    async.children[0]!.emit('error', new Error('spawn ENOENT'))
    expect(async.probe.isRunning).toBe(false)
    async.probe.start()
    async.children[1]!.emit('error', new Error('spawn ENOENT'))
    expect(async.logs.filter((l) => l.startsWith('modifier helper failed'))).toHaveLength(1)
  })
})

describe("trigger-logic { type: 'modifiers' }", () => {
  it('arms mid-drag when the snapshot holds the trigger key', () => {
    let s = initialTriggerState('shift')
    s = triggerReducer(s, { type: 'down', button: 'left', x: 0, y: 0, modifiers: NO_MODIFIERS }).state
    s = triggerReducer(s, { type: 'move', x: 0, y: 20, modifiers: NO_MODIFIERS }).state
    expect(triggerReducer(s, { type: 'modifiers', modifiers: { ...NO_MODIFIERS, alt: true } }).action).toBeNull()
    const r = triggerReducer(s, { type: 'modifiers', modifiers: SHIFT })
    expect(r.action).toBe('arm')
    expect(r.state.armed).toBe(true)
  })
})

class FakeHook extends EventEmitter {
  start(): void {}
  stop(): void {}
}
const mouse = (button: number, x: number, y: number) => ({ button, x, y, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false })

function triggerWithFakeProbe() {
  const hook = new FakeHook()
  const calls: string[] = []
  const debug: string[] = []
  let feedProbe: (m: ModifierFlags) => void = () => undefined
  const probe: ModifierProbeLike & { starts: number; stops: number } = {
    starts: 0,
    stops: 0,
    start() {
      this.starts++
    },
    stop() {
      this.stops++
    }
  }
  const t = new GestureTrigger({
    onArm: () => calls.push('arm'),
    onDisarm: () => calls.push('disarm'),
    triggerKey: 'shift',
    loadHook: async () => hook,
    schedule: (fn) => fn(),
    debug: (m) => debug.push(m),
    createModifierProbe: (onModifiers) => {
      feedProbe = onModifiers
      return probe
    }
  })
  return { t, hook, calls, debug, probe, feed: (m: ModifierFlags) => feedProbe(m) }
}

describe('GestureTrigger + modifier probe wiring', () => {
  it('starts the probe after the drag threshold, arms from its snapshot, stops once armed', async () => {
    const { t, hook, calls, debug, probe, feed } = triggerWithFakeProbe()
    await t.start()
    hook.emit('mousedown', mouse(1, 0, 0))
    expect(probe.starts).toBe(0)
    hook.emit('mousemove', mouse(1, 0, 30))
    hook.emit('mousemove', mouse(1, 0, 40))
    expect(probe.starts).toBe(1)
    feed(NO_MODIFIERS)
    expect(calls).toEqual([])
    feed(SHIFT)
    expect(calls).toEqual(['arm'])
    expect(probe.stops).toBe(1)
    expect(debug).toContain('trigger: shift down, ARM')
    hook.emit('mouseup', mouse(1, 0, 40))
    expect(calls).toEqual(['arm', 'disarm'])
    expect(probe.starts).toBe(1)
  })

  it('stops the probe on left-up without arming and on stop()', async () => {
    const { t, hook, probe, feed, calls } = triggerWithFakeProbe()
    await t.start()
    hook.emit('mousedown', mouse(1, 0, 0))
    hook.emit('mousemove', mouse(1, 0, 30))
    hook.emit('mouseup', mouse(1, 0, 30))
    expect([probe.starts, probe.stops]).toEqual([1, 1])
    hook.emit('mousedown', mouse(1, 0, 0))
    hook.emit('mousemove', mouse(1, 0, 30))
    expect(probe.starts).toBe(2)
    t.stop()
    expect(probe.stops).toBeGreaterThanOrEqual(2)
    feed(SHIFT) // late output after stop: ignored
    expect(calls).toEqual([])
  })

  it('GestureManager creates the probe on darwin only', () => {
    const make = (platform: NodeJS.Platform) => {
      let created = 0
      new GestureManager({
        platform,
        env: {},
        neverStartHook: true,
        isAccessibilityTrusted: () => true,
        triggerKey: 'shift',
        onArm: () => undefined,
        onDisarm: () => undefined,
        onStatusChanged: () => undefined,
        modifierHelperPath: '/res/bin/lud-modifiers',
        createModifierProbe: () => {
          created++
          return { start: () => undefined, stop: () => undefined }
        }
      })
      return created
    }
    expect(make('darwin')).toBe(1)
    expect(make('win32')).toBe(0)
    expect(make('linux')).toBe(0)
  })

  it('modifierHelperPath: packaged resources/bin, dev resources/bin/darwin-<arch>', () => {
    const layout = { mainDir: '/app/out/main', isPackaged: true, resourcesPath: '/R', appPath: '/repo' }
    expect(modifierHelperPath(layout, 'arm64').replace(/\\/g, '/')).toBe('/R/bin/lud-modifiers')
    expect(modifierHelperPath({ ...layout, isPackaged: false }, 'x64').replace(/\\/g, '/')).toBe('/repo/resources/bin/darwin-x64/lud-modifiers')
  })
})
