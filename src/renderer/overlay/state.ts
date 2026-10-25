// The Uncle's state machine: a pure, DOM-free reducer shared by the overlay and the Feed Window.
// Side effects (IPC, timers, sounds) live in common/useUncleSession.ts and react to state changes.
// States follow docs/PLAN.md §6; 'idle' is the Feed Window's resting state (the overlay rests in 'hidden').
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

export function initialModel(host: Host, settings: Settings = DEFAULT_SETTINGS): Model {
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
    session: 0
  }
}

/** Reset everything except host/settings/session. */
function rest(m: Model): Model {
  return { ...initialModel(m.host, m.settings), session: m.session }
}

export function isResting(m: Model): boolean {
  return m.state === 'hidden' || m.state === 'idle'
}

export function isBusy(m: Model): boolean {
  return m.state === 'eat' || m.state === 'chew'
}

/** Engaged and waiting for a drop/click (no drop yet). */
function isOffering(m: Model): boolean {
  return m.state === 'appear' || m.state === 'hover' || m.state === 'feedMe'
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
        isResting(m) || m.state === 'leave' || m.state === 'spit' || m.state === 'choke' || m.state === 'refuse' || m.state === 'cancel'
      if (!canEngage) return m
      const base: Model = { ...rest(m), session: m.session + 1, dragCount: a.probe.count }
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
      if (isBusy(m)) return cancel(m)
      return leave(m)

    case 'CANCEL':
      return isBusy(m) ? cancel(m) : m

    case 'DISARM':
    case 'DRAG_CANCEL': {
      if (m.dropping) return m
      if (m.state === 'appear' || m.state === 'hover' || m.state === 'refuse') return leave(m)
      if (m.state === 'feedMe' && !m.held) return leave(m)
      return m
    }

    case 'LEAVE':
      if (m.state === 'spit' || m.state === 'choke' || m.state === 'refuse' || m.state === 'cancel') return leave(m)
      return m

    case 'LEAVE_DONE':
      if (m.state !== 'leave') return m
      return rest(m)
  }
  return m
}
