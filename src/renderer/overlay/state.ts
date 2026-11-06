// The Uncle's state machine: a pure, DOM-free reducer shared by the overlay and the Feed Window.
// Side effects (IPC, timers, sounds) live in common/useUncleSession.ts and react to state changes.
// States follow docs/PLAN.md §6; 'idle' is the Feed Window's resting state (the overlay rests in 'hidden').
import { isUnlocked, type LicenceView } from '../../shared/licence'
import { isUpdateRequired, type UpdateView } from '../../shared/update'
import type { ConversionOption, DragProbe, DroppedItem, JobError, JobEvent, OptionId, Settings } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { isHamster, isStruggle, itemsAreBlocked, optionsForItems, optionsForProbe, categoryForProbe } from '../common/drag'
import { friendlyError, LINES, stageCaption } from '../common/text'

export type UncleState =
  | 'hidden'
  | 'idle'
  | 'appear'
  | 'hover'
  | 'feedMe'
  | 'eat'
  | 'chew'
  | 'spit'
  | 'choke'
  | 'refuse'
  | 'leave'
  /** The user cancelled the meal (D3): he spits the file back ("Fine, keep it.") and leaves. */
  | 'cancel'
  /**
   * Conversions are locked: no active licence (D26, "Unlock for $9.50"), or a forced update is pending
   * (D29, "Please update me"; see Model.lockReason). One big bubble instead of the options; nothing is eaten.
   */
  | 'locked'

/** Why the Uncle is locked (D26 licence, D29 forced update). The update wins: it has to happen first. */
export type LockReason = 'licence' | 'update'

export type Host = 'overlay' | 'feed'

export interface Job {
  id: string
  optionId: OptionId
  inputPaths: string[]
}

export type Outcome = { kind: 'done'; outputPaths: string[] } | { kind: 'error'; error: JobError }

/** Where the file entered the mouth from (for the "fly into mouth" animation). */
export type DropTarget = OptionId | 'mouth' | null

export interface Model {
  host: Host
  state: UncleState
  settings: Settings
  /** Options currently offered (shown in appear/hover, and in feedMe once items are held). */
  options: ConversionOption[]
  hovered: OptionId | null
  /** Items dropped on the mouth, waiting for the user to click an option (feedMe). */
  held: DroppedItem[] | null
  /** A drop was received and paths are being resolved (protects against a racing disarm). */
  dropping: boolean
  /** Number of files in the current drag (from the probe), before the drop. */
  dragCount: number
  items: DroppedItem[]
  job: Job | null
  eatenFrom: DropTarget
  /** 0..1, or -1 when unknown. */
  progress: number
  stage: string | null
  minChewDone: boolean
  outcome: Outcome | null
  outputPaths: string[]
  /** Friendly text for refuse/choke. */
  message: string | null
  hamster: boolean
  struggle: boolean
  /** Increments on every new engagement (handy as a React key / animation reset). */
  session: number
  /** Licence state from main (D26); null until it arrived (then main's own check still applies). */
  licence: LicenceView | null
  /** locked: the gesture is over (mouse released or file dropped), so the unlock bubble may take clicks/focus. */
  lockSettled: boolean
  // --- updates (D29) begin
  /** Update notice state from main; null until it arrived (main's own check still applies). */
  update: UpdateView | null
  /** Which panel the locked state shows (set on entering 'locked'). */
  lockReason: LockReason | null
  /** This session announces a soft update ("I learned new tricks!"), once per version. */
  updateHint: boolean
  // --- updates (D29) end
}

export type Action =
  | { type: 'ARM'; settings?: Settings }
  | { type: 'SETTINGS'; settings: Settings }
  | { type: 'ENGAGE'; probe: DragProbe }
  | { type: 'HOVER'; optionId: OptionId | null }
  | { type: 'DROP_START' }
  | { type: 'DROP_FAILED'; message: string }
  | { type: 'DROP_RESOLVED'; items: DroppedItem[]; target: DropTarget; jobId: string }
  | { type: 'CHOOSE'; optionId: OptionId; jobId: string }
  | { type: 'EAT_DONE' }
  | { type: 'MIN_CHEW_ELAPSED' }
  | { type: 'JOB_EVENT'; event: JobEvent }
  | { type: 'ESC' }
  /** Cancel the running job ("Spit it out" button, Esc while busy, E2E cancelActive). */
  | { type: 'CANCEL' }
  | { type: 'DISARM' }
  | { type: 'DRAG_CANCEL' }
  | { type: 'LEAVE' }
  | { type: 'LEAVE_DONE' }
  /** Licence state from main (getLicence / onLicenceChanged). */
  | { type: 'LICENCE'; view: LicenceView }
  /** Main refused to start this job: no active licence (LICENCE_REQUIRED) or a forced update (UPDATE_REQUIRED). */
  | { type: 'LOCKED'; jobId: string; reason?: LockReason }
  /** Update notice state from main (getUpdate / onUpdateChanged), D29. */
  | { type: 'UPDATE'; view: UpdateView }

export const TIMING = {
  /** File flies into the mouth + jaw snaps shut. */
  eatMs: 480,
  eatHungryMs: 200,
  /** Minimum chew so the joke lands (PLAN §6), skipped in Hungry Mode. */
  minChewMs: 700,
  /** Result (spit/choke/refuse) stays this long before leaving. */
  resultMs: 2500,
  /** The Feed Window keeps results a little longer (the user is not mid-gesture). */
  feedResultMs: 6000,
  leaveMs: 380,
  /** Spit-back after a cancel: short, then he leaves. */
  cancelMs: 1400
} as const

export function restState(host: Host): UncleState {
  return host === 'overlay' ? 'hidden' : 'idle'
}

export function initialModel(
  host: Host,
  settings: Settings = DEFAULT_SETTINGS,
  licence: LicenceView | null = null,
  update: UpdateView | null = null
): Model {
  return {
    host,
    state: restState(host),
    settings,
    options: [],
    hovered: null,
    held: null,
    dropping: false,
    dragCount: 0,
    items: [],
    job: null,
    eatenFrom: null,
    progress: 0,
    stage: null,
    minChewDone: false,
    outcome: null,
    outputPaths: [],
    message: null,
    hamster: false,
    struggle: false,
    session: 0,
    licence,
    lockSettled: false,
    update,
    lockReason: null,
    updateHint: false
  }
}

/** Reset everything except host/settings/session/licence/update. */
function rest(m: Model): Model {
  return { ...initialModel(m.host, m.settings, m.licence, m.update), session: m.session }
}

/**
 * The licence locks conversions (D26): main said the licence is not active. Unknown (not arrived yet)
 * counts as unlocked here; main refuses the job anyway and the reply locks the Uncle then.
 */
export function isLicenceLocked(m: Pick<Model, 'licence'>): boolean {
  return m.licence !== null && !isUnlocked(m.licence)
}

/** A forced update locks conversions (D29). Unknown counts as unlocked (main checks again). */
export function isUpdateLocked(m: Partial<Pick<Model, 'update'>>): boolean {
  return isUpdateRequired(m.update)
}

/** Conversions are locked: forced update (D29) or no active licence (D26). */
export function isLocked(m: Pick<Model, 'licence'> & Partial<Pick<Model, 'update'>>): boolean {
  return isUpdateLocked(m) || isLicenceLocked(m)
}

/** Why conversions are locked right now (the update first), or null. */
export function lockReasonOf(m: Pick<Model, 'licence'> & Partial<Pick<Model, 'update'>>): LockReason | null {
  if (isUpdateLocked(m)) return 'update'
  if (isLicenceLocked(m)) return 'licence'
  return null
}

/** Show the lock bubble ("Unlock for $9.50" / "Please update me"): the locked state, or the Feed Window resting while locked. */
export function showsUnlock(m: Pick<Model, 'state' | 'licence'> & Partial<Pick<Model, 'update'>>): boolean {
  return m.state === 'locked' || (m.state === 'idle' && isLocked(m))
}

/** Which lock bubble to show (D26 / D29), or null when none is shown. */
export function lockPanel(m: Pick<Model, 'state' | 'licence'> & Partial<Pick<Model, 'update' | 'lockReason'>>): LockReason | null {
  if (!showsUnlock(m)) return null
  if (m.state === 'locked') return m.lockReason ?? lockReasonOf(m) ?? 'licence'
  return lockReasonOf(m)
}

/**
 * The once-per-version "I learned new tricks!" bubble (D29): while he offers options or waits for a
 * drop, never over the held-files chip, never in a locked/busy/result state. It is informative only
 * (pointer-events: none) and never blocks a drop or a conversion.
 */
export function showsUpdateHint(m: Pick<Model, 'state' | 'held' | 'updateHint'>): boolean {
  if (!m.updateHint) return false
  return m.state === 'appear' || m.state === 'hover' || (m.state === 'feedMe' && m.held === null)
}

function lock(m: Model, settled: boolean): Model {
  return {
    ...m,
    state: 'locked',
    options: [],
    hovered: null,
    held: null,
    dropping: false,
    job: null,
    progress: 0,
    stage: null,
    outcome: null,
    outputPaths: [],
    message: null,
    lockSettled: settled,
    lockReason: lockReasonOf(m) ?? 'licence'
  }
}

export function isResting(m: Model): boolean {
  return m.state === 'hidden' || m.state === 'idle'
}

export function isBusy(m: Model): boolean {
  return m.state === 'eat' || m.state === 'chew'
}

/** Engaged and waiting for a drop/click (no drop yet). */
function isOffering(m: Model): boolean {
  return m.state === 'appear' || m.state === 'hover' || m.state === 'feedMe' || m.state === 'locked'
}

/** Options are visible (and, for feedMe, clickable). */
export function visibleOptions(m: Model): ConversionOption[] {
  if (m.state === 'appear' || m.state === 'hover') return m.options
  if (m.state === 'feedMe' && m.held) return m.options
  return []
}

/**
 * The overlay must take focus and keys: only while items are held in feedMe (D20). Result cards and
 * the cancel button work by click without focus (QA3-07), see wantsClickThrough.
 */
export function wantsInteractive(m: Model): boolean {
  // Unlock bubble (D26): only once the drag is over, so focus never interrupts the OS drag.
  if (m.state === 'locked') return m.lockSettled
  return m.state === 'feedMe' && m.held !== null
}

/**
 * D20 (QA3-06): after the drop, or once the gesture is over, the overlay lets the mouse through
 * except while the pointer is over one of its interactive elements (cancel button, result cards).
 * During the gesture (appear/hover/feedMe/refuse) it stays a normal drop target (D16).
 */
export function wantsClickThrough(m: Pick<Model, 'state'>): boolean {
  switch (m.state) {
    case 'eat':
    case 'chew':
    case 'spit':
    case 'choke':
    case 'cancel':
    case 'leave':
      return true
    default:
      return false
  }
}

/** Caption under the progress ring while chewing: the engine's stage text (D15, QA3-02). */
export function chewCaption(m: Model): string | null {
  if (m.state !== 'chew') return null
  return stageCaption(m.stage, m.progress, m.items.length)
}

/**
 * `data-uncle-mood` for QA (TPM D1): the chewing modifier as one value. Struggle wins when both apply
 * (it also decides the chew rate). Set from the drop until the session rests, like data-hamster/-struggle.
 */
export function uncleMoodAttr(m: Pick<Model, 'hamster' | 'struggle'>): 'hamster' | 'struggle' | 'none' {
  if (m.struggle) return 'struggle'
  if (m.hamster) return 'hamster'
  return 'none'
}

export function speech(m: Model): string | null {
  if (showsUnlock(m)) return null
  switch (m.state) {
    case 'feedMe':
      return m.held ? LINES.pickOne : LINES.feedMe
    case 'refuse':
      return m.message ?? LINES.refuse
    case 'cancel':
      return LINES.cancelled
    case 'idle':
      return LINES.idleFeed
    default:
      return null
  }
}

function startEat(m: Model, items: DroppedItem[], optionId: OptionId, jobId: string, from: DropTarget): Model {
  return {
    ...m,
    state: 'eat',
    items,
    held: null,
    dropping: false,
    hovered: null,
    options: [],
    job: { id: jobId, optionId, inputPaths: items.map((i) => i.path) },
    eatenFrom: from,
    progress: 0,
    stage: null,
    minChewDone: false,
    outcome: null,
    outputPaths: [],
    message: null,
    hamster: isHamster(items.length),
    struggle: isStruggle(items)
  }
}

function refuse(m: Model, message: string = LINES.refuse): Model {
  return { ...m, state: 'refuse', options: [], hovered: null, held: null, dropping: false, message }
}

function choke(m: Model, message: string): Model {
  return { ...m, state: 'choke', options: [], hovered: null, held: null, dropping: false, message }
}

/** chew + min chew elapsed + job outcome → spit/choke. */
function resolve(m: Model): Model {
  if (m.state !== 'chew' || !m.minChewDone || !m.outcome) return m
  if (m.outcome.kind === 'done') {
    return { ...m, state: 'spit', progress: 1, outputPaths: m.outcome.outputPaths }
  }
  return choke(m, friendlyError(m.outcome.error))
}

/**
 * Cancel a meal in progress: no output, he spits the file back.
 * If the job already finished (we were only waiting for the eat animation or the minimum chew), there is nothing left to
 * cancel: show the result right away instead of pretending nothing was written.
 */
function cancel(m: Model): Model {
  // Also while still eating: a fast job can finish during the eat animation (B-074).
  if (isBusy(m) && m.outcome?.kind === 'done') return resolve({ ...m, state: 'chew', minChewDone: true })
  return { ...m, state: 'cancel', options: [], hovered: null, held: null, dropping: false, progress: 0, message: null }
}

function leave(m: Model): Model {
  return { ...m, state: 'leave', options: [], hovered: null }
}

export function reducer(m: Model, a: Action): Model {
  switch (a.type) {
    case 'SETTINGS':
      return { ...m, settings: a.settings }

    case 'ARM': {
      const settings = a.settings ?? m.settings
      // Never interrupt a meal in progress; otherwise start a fresh, invisible session. A result
      // card (spit/choke), the spit-back or the leave animation is dropped at once (D21, QA3-11).
      if (isBusy(m)) return { ...m, settings }
      return { ...rest({ ...m, settings }) }
    }

    case 'ENGAGE': {
      const canEngage =
        isResting(m) ||
        m.state === 'leave' ||
        m.state === 'spit' ||
        m.state === 'choke' ||
        m.state === 'refuse' ||
        m.state === 'cancel' ||
        m.state === 'locked'
      if (!canEngage) return m
      const base: Model = { ...rest(m), session: m.session + 1, dragCount: a.probe.count, updateHint: m.update?.hint === true }
      // D26: without a licence every path leads to the unlock bubble (blocked files included).
      if (isLocked(base)) return lock(base, false)
      const cat = categoryForProbe(a.probe)
      if (cat === 'blocked') return refuse(base)
      const options = optionsForProbe(a.probe)
      if (options.length === 0) return { ...base, state: 'feedMe' }
      return { ...base, state: 'appear', options }
    }

    case 'HOVER': {
      const id = a.optionId && visibleOptions(m).some((o) => o.id === a.optionId) ? a.optionId : null
      if (m.state === 'appear' || m.state === 'hover') {
        const state: UncleState = id ? 'hover' : 'appear'
        if (state === m.state && id === m.hovered) return m
        return { ...m, state, hovered: id }
      }
      if (m.state === 'feedMe' && m.held) return id === m.hovered ? m : { ...m, hovered: id }
      return m
    }

    case 'DROP_START':
      if (isOffering(m) || isResting(m)) return { ...m, dropping: true }
      return m

    case 'DROP_FAILED':
      if (isBusy(m)) return m
      return choke({ ...m, session: isResting(m) ? m.session + 1 : m.session }, a.message)

    case 'DROP_RESOLVED': {
      if (!(isOffering(m) || isResting(m))) return m
      const engaged = isResting(m) ? { ...m, session: m.session + 1 } : m
      if (isLocked(engaged) || m.state === 'locked') return lock(engaged, true)
      if (a.items.length === 0) return choke(engaged, LINES.noPaths)
      if (itemsAreBlocked(a.items)) return refuse(engaged)
      const options = optionsForItems(a.items)
      if (options.length === 0) return choke(engaged, LINES.nothingToDo)
      if (a.target && a.target !== 'mouth' && options.some((o) => o.id === a.target)) {
        return startEat(engaged, a.items, a.target, a.jobId, a.target)
      }
      return {
        ...engaged,
        state: 'feedMe',
        held: a.items,
        items: a.items,
        options,
        hovered: null,
        dropping: false,
        dragCount: a.items.length
      }
    }

    case 'CHOOSE': {
      if (m.state !== 'feedMe' || !m.held) return m
      if (!m.options.some((o) => o.id === a.optionId)) return m
      if (isLocked(m)) return lock(m, true)
      return startEat(m, m.held, a.optionId, a.jobId, a.optionId)
    }

    case 'EAT_DONE':
      if (m.state !== 'eat') return m
      return resolve({ ...m, state: 'chew', minChewDone: m.settings.hungryMode })

    case 'MIN_CHEW_ELAPSED':
      if (m.state !== 'chew') return m
      return resolve({ ...m, minChewDone: true })

    case 'JOB_EVENT': {
      const e = a.event
      if (!m.job || e.jobId !== m.job.id || !isBusy(m)) return m
      switch (e.type) {
        case 'queued':
          return m
        case 'progress': {
          const p = Number.isFinite(e.progress) ? (e.progress < 0 ? -1 : Math.min(1, e.progress)) : -1
          return { ...m, progress: p, stage: e.stage ?? m.stage }
        }
        case 'done':
          return resolve({ ...m, outcome: { kind: 'done', outputPaths: e.outputPaths } })
        case 'error':
          // Cancelled elsewhere (e.g. main restarted a stuck worker, or a cancel hook): no cough, just spit it back.
          if (e.error.code === 'CANCELLED') return cancel(m)
          return resolve({ ...m, outcome: { kind: 'error', error: e.error } })
      }
      return m
    }

    case 'ESC':
      if (isResting(m) || m.state === 'leave') return m
      if (m.state === 'locked') return m.host === 'feed' ? rest(m) : leave(m)
      if (isBusy(m)) return cancel(m)
      return leave(m)

    case 'CANCEL':
      return isBusy(m) ? cancel(m) : m

    case 'DISARM':
    case 'DRAG_CANCEL': {
      // The unlock bubble stays after the mouse-up so it can be clicked (× / Esc close it).
      if (m.state === 'locked') {
        if (a.type === 'DRAG_CANCEL' && m.host === 'feed') return rest(m)
        return m.lockSettled ? m : { ...m, lockSettled: true }
      }
      if (m.dropping) return m
      if (m.state === 'appear' || m.state === 'hover' || m.state === 'refuse') return leave(m)
      if (m.state === 'feedMe' && !m.held) return leave(m)
      return m
    }

    case 'LEAVE':
      if (m.state === 'spit' || m.state === 'choke' || m.state === 'refuse' || m.state === 'cancel' || m.state === 'locked') return leave(m)
      return m

    case 'LEAVE_DONE':
      if (m.state !== 'leave') return m
      return rest(m)

    case 'LICENCE':
    case 'UPDATE': {
      const next: Model = a.type === 'LICENCE' ? { ...m, licence: a.view } : { ...m, update: a.view }
      if (m.state !== 'locked') return next
      // Unlocked while the lock bubble is shown (activated in Settings, or a manifest lowered the
      // minimum): he goes away happy. Otherwise show the bubble for what still locks him.
      if (!isLocked(next)) return m.host === 'feed' ? rest(next) : leave(next)
      return { ...next, lockReason: lockReasonOf(next) ?? next.lockReason }
    }

    case 'LOCKED': {
      if (!m.job || m.job.id !== a.jobId || !isBusy(m)) return m
      // The renderer asks main for the fresh licence / update state right after (useUncleSession).
      const locked = lock(m, true)
      return a.reason ? { ...locked, lockReason: a.reason } : locked
    }
  }
  return m
}
