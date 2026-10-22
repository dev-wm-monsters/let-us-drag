// Pure overlay session state + safety-timeout policy (no electron import, unit tested).
//
// Lifecycle (PLAN §3 decision 5):
//   hidden ──arm──▶ armed (sensor follows cursor) ──engaged──▶ engaged (stays put)
//   armed/engaged ──disarm (mouse released)──▶ released (renderer plays leave / shows result)
//   any ──done (renderer finished) or safety timeout──▶ hidden
//
// The safety timeout guarantees the overlay can never get stuck on screen, while never
// hiding it during a conversion the user is watching.

export type OverlayPhase = 'hidden' | 'armed' | 'engaged' | 'released'

export interface OverlaySession {
  phase: OverlayPhase
  /** Window is focusable/clickable (feedMe flow). */
  interactive: boolean
  /** Jobs started from the overlay that have not finished yet. */
  jobs: readonly string[]
  /** Follow the cursor while armed (false for E2E arm at a fixed point). */
  follow: boolean
}

export const ARMED_TIMEOUT_MS = 15_000
export const RELEASED_TIMEOUT_MS = 10_000
export const IDLE_TIMEOUT_MS = 60_000

export function initialOverlaySession(): OverlaySession {
  return { phase: 'hidden', interactive: false, jobs: [], follow: true }
}

export type OverlaySessionEvent =
  | { type: 'arm'; follow: boolean }
  | { type: 'engaged' }
  | { type: 'disarm' }
  | { type: 'interactive'; value: boolean }
  | { type: 'jobStarted'; jobId: string }
  | { type: 'jobFinished'; jobId: string }
  | { type: 'done' }

/**
 * Would a new trigger arm be ignored right now?
 * - armed: already a sensor under the cursor (double arm, key repeat).
 * - a conversion started from the overlay is running (one Uncle at a time).
 * Everything else is interruptible (TPM D21, B-056): a result/error card (spit/choke), the leave
 * animation, feedMe, or an 'engaged' session whose mouse-up we never saw (a new arm needs a new
 * press, so the previous gesture is over). The renderer dismisses what it shows on overlayArm.
 */
export function isBusy(s: OverlaySession): boolean {
  if (s.phase === 'hidden') return false
  if (s.phase === 'armed') return true
  return s.jobs.length > 0
}

/**
 * TPM D20 (B-051/B-052): may the overlay ignore the mouse (`setIgnoreMouseEvents(true, {forward})`)
 * now, when its renderer asks for it?
 * - Never while hidden or while the sensor is armed: during the gesture it must be a normal drop
 *   target (D16); a late request from the previous card must not turn the new sensor off.
 * - Never on Linux: `forward` (mouse moves still reach the page while ignoring clicks) exists only
 *   on macOS and Windows, so the renderer could not see the pointer enter a button to turn
 *   click-through off again. Linux keeps the overlay clickable (as in v0.1 before D20).
 */
export function clickThroughAllowed(s: OverlaySession, platform: NodeJS.Platform): boolean {
  if (platform !== 'darwin' && platform !== 'win32') return false
  return s.phase !== 'hidden' && s.phase !== 'armed'
}

export function overlaySessionReducer(s: OverlaySession, e: OverlaySessionEvent): OverlaySession {
  switch (e.type) {
    case 'arm':
      if (isBusy(s)) return s
      return { phase: 'armed', interactive: false, jobs: [], follow: e.follow }
    case 'engaged':
      return s.phase === 'armed' ? { ...s, phase: 'engaged' } : s
    case 'disarm':
      return s.phase === 'armed' || s.phase === 'engaged' ? { ...s, phase: 'released' } : s
    case 'interactive':
      return s.phase === 'hidden' ? s : { ...s, interactive: e.value }
    case 'jobStarted':
      if (s.phase === 'hidden' || s.jobs.includes(e.jobId)) return s
      // A drop implies engagement even if the renderer did not report it.
      return { ...s, phase: s.phase === 'armed' ? 'engaged' : s.phase, jobs: [...s.jobs, e.jobId] }
    case 'jobFinished':
      return s.jobs.includes(e.jobId) ? { ...s, jobs: s.jobs.filter((j) => j !== e.jobId) } : s
    case 'done':
      return initialOverlaySession()
  }
}

/** Should main forward the overlayDisarm message for this transition? */
export function shouldSendDisarm(prev: OverlaySession, next: OverlaySession): boolean {
  return prev.phase !== 'released' && next.phase === 'released'
}

export type SafetyAction = { ms: number; action: 'disarm' | 'hide' } | null

/**
 * Safety timer to (re)start after every event. Activity resets it.
 * - armed but never engaged (e.g. the mouse-up was missed): disarm after 15 s
 * - a conversion from the overlay is running: no timeout (the user is watching it)
 * - interactive (feedMe, waiting for a click) or engaged: hide after 60 s of inactivity
 * - released: hide after 10 s if the renderer never calls overlayDone
 */
export function safetyTimeout(s: OverlaySession): SafetyAction {
  if (s.phase === 'hidden') return null
  if (s.jobs.length > 0) return null
  if (s.phase === 'armed') return { ms: ARMED_TIMEOUT_MS, action: 'disarm' }
  if (s.interactive || s.phase === 'engaged') return { ms: IDLE_TIMEOUT_MS, action: 'hide' }
  return { ms: RELEASED_TIMEOUT_MS, action: 'hide' }
}
