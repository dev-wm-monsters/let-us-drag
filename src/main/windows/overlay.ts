// The overlay window: transparent, always-on-top, non-focusable sensor + stage for the Uncle.
// Created once at startup (hidden, page preloaded) so it appears instantly.

import { screen, type BrowserWindow } from 'electron'
import { IPC, type OverlayArmInfo } from '../../shared/api'
import { TEST_DROP_CHANNEL, type TestDropPayload } from '../../shared/test-hooks'
import type { Settings } from '../../shared/types'
import { DEBUG_RENDERER_ARG } from '../../shared/debug'
import { defaultOverlayOverrides, type OverlayOverrides } from '../debug-overrides'
import { createAppWindow, loadPage, type WindowContext } from './common'
import { OVERLAY_SIZE, overlayBounds, samePoint, sameRect, toWindowPoint, type Point, type Rect } from './overlay-geometry'
import {
  clickThroughAllowed,
  initialOverlaySession,
  overlaySessionReducer,
  safetyTimeout,
  shouldSendDisarm,
  type OverlaySession,
  type OverlaySessionEvent
} from './overlay-session'

/** ~60 Hz cursor polling while the overlay is visible. */
export const CURSOR_POLL_MS = 16

export interface OverlayDeps {
  ctx: WindowContext
  getSettings(): Settings
  isQuitting(): boolean
  log?: (message: string) => void
  /** Defaults to process.platform (injectable for tests). */
  platform?: NodeJS.Platform
  /** Field diagnostics variants (debug-overrides.ts); defaults = today's behaviour. */
  overrides?: OverlayOverrides
  /** Field diagnostics log (LUD_DEBUG=1 / debug.flag only); also turns on the renderer drag report. */
  debug?: (message: string) => void
}

/** Follow moves are logged at most this often (with a count), not at 60 Hz. */
const FOLLOW_LOG_MS = 250

export class OverlayController {
  readonly win: BrowserWindow
  private session: OverlaySession = initialOverlaySession()
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private safetyTimer: ReturnType<typeof setTimeout> | null = null
  private lastCursor: Point | null = null
  private ignoringMouse = false
  /** Last value given to setFocusable (cached like ignoringMouse; see setFocusableCached). */
  private focusableNow: boolean
  private loaded: Promise<void>
  private readonly platform: NodeJS.Platform
  private readonly ov: OverlayOverrides
  private readonly dbg: ((message: string) => void) | null
  private followMoves = 0
  private lastFollowLog = 0

  constructor(private readonly deps: OverlayDeps) {
    this.platform = deps.platform ?? process.platform
    this.ov = deps.overrides ?? defaultOverlayOverrides(process.platform)
    this.dbg = deps.debug ?? null
    const isMac = this.platform === 'darwin'
    this.focusableNow = this.ov.focusable
    const panel = isMac && this.ov.panel
    this.win = createAppWindow(
      deps.ctx,
      'overlay',
      {
        width: OVERLAY_SIZE,
        height: OVERLAY_SIZE,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        closable: true,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: this.ov.focusable,
        // LUD_OVERLAY_PANEL (macOS): NSWindowStyleMaskNonactivatingPanel, floats over full-screen apps.
        ...(panel ? { type: 'panel' } : {}),
        title: 'Let us drag!',
        // acceptFirstMouse (macOS): the overlay is never key (focusable: false outside feedMe), so
        // without it the first click on the cancel button / a result card would only try to
        // activate the window instead of reaching the page (D19, D20: clickable without focus).
        ...(isMac ? { hiddenInMissionControl: true, roundedCorners: false, acceptFirstMouse: true } : {})
      },
      // Keep the hidden, preloaded page responsive so it can appear instantly.
      { backgroundThrottling: false },
      this.dbg ? [DEBUG_RENDERER_ARG] : []
    )
    this.win.setAlwaysOnTop(true, this.ov.level)
    // On macOS the app is a UI element (Dock hidden / LSUIElement) → no process-type transform needed.
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    this.debug(
      () =>
        `overlay created: level=${this.ov.level} sensorFollow=${this.ov.sensorFollow} focusable=${this.ov.focusable} ` +
        `panel=${panel} transparent=true frame=false acceptFirstMouse=${isMac} hiddenInMissionControl=${isMac} ` +
        `visibleOnAllWorkspaces=true(visibleOnFullScreen) isAlwaysOnTop=${this.win.isAlwaysOnTop()}`
    )
    this.win.on('close', (event) => {
      if (!this.deps.isQuitting()) {
        event.preventDefault()
        this.hideNow()
      }
    })
    this.win.webContents.on('render-process-gone', () => {
      if (this.win.isDestroyed()) return
      this.hideNow()
      this.loaded = this.load()
    })
    this.loaded = this.load()
  }

  private load(): Promise<void> {
    return loadPage(this.win, 'overlay', this.deps.ctx.layout).catch((err: unknown) => {
      this.deps.log?.(`overlay page failed to load: ${String(err)}`)
    })
  }

  whenLoaded(): Promise<void> {
    return this.loaded
  }

  get webContentsId(): number {
    return this.win.webContents.id
  }

  get phase(): OverlaySession['phase'] {
    return this.session.phase
  }

  isVisible(): boolean {
    return !this.win.isDestroyed() && this.win.isVisible()
  }

  /** Trigger armed: place the (still transparent) sensor under the cursor and show it. */
  arm(at?: Point): void {
    if (this.win.isDestroyed()) return
    // LUD_SENSOR_FOLLOW=0: place once at arm, never move until engaged.
    const follow = at === undefined && this.ov.sensorFollow
    const prev = this.session
    const next = overlaySessionReducer(prev, { type: 'arm', follow })
    if (next === prev) {
      this.debug(() => `arm ignored (busy: phase=${prev.phase} jobs=${prev.jobs.length})`)
      return // busy: ignore
    }
    this.session = next
    // macOS: a non-opaque window that was never explicitly told to accept the mouse decides per
    // pixel, so drags fall through our near-transparent sensor to the app below. Always make the
    // native call here (bypassing the cache) so the sensor is a real drop target.
    if (this.platform === 'darwin') {
      this.ignoringMouse = false
      this.win.setIgnoreMouseEvents(false)
      this.debug(() => 'setIgnoreMouseEvents(false) [forced at arm, macOS]')
    }
    const cursor = at ?? screen.getCursorScreenPoint()
    const bounds = this.boundsFor(cursor)
    this.win.setBounds(bounds)
    this.debug(() => `arm: setBounds ${this.describeBounds(bounds)} follow=${follow} (from phase=${prev.phase})`)
    this.setFocusableCached(this.ov.focusable)
    // D20/D16: the sensor (and a new gesture over a card that was click-through, D21) is a normal
    // drop target.
    this.setIgnoreMouse(false)
    this.win.showInactive()
    // Re-assert the level after showing (some window managers reset it).
    this.win.setAlwaysOnTop(true, this.ov.level)
    this.debug(
      () =>
        `arm: showInactive visible=${this.win.isVisible()} level=${this.ov.level} isAlwaysOnTop=${this.win.isAlwaysOnTop()} ` +
        `focusable=${this.win.isFocusable()} focused=${this.win.isFocused()} ignoreMouse=${this.ignoringMouse} actual=${this.describeBounds(this.win.getBounds())}`
    )
    const info: OverlayArmInfo = { cursor: toWindowPoint(cursor, bounds), settings: this.deps.getSettings() }
    this.send(IPC.overlayArm, info)
    this.lastCursor = null
    this.startPolling()
    this.resetSafetyTimer()
  }

  /** Mouse released (trigger disarmed). */
  disarm(): void {
    this.debug(() => `disarm (phase=${this.session.phase})`)
    this.apply({ type: 'disarm' })
  }

  /** Renderer saw a Files dragenter: stop following the cursor. */
  engaged(): void {
    this.debug(() => `overlayEngaged received (phase=${this.session.phase})`)
    this.apply({ type: 'engaged' })
  }

  /**
   * feedMe only (D20): the renderer asks for keyboard focus + clicks while it offers the options.
   * This is the only place the overlay ever takes focus.
   */
  setInteractive(interactive: boolean): void {
    if (this.session.phase === 'hidden') return
    this.apply({ type: 'interactive', value: interactive })
    if (this.win.isDestroyed()) return
    this.debug(() => `setInteractive(${interactive}) phase=${this.session.phase}`)
    if (interactive) this.setIgnoreMouse(false)
    // Windows: setFocusable(false) on a visible window also "deactivates" it, i.e. Chromium hands
    // the foreground to whatever visible window is next in Z-order (possibly the taskbar or a cloaked
    // window, not the app the user came from). The overlay is already the active window here, so
    // it simply stays activatable until it hides (hideNow), where Windows picks the next window.
    if (interactive || this.platform !== 'win32') this.setFocusableCached(interactive || this.ov.focusable)
    if (interactive) this.win.focus()
  }

  /**
   * D20 (B-051): the renderer makes the overlay click-through after the drop, and clickable again
   * while the pointer is over an interactive element (mouse moves are forwarded so it can tell).
   * Ignored while hidden/armed and on Linux (see clickThroughAllowed). Never changes focus.
   */
  setClickThrough(clickThrough: boolean): void {
    if (this.win.isDestroyed()) return
    this.setIgnoreMouse(clickThrough && clickThroughAllowed(this.session, this.platform))
  }

  /** Current D20 state (true = clicks pass through to the windows below). */
  get clickThrough(): boolean {
    return this.ignoringMouse
  }

  jobStarted(jobId: string): void {
    this.apply({ type: 'jobStarted', jobId })
  }

  jobFinished(jobId: string): void {
    this.apply({ type: 'jobFinished', jobId })
  }

  /**
   * Renderer finished its leave animation. Ignored while a NEW gesture is armed: an overlayDone
   * still in flight from the previous card (D21 re-arm) must not hide the fresh sensor.
   * A legitimate done never arrives in 'armed' (mouse-up moves the session to 'released' first).
   */
  done(): void {
    this.debug(() => `overlayDone received (phase=${this.session.phase}${this.session.phase === 'armed' ? ', ignored' : ''})`)
    if (this.session.phase === 'armed') return
    this.hideNow()
  }

  /**
   * Hide right away whatever the state (screen locked, system suspending: SEC-36). A running job
   * keeps running; its result still reaches the Feed Window and the job events.
   */
  forceHide(): void {
    if (this.session.phase === 'hidden' && !this.isVisible()) return
    this.debug(() => `forceHide (phase=${this.session.phase})`)
    if (this.session.phase === 'armed' || this.session.phase === 'engaged') this.send(IPC.overlayDisarm)
    this.hideNow()
  }

  /** Forward any message to the overlay renderer. */
  send(channel: string, payload?: unknown): void {
    if (this.win.isDestroyed()) return
    this.win.webContents.send(channel, payload)
  }

  /** E2E only: deliver a simulated drop (callers must check LUD_E2E). */
  sendTestDrop(payload: TestDropPayload): void {
    this.apply({ type: 'engaged' })
    this.send(TEST_DROP_CHANNEL, payload)
  }

  /** Bounds of the overlay centred on a screen point (clamped to that display's work area). */
  boundsFor(p: Point): Rect {
    const display = screen.getDisplayNearestPoint(p)
    return overlayBounds(p, display.workArea)
  }

  dispose(): void {
    this.stopPolling()
    this.clearSafetyTimer()
  }

  private apply(event: OverlaySessionEvent): void {
    const prev = this.session
    const next = overlaySessionReducer(prev, event)
    if (next === prev) return
    this.session = next
    this.debug(() => `session ${prev.phase} -> ${next.phase} (${event.type}) jobs=${next.jobs.length} interactive=${next.interactive}`)
    if (shouldSendDisarm(prev, next)) this.send(IPC.overlayDisarm)
    if (next.phase === 'hidden') this.hideNow()
    else this.resetSafetyTimer()
  }

  private hideNow(): void {
    this.session = initialOverlaySession()
    this.stopPolling()
    this.clearSafetyTimer()
    this.lastCursor = null
    if (this.win.isDestroyed()) return
    if (this.platform === 'win32') {
      // Hide first: on a hidden window setFocusable(false) does not deactivate (see setFocusableCached).
      this.setIgnoreMouse(false)
      this.win.hide()
      this.setFocusableCached(this.ov.focusable)
    } else {
      this.setFocusableCached(this.ov.focusable)
      this.setIgnoreMouse(false)
      this.win.hide()
    }
    this.debug(() => 'hide')
  }

  /**
   * The only caller of setIgnoreMouseEvents (so the cached state cannot drift). `forward` is
   * honoured on macOS/Windows only. No native call when nothing changes (on Linux: never).
   */
  private setIgnoreMouse(ignore: boolean): void {
    if (this.win.isDestroyed() || ignore === this.ignoringMouse) return
    this.ignoringMouse = ignore
    this.debug(() => `setIgnoreMouseEvents(${ignore}${ignore ? ', forward' : ''})`)
    if (ignore) this.win.setIgnoreMouseEvents(true, { forward: true })
    else this.win.setIgnoreMouseEvents(false)
  }

  /**
   * The only caller of setFocusable; on Windows no native call when nothing changes. There (Electron 45
   * NativeWindowViews::SetFocusable) every call also toggles the taskbar button (SetSkipTaskbar(!focusable))
   * and setFocusable(false) on a VISIBLE window calls Focus(false) -> Chromium's
   * HWNDMessageHandler::Deactivate, which SetForegroundWindow()s the next visible window in Z-order.
   * Repeating setFocusable(false) at every hide / D21 re-arm therefore moved the user's keyboard focus
   * to an unrelated window (B-073), and setFocusable(true) in feedMe put the overlay on the taskbar.
   */
  private setFocusableCached(focusable: boolean): void {
    if (this.win.isDestroyed()) return
    if (this.platform !== 'win32') {
      // macOS/Linux: unchanged behaviour (the call has no side effects there).
      this.focusableNow = focusable
      this.win.setFocusable(focusable)
      return
    }
    if (focusable === this.focusableNow) return
    this.focusableNow = focusable
    this.win.setFocusable(focusable)
    // The overlay never belongs on the taskbar (skipTaskbar: true), focusable or not.
    this.win.setSkipTaskbar(true)
  }

  private startPolling(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => this.tick(), CURSOR_POLL_MS)
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private tick(): void {
    if (this.win.isDestroyed() || !this.win.isVisible()) {
      this.stopPolling()
      return
    }
    const p = screen.getCursorScreenPoint()
    let bounds = this.win.getBounds()
    if (this.session.phase === 'armed' && this.session.follow) {
      const next = this.boundsFor(p)
      if (!sameRect(next, bounds)) {
        this.win.setBounds(next)
        bounds = next
        if (this.dbg) this.logFollow(next)
      }
    }
    const local = toWindowPoint(p, bounds)
    if (!samePoint(this.lastCursor, local)) {
      this.lastCursor = local
      this.send(IPC.cursor, local)
    }
  }

  /** Field diagnostics only; `message` is built only when diagnostics are on. */
  private debug(message: () => string): void {
    if (this.dbg) this.dbg(`overlay: ${message()}`)
  }

  private describeBounds(b: Rect): string {
    const display = screen.getDisplayMatching(b)
    return `{x:${b.x},y:${b.y},w:${b.width},h:${b.height}} display=${display.id} scale=${display.scaleFactor}`
  }

  private logFollow(bounds: Rect): void {
    this.followMoves++
    const now = Date.now()
    if (now - this.lastFollowLog < FOLLOW_LOG_MS) return
    this.lastFollowLog = now
    this.debug(() => `follow: setBounds ${this.describeBounds(bounds)} (${this.followMoves} moves)`)
    this.followMoves = 0
  }

  private clearSafetyTimer(): void {
    if (this.safetyTimer) clearTimeout(this.safetyTimer)
    this.safetyTimer = null
  }

  private resetSafetyTimer(): void {
    this.clearSafetyTimer()
    const t = safetyTimeout(this.session)
    if (!t) return
    this.safetyTimer = setTimeout(() => {
      this.safetyTimer = null
      this.debug(() => `safety timeout: ${t.action} after ${t.ms} ms (phase=${this.session.phase})`)
      if (t.action === 'disarm') this.apply({ type: 'disarm' })
      else this.hideNow()
    }, t.ms)
  }
}
