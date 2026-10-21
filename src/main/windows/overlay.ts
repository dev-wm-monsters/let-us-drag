// The overlay window: transparent, always-on-top, non-focusable sensor + stage for the Uncle.
// Created once at startup (hidden, page preloaded) so it appears instantly.

import { screen, type BrowserWindow } from 'electron'
import { IPC, type OverlayArmInfo } from '../../shared/api'
import { TEST_DROP_CHANNEL, type TestDropPayload } from '../../shared/test-hooks'
import type { Settings } from '../../shared/types'
import { createAppWindow, loadPage, type WindowContext } from './common'
import { OVERLAY_SIZE, overlayBounds, samePoint, sameRect, toWindowPoint, type Point, type Rect } from './overlay-geometry'
import {
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
}

export class OverlayController {
  readonly win: BrowserWindow
  private session: OverlaySession = initialOverlaySession()
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private safetyTimer: ReturnType<typeof setTimeout> | null = null
  private lastCursor: Point | null = null
  private loaded: Promise<void>

  constructor(private readonly deps: OverlayDeps) {
    const isMac = process.platform === 'darwin'
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
        focusable: false,
        title: 'Let us drag!',
        ...(isMac ? { hiddenInMissionControl: true, roundedCorners: false } : {})
      },
      // Keep the hidden, preloaded page responsive so it can appear instantly.
      { backgroundThrottling: false }
    )
    this.win.setAlwaysOnTop(true, 'screen-saver')
    // On macOS the app is a UI element (Dock hidden / LSUIElement) → no process-type transform needed.
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
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
    const follow = at === undefined
    const prev = this.session
    const next = overlaySessionReducer(prev, { type: 'arm', follow })
    if (next === prev) return // busy: ignore
    this.session = next
    const cursor = at ?? screen.getCursorScreenPoint()
    const bounds = this.boundsFor(cursor)
    this.win.setBounds(bounds)
    this.win.setFocusable(false)
    this.win.showInactive()
    // Re-assert the level after showing (some window managers reset it).
    this.win.setAlwaysOnTop(true, 'screen-saver')
    const info: OverlayArmInfo = { cursor: toWindowPoint(cursor, bounds), settings: this.deps.getSettings() }
    this.send(IPC.overlayArm, info)
    this.lastCursor = null
    this.startPolling()
    this.resetSafetyTimer()
  }

  /** Mouse released (trigger disarmed). */
  disarm(): void {
    this.apply({ type: 'disarm' })
  }

  /** Renderer saw a Files dragenter: stop following the cursor. */
  engaged(): void {
    this.apply({ type: 'engaged' })
  }

  setInteractive(interactive: boolean): void {
    if (this.session.phase === 'hidden') return
    this.apply({ type: 'interactive', value: interactive })
    this.win.setFocusable(interactive)
    if (interactive) this.win.focus()
  }

  jobStarted(jobId: string): void {
    this.apply({ type: 'jobStarted', jobId })
  }

  jobFinished(jobId: string): void {
    this.apply({ type: 'jobFinished', jobId })
  }

  /** Renderer finished its leave animation. */
  done(): void {
    this.hideNow()
  }

  /**
   * Hide right away whatever the state (screen locked, system suspending: SEC-36). A running job
   * keeps running; its result still reaches the Feed Window and the job events.
   */
  forceHide(): void {
    if (this.session.phase === 'hidden' && !this.isVisible()) return
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
    this.win.setFocusable(false)
    this.win.hide()
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
      }
    }
    const local = toWindowPoint(p, bounds)
    if (!samePoint(this.lastCursor, local)) {
      this.lastCursor = local
      this.send(IPC.cursor, local)
    }
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
      if (t.action === 'disarm') this.apply({ type: 'disarm' })
      else this.hideNow()
    }, t.ms)
  }
}
