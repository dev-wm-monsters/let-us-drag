// Regression tests for the phase-4 Platform fixes: B-051/B-052 (D20 click-through overlay),
// B-055 (dropFilesOnFeed opening the Feed Window), B-056 (D21 new gesture over a card),
// B-058 (D22 remote-debugging switches), B-059 (D22 spell-check dictionary download).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../../src/shared/api'
import { TEST_FEED_DROP_CHANNEL } from '../../../src/shared/test-hooks'
import { FORBIDDEN_DEBUG_SWITCHES, forbiddenDebugSwitch, switchNameOf } from '../../../src/main/debug-switches'
import { IPC_ALLOWLIST, isAllowedChannel } from '../../../src/main/ipc-policy'
import type { RuntimeLayout } from '../../../src/main/paths'
import { disableSpellChecker, NO_DICTIONARY_URL, secureWebPreferences } from '../../../src/main/security'
import { deliverFeedDrop, type FeedDropTarget } from '../../../src/main/test-hooks'
import {
  clickThroughAllowed,
  initialOverlaySession,
  isBusy,
  overlaySessionReducer as reduce,
  type OverlaySession,
  type OverlaySessionEvent
} from '../../../src/main/windows/overlay-session'

// --- a fake electron for the OverlayController wiring test --------------------------------------
type Call = [string, ...unknown[]]
const calls: Call[] = []
class FakeWebContents {
  id = 7
  on(): void {}
  once(): void {}
  setWindowOpenHandler(): void {}
  send(channel: string, payload?: unknown): void {
    calls.push(['send', channel, payload])
  }
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
    calls.push(['showInactive'])
  }
  hide(): void {
    this.visible = false
    calls.push(['hide'])
  }
  focus(): void {
    calls.push(['focus'])
  }
  setFocusable(v: boolean): void {
    calls.push(['setFocusable', v])
  }
  setSkipTaskbar(v: boolean): void {
    calls.push(['setSkipTaskbar', v])
  }
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void {
    calls.push(options === undefined ? ['setIgnoreMouseEvents', ignore] : ['setIgnoreMouseEvents', ignore, options])
  }
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
  const settings = { triggerKey: 'shift' } as never
  const overlay = new OverlayController({ ctx, getSettings: () => settings, isQuitting: () => false, platform })
  const win = FakeBrowserWindow.last!
  return { overlay, win }
}

const ignoreCalls = (): Call[] => calls.filter((c) => c[0] === 'setIgnoreMouseEvents')

function run(events: OverlaySessionEvent[], s: OverlaySession = initialOverlaySession()): OverlaySession {
  return events.reduce(reduce, s)
}

describe('D21 / B-056: a new gesture interrupts a card, never a running job', () => {
  const arm: OverlaySessionEvent = { type: 'arm', follow: true }
  it('re-arms over a result/error card (released, no job), even if the card had asked for interaction', () => {
    const card = run([arm, { type: 'engaged' }, { type: 'jobStarted', jobId: 'j' }, { type: 'disarm' }, { type: 'jobFinished', jobId: 'j' }])
    expect(isBusy(card)).toBe(false)
    expect(reduce(card, { type: 'arm', follow: true }).phase).toBe('armed')
    const oldRendererCard = reduce(card, { type: 'interactive', value: true })
    expect(isBusy(oldRendererCard)).toBe(false)
    expect(reduce(oldRendererCard, arm)).toEqual({ phase: 'armed', interactive: false, jobs: [], follow: true })
  })
  it('re-arms when the mouse-up of the previous gesture was missed (engaged, job finished; E2E test drops)', () => {
    const s = run([arm, { type: 'jobStarted', jobId: 'j' }, { type: 'jobFinished', jobId: 'j' }])
    expect(s.phase).toBe('engaged')
    expect(reduce(s, arm).phase).toBe('armed')
  })
  it('feedMe (interactive, no job) is interruptible like the renderer allows', () => {
    const feedMe = run([arm, { type: 'engaged' }, { type: 'interactive', value: true }, { type: 'disarm' }])
    expect(reduce(feedMe, arm).phase).toBe('armed')
  })
  it('a running conversion (chew) and a double arm stay ignored', () => {
    const chewing = run([arm, { type: 'jobStarted', jobId: 'j' }, { type: 'disarm' }])
    expect(reduce(chewing, arm)).toBe(chewing)
    const chewingEngaged = run([arm, { type: 'jobStarted', jobId: 'j' }])
    expect(reduce(chewingEngaged, arm)).toBe(chewingEngaged)
    const armed = run([arm])
    expect(reduce(armed, arm)).toBe(armed)
  })
})

describe('D20 / B-051: click-through policy', () => {
  const released = run([{ type: 'arm', follow: true }, { type: 'jobStarted', jobId: 'j' }, { type: 'disarm' }])
  it('only on macOS and Windows (no forwarded mouse moves on Linux)', () => {
    expect(clickThroughAllowed(released, 'darwin')).toBe(true)
    expect(clickThroughAllowed(released, 'win32')).toBe(true)
    expect(clickThroughAllowed(released, 'linux')).toBe(false)
  })
  it('never while hidden or while the sensor is armed (it must stay a drop target, D16)', () => {
    for (const p of ['darwin', 'win32'] as const) {
      expect(clickThroughAllowed(initialOverlaySession(), p)).toBe(false)
      expect(clickThroughAllowed(run([{ type: 'arm', follow: true }]), p)).toBe(false)
      // After the drop (the renderer asks before main has seen the mouse-up): allowed.
      expect(clickThroughAllowed(run([{ type: 'arm', follow: true }, { type: 'jobStarted', jobId: 'j' }]), p)).toBe(true)
    }
  })
  it('the channel exists and only the overlay page may use it', () => {
    expect(IPC.overlayClickThrough).toBe('lud:overlay-click-through')
    expect(IPC_ALLOWLIST[IPC.overlayClickThrough]).toEqual(['overlay'])
    expect(isAllowedChannel(IPC.overlayClickThrough, 'overlay')).toBe(true)
    expect(isAllowedChannel(IPC.overlayClickThrough, 'feed')).toBe(false)
    expect(isAllowedChannel(IPC.overlayClickThrough, 'settings')).toBe(false)
  })
})

describe('OverlayController (fake electron): D20 / D21 wiring', () => {
  beforeEach(() => {
    calls.length = 0
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('macOS: acceptFirstMouse so card/cancel clicks reach the page without focus', async () => {
    const { win } = await makeOverlay('darwin')
    expect(win.options['acceptFirstMouse']).toBe(true)
    expect(win.options['focusable']).toBe(false)
    const { win: winWin } = await makeOverlay('win32')
    expect(winWin.options['acceptFirstMouse']).toBeUndefined()
  })

  for (const platform of ['darwin', 'win32'] as const) {
    it(`${platform}: click-through after the drop, off over buttons, reset on new arm and on hide; no focus`, async () => {
      const { overlay } = await makeOverlay(platform)
      overlay.setClickThrough(true) // hidden: ignored
      expect(ignoreCalls()).toEqual([])
      overlay.arm({ x: 100, y: 100 })
      overlay.setClickThrough(true) // stale request while armed: ignored, still a drop target
      expect(overlay.clickThrough).toBe(false)
      overlay.jobStarted('j') // the drop
      overlay.setClickThrough(true)
      expect(overlay.clickThrough).toBe(true)
      expect(ignoreCalls().at(-1)).toEqual(['setIgnoreMouseEvents', true, { forward: true }])
      overlay.setClickThrough(false) // pointer over the cancel button
      expect(ignoreCalls().at(-1)).toEqual(['setIgnoreMouseEvents', false])
      overlay.setClickThrough(true)
      overlay.disarm()
      overlay.jobFinished('j') // spit card shown (click-through except over it)
      expect(overlay.clickThrough).toBe(true)
      // D21: a new gesture over the card dismisses it; the new sensor is a normal drop target.
      overlay.arm({ x: 900, y: 500 })
      expect(overlay.phase).toBe('armed')
      expect(overlay.clickThrough).toBe(false)
      expect(ignoreCalls().at(-1)).toEqual(['setIgnoreMouseEvents', false])
      expect(calls.filter((c) => c[0] === 'send' && c[1] === IPC.overlayArm)).toHaveLength(2)
      overlay.jobStarted('k')
      overlay.setClickThrough(true)
      overlay.done()
      expect(overlay.clickThrough).toBe(false)
      expect(ignoreCalls().at(-1)).toEqual(['setIgnoreMouseEvents', false])
      // B-052: nothing above took keyboard focus.
      expect(calls.some((c) => c[0] === 'focus')).toBe(false)
    })
  }

  it('feedMe (setInteractive(true)) is the only focus, and it turns click-through off', async () => {
    const { overlay } = await makeOverlay('win32')
    overlay.arm({ x: 100, y: 100 })
    overlay.engaged()
    overlay.setClickThrough(true)
    overlay.setInteractive(true)
    expect(overlay.clickThrough).toBe(false)
    expect(calls.filter((c) => c[0] === 'focus')).toHaveLength(1)
    overlay.setInteractive(false)
    expect(calls.filter((c) => c[0] === 'focus')).toHaveLength(1)
  })

  it('a running job still blocks a new arm (one Uncle at a time)', async () => {
    const { overlay } = await makeOverlay('darwin')
    overlay.arm({ x: 100, y: 100 })
    overlay.jobStarted('j')
    overlay.disarm()
    const sends = calls.length
    overlay.arm({ x: 900, y: 500 })
    expect(overlay.phase).toBe('released')
    expect(calls.length).toBe(sends)
  })

  it('Linux: never ignores the mouse (no forwarding there), so the overlay stays clickable', async () => {
    const { overlay } = await makeOverlay('linux')
    overlay.arm({ x: 100, y: 100 })
    overlay.jobStarted('j')
    overlay.setClickThrough(true)
    overlay.disarm()
    overlay.jobFinished('j')
    overlay.done()
    expect(overlay.clickThrough).toBe(false)
    expect(ignoreCalls()).toEqual([])
  })
})

describe('D22 / B-058: remote-debugging switches', () => {
  const none = (): boolean => false
  it('reads the switch name of every spelling', () => {
    expect(switchNameOf('--remote-debugging-port=9222', 'linux')).toBe('remote-debugging-port')
    expect(switchNameOf('-remote-debugging-port=0', 'darwin')).toBe('remote-debugging-port')
    expect(switchNameOf('--Remote-Debugging-Pipe', 'win32')).toBe('remote-debugging-pipe')
    expect(switchNameOf('/remote-debugging-port=1', 'win32')).toBe('remote-debugging-port')
    expect(switchNameOf('/remote-debugging-port=1', 'linux')).toBeNull() // a path on POSIX
    expect(switchNameOf('C:\\Users\\a.png', 'win32')).toBeNull()
    expect(switchNameOf('--', 'linux')).toBeNull()
  })
  it('refuses what Chromium parsed (app.commandLine.hasSwitch)', () => {
    for (const name of ['remote-debugging-port', 'remote-debugging-pipe']) {
      expect(forbiddenDebugSwitch(['/opt/app/let-us-drag'], (n) => n === name, 'linux')).toBe(name)
    }
  })
  it('refuses every argv form, on every OS', () => {
    const exe = '/Applications/Let us drag!.app/Contents/MacOS/Let us drag!'
    expect(forbiddenDebugSwitch([exe, '--remote-debugging-port=9222'], none, 'darwin')).toBe('remote-debugging-port')
    expect(forbiddenDebugSwitch([exe, '--remote-debugging-port', '9222'], none, 'darwin')).toBe('remote-debugging-port')
    expect(forbiddenDebugSwitch(['C:\\LetUsDrag.exe', '--REMOTE-DEBUGGING-PIPE'], none, 'win32')).toBe('remote-debugging-pipe')
    expect(forbiddenDebugSwitch(['C:\\LetUsDrag.exe', '/remote-debugging-port=0'], none, 'win32')).toBe('remote-debugging-port')
    expect(forbiddenDebugSwitch(['/app', '--inspect=9229'], none, 'linux')).toBe('inspect')
    expect(forbiddenDebugSwitch(['/app', '--js-flags=--allow-natives-syntax'], none, 'linux')).toBe('js-flags')
  })
  it('lets normal launches through', () => {
    expect(forbiddenDebugSwitch(['/app/let-us-drag'], none, 'linux')).toBeNull()
    expect(forbiddenDebugSwitch(['/app/let-us-drag', '--no-sandbox', '--user-data-dir=/tmp/x', '-psn_0_12345'], none, 'darwin')).toBeNull()
    expect(forbiddenDebugSwitch(['C:\\LetUsDrag.exe', 'C:\\remote-debugging-port.png'], none, 'win32')).toBeNull()
    expect(FORBIDDEN_DEBUG_SWITCHES).toContain('remote-debugging-port')
    expect(FORBIDDEN_DEBUG_SWITCHES).toContain('remote-debugging-pipe')
  })
})

describe('D22 / B-059: no spell-check dictionary download', () => {
  it('turns the spell checker off on the session and points the downloader nowhere', () => {
    const log: unknown[] = []
    disableSpellChecker({
      setSpellCheckerEnabled: (v: boolean) => void log.push(['enabled', v]),
      setSpellCheckerDictionaryDownloadURL: (u: string) => void log.push(['url', u])
    })
    expect(log).toEqual([
      ['enabled', false],
      ['url', NO_DICTIONARY_URL]
    ])
    expect(new URL(NO_DICTIONARY_URL).hostname).toBe('127.0.0.1')
  })
  it('every window has spellcheck off, and a caller cannot turn it on', () => {
    expect(secureWebPreferences().spellcheck).toBe(false)
    expect(secureWebPreferences({ spellcheck: true }).spellcheck).toBe(false)
  })
})

describe('B-055: dropFilesOnFeed delivers even when it had to open the Feed Window', () => {
  function target(ready: Promise<unknown>, destroyed = false): FeedDropTarget & { sent: unknown[] } {
    const sent: unknown[] = []
    return {
      sent,
      isDestroyed: () => destroyed,
      webContents: {
        executeJavaScript: () => ready,
        send: (channel: string, payload: unknown) => void sent.push([channel, payload])
      }
    }
  }
  const payload = { paths: ['/tmp/a.png'], optionId: 'to-webp' as const }

  it('waits for the page to be ready, then sends (no did-finish-load wait that can hang)', async () => {
    const t = target(Promise.resolve(undefined))
    await deliverFeedDrop(t, payload)
    expect(t.sent).toEqual([[TEST_FEED_DROP_CHANNEL, payload]])
  })
  it('a page that never reports ready still gets the drop after the bound', async () => {
    const t = target(new Promise(() => undefined))
    await deliverFeedDrop(t, payload, 20)
    expect(t.sent).toEqual([[TEST_FEED_DROP_CHANNEL, payload]])
  })
  it('a failing readiness script still sends; a destroyed window does not', async () => {
    const t = target(Promise.reject(new Error('boom')))
    await deliverFeedDrop(t, payload)
    expect(t.sent).toHaveLength(1)
    const gone = target(Promise.resolve(undefined), true)
    await deliverFeedDrop(gone, payload)
    expect(gone.sent).toEqual([])
  })
})
