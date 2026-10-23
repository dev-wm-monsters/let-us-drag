// Side-effect layer around the pure reducer (overlay/state.ts): HTML5 drag & drop, IPC, timers,
// sounds and look-target tracking. Shared by the overlay and the Feed Window.
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { OptionId, Settings } from '../../shared/types'
import type { TestDropPayload } from '../../shared/test-hooks'
import {
  type Action,
  type DropTarget,
  type Host,
  initialModel,
  isBusy,
  isResting,
  type Model,
  reducer,
  TIMING,
  visibleOptions,
  wantsClickThrough,
  wantsInteractive
} from '../overlay/state'
import { isFileDrag, probeFromItems } from './drag'
import { hitTest, type Point, ringLayout } from './geometry'
import { call, callStrict, newJobId, pathsForFiles, subscribe } from './lud'
import { createSoundPlayer, type SoundPlayer } from './sounds'
import { LINES } from './text'

/** How long a release may precede the drop event (macOS delivers the drop after the mouse-up). */
const DISARM_DROP_GRACE_MS = 400

export interface RingGeometry {
  radius: number
  hitRadius: number
  mouthRadius: number
  /**
   * Uniform scale of the whole stage drawing (Uncle, ring, cards) around the stage centre. 1 except
   * in a Feed Window too small for the ring (B-064): the geometry above stays in unscaled px.
   */
  scale: number
}

export const DEFAULT_RING: RingGeometry = { radius: 190, hitRadius: 46, mouthRadius: 100, scale: 1 }

/** Attribute on elements that must receive clicks while the overlay is otherwise click-through (D20). */
export const INTERACTIVE_ATTR = 'data-lud-interactive'

export function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia(query)
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

export interface UncleSession {
  model: Model
  dispatch: (a: Action) => void
  /** Look target in client coordinates (read by the Uncle every frame). */
  lookRef: React.RefObject<Point | null>
  /** Where the current file was dropped (client coords), for the "fly into mouth" animation. */
  dropPointRef: React.RefObject<Point | null>
  stageRef: React.RefObject<HTMLDivElement | null>
  sounds: SoundPlayer
  choose(id: OptionId): void
  hoverOption(id: OptionId | null): void
  reveal(path: string): void
  /**
   * The pointer entered/left an interactive element (cancel button, result card; mark them with
   * INTERACTIVE_ATTR too). Keeps a hovered card on screen and, in the overlay, turns click-through
   * off while the pointer is over it (D20).
   */
  setOverInteractive(on: boolean): void
  /** Feed Window "choose file" button: same path as a drop on the mouth. */
  feedFiles(files: File[]): void
  /** Cancel the running job ("Spit it out" button, Esc while busy, E2E cancelActive). */
  cancelJob(): void
}

export function useUncleSession(host: Host, ring: RingGeometry): UncleSession {
  const [model, rawDispatch] = useReducer(reducer, host, (h: Host) => initialModel(h))
  const modelRef = useRef(model)
  modelRef.current = model
  const ringRef = useRef(ring)
  ringRef.current = ring

  const lookRef = useRef<Point | null>(null)
  // D20: is the pointer over an interactive element (cancel button, result card)?
  const [overInteractive, setOverInteractiveState] = useState(false)
  const overInteractiveRef = useRef(false)
  const cardHovered = useRef(false)
  const setOverInteractive = useCallback((on: boolean) => {
    cardHovered.current = on
    if (overInteractiveRef.current === on) return
    overInteractiveRef.current = on
    setOverInteractiveState(on)
  }, [])
  // Last click-through value sent to main (main resets it to false on arm and when it hides).
  const sentClickThrough = useRef(false)
  const cursorRef = useRef<Point | null>(null)
  const dropPointRef = useRef<Point | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const stageCenter = useRef<Point>({ x: 0, y: 0 })
  const initialSounds = useRef(model.settings.sounds)
  const sounds = useMemo(() => createSoundPlayer({ enabled: initialSounds.current }), [])
  sounds.setEnabled(model.settings.sounds)

  // Keep modelRef in sync immediately on dispatch so native handlers see fresh state.
  const dispatch = useCallback((a: Action) => {
    modelRef.current = reducer(modelRef.current, a)
    rawDispatch(a)
  }, [])

  // ——— geometry ———
  const measure = useCallback(() => {
    const el = stageRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    stageCenter.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, [])
  useLayoutEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  const optionCenter = useCallback((id: OptionId): Point | null => {
    const opts = visibleOptions(modelRef.current)
    const i = opts.findIndex((o) => o.id === id)
    if (i < 0) return null
    const slot = ringLayout(opts.length, ringRef.current.radius)[i]
    if (!slot) return null
    const k = ringRef.current.scale
    return { x: stageCenter.current.x + slot.x * k, y: stageCenter.current.y + slot.y * k }
  }, [])

  const updateLook = useCallback(() => {
    const m = modelRef.current
    const hovered = m.hovered ? optionCenter(m.hovered) : null
    lookRef.current = hovered ?? cursorRef.current
  }, [optionCenter])

  const targetAt = useCallback((p: Point): DropTarget => {
    const m = modelRef.current
    const opts = visibleOptions(m)
    const slots = ringLayout(opts.length, ringRef.current.radius)
    const hoveredIndex = m.hovered ? opts.findIndex((o) => o.id === m.hovered) : -1
    const k = ringRef.current.scale
    const hit = hitTest({
      p: { x: (p.x - stageCenter.current.x) / k, y: (p.y - stageCenter.current.y) / k },
      slots,
      hitRadius: ringRef.current.hitRadius,
      hoveredIndex: hoveredIndex >= 0 ? hoveredIndex : null,
      hysteresis: 12,
      mouthRadius: ringRef.current.mouthRadius
    })
    if (hit.kind === 'option') return opts[hit.index]?.id ?? null
    if (hit.kind === 'mouth') return 'mouth'
    return null
  }, [])

  // ——— drop processing (real drops, Feed Window picker and E2E test drops share this) ———
  const resolveDrop = useCallback(
    async (paths: string[], target: DropTarget) => {
      if (paths.length === 0) {
        dispatch({ type: 'DROP_FAILED', message: LINES.noPaths })
        return
      }
      try {
        const items = await callStrict('describePaths', paths)
        dispatch({ type: 'DROP_RESOLVED', items: Array.isArray(items) ? items : [], target, jobId: newJobId() })
      } catch {
        dispatch({ type: 'DROP_FAILED', message: LINES.noPaths })
      }
    },
    [dispatch]
  )

  const engage = useCallback(
    (probe: { mimeTypes: string[]; count: number }) => {
      const before = modelRef.current
      dispatch({ type: 'ENGAGE', probe })
      if (host === 'overlay' && modelRef.current.session !== before.session) void call('overlayEngaged', undefined)
    },
    [dispatch, host]
  )

  const feedFiles = useCallback(
    (files: File[]) => {
      if (isBusy(modelRef.current) || files.length === 0) return
      const paths = pathsForFiles(files)
      engage({ mimeTypes: files.map((f) => f.type), count: files.length })
      dispatch({ type: 'DROP_START' })
      dropPointRef.current = { ...stageCenter.current }
      void resolveDrop(paths, 'mouth')
    },
    [dispatch, engage, resolveDrop]
  )

  // ——— cancel ("Spit it out" button, Esc while busy, E2E cancelActive: one code path) ———
  // startJob is validated asynchronously in main, so a cancel sent right after it could reach main
  // before the job is registered and be lost. We therefore send cancelJob only after the startJob
  // invoke has settled (IPC replies arrive after main registered the job).
  const jobStarts = useRef(new Map<string, Promise<unknown>>())
  const cancelJob = useCallback(() => {
    const m = modelRef.current
    if (!isBusy(m) || !m.job) return
    const id = m.job.id
    dispatch({ type: 'CANCEL' })
    // The job may already have finished (min-chew wait): then the reducer shows the result instead.
    if (modelRef.current.state !== 'cancel') return
    const started = jobStarts.current.get(id) ?? Promise.resolve()
    void started.catch(() => undefined).then(() => call('cancelJob', undefined, id))
  }, [dispatch])

  // ——— HTML5 drag & drop (window-level: the whole overlay window is the sensor) ———
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      const dt = e.dataTransfer
      if (!dt || !isFileDrag(dt.types)) return
      e.preventDefault()
      dt.dropEffect = 'copy'
      measure()
      cursorRef.current = { x: e.clientX, y: e.clientY }
      engage(probeFromItems(dt.items))
      updateLook()
    }
    const onDragOver = (e: DragEvent) => {
      const dt = e.dataTransfer
      if (!dt || !isFileDrag(dt.types)) return
      e.preventDefault()
      dt.dropEffect = isBusy(modelRef.current) ? 'none' : 'copy'
      if (isResting(modelRef.current)) engage(probeFromItems(dt.items))
      const p = { x: e.clientX, y: e.clientY }
      cursorRef.current = p
      const t = targetAt(p)
      const id = t && t !== 'mouth' ? t : null
      if (id !== modelRef.current.hovered) dispatch({ type: 'HOVER', optionId: id })
      updateLook()
    }
    const onDrop = (e: DragEvent) => {
      const dt = e.dataTransfer
      if (!dt || !isFileDrag(dt.types)) return
      e.preventDefault()
      if (isBusy(modelRef.current)) return
      const p = { x: e.clientX, y: e.clientY }
      const target = targetAt(p)
      const files = Array.from(dt.files)
      const paths = pathsForFiles(files)
      if (isResting(modelRef.current)) engage(probeFromItems(dt.items))
      dropPointRef.current = target && target !== 'mouth' ? (optionCenter(target) ?? p) : p
      dispatch({ type: 'DROP_START' })
      void resolveDrop(paths, target)
    }
    const onDragLeave = (e: DragEvent) => {
      // Only when the drag leaves the window entirely (relatedTarget is null outside the document).
      if (e.relatedTarget) return
      const inside = e.clientX > 0 && e.clientY > 0 && e.clientX < window.innerWidth && e.clientY < window.innerHeight
      if (inside) return
      if (host === 'feed') dispatch({ type: 'DRAG_CANCEL' })
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragleave', onDragLeave)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragleave', onDragLeave)
    }
  }, [dispatch, engage, host, measure, optionCenter, resolveDrop, targetAt, updateLook])

  // Mouse tracking when the window receives pointer events (Feed Window, interactive overlay).
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      cursorRef.current = { x: e.clientX, y: e.clientY }
      updateLook()
    }
    const onLeave = () => {
      if (host === 'feed') {
        cursorRef.current = null
        updateLook()
      }
    }
    window.addEventListener('mousemove', onMove)
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
    }
  }, [host, updateLook])

  // Esc dismisses the Uncle, or cancels a running job (he spits the file back).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (isBusy(modelRef.current)) cancelJob()
      else dispatch({ type: 'ESC' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancelJob, dispatch])

  // ——— main → renderer channels ———
  useEffect(() => {
    let alive = true
    // E2E simulated drop: same path as a real drop once the paths are known.
    const testDrop = (p: TestDropPayload) => {
      if (!p || !Array.isArray(p.paths) || isBusy(modelRef.current)) return
      measure()
      if (isResting(modelRef.current)) engage({ mimeTypes: [], count: p.paths.length })
      dispatch({ type: 'DROP_START' })
      dropPointRef.current = (p.optionId ? optionCenter(p.optionId) : null) ?? { ...stageCenter.current }
      void resolveDrop(p.paths, p.optionId ?? 'mouth')
    }
    void call('getSettings', null as unknown as Settings).then((s) => {
      if (alive && s) dispatch({ type: 'SETTINGS', settings: s })
    })
    const offs = [
      subscribe('onSettingsChanged', (s) => dispatch({ type: 'SETTINGS', settings: s })),
      subscribe('onJobEvent', (ev) => dispatch({ type: 'JOB_EVENT', event: ev })),
      subscribe('onOverlayArm', (info) => {
        // Main made the overlay a normal drop target again (D20) and a result card is dropped (D21).
        sentClickThrough.current = false
        setOverInteractive(false)
        dispatch({ type: 'ARM', settings: info.settings })
        cursorRef.current = info.cursor
        measure()
        updateLook()
      }),
      subscribe('onOverlayDisarm', () => {
        const wasHidden = modelRef.current.state === 'hidden'
        if (!wasHidden && (modelRef.current.state === 'appear' || modelRef.current.state === 'hover')) {
          // macOS reports the global mouse-up a few ms BEFORE Chromium delivers the drop. Give the drop
          // a moment to arrive; once it has, the reducer ignores DISARM (m.dropping / state changed).
          setTimeout(() => dispatch({ type: 'DISARM' }), DISARM_DROP_GRACE_MS)
          return
        }
        dispatch({ type: 'DISARM' })
        if (wasHidden && host === 'overlay') void call('overlayDone', undefined)
      }),
      subscribe('onCursor', (p) => {
        cursorRef.current = p
        updateLook()
        // D20 on every OS: main polls the cursor for the whole session, so this also works where
        // setIgnoreMouseEvents cannot forward mouse moves (Linux) or forwarding is paused (Windows UIPI).
        if (host === 'overlay' && wantsClickThrough(modelRef.current)) {
          const el = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(p.x, p.y) : null
          setOverInteractive(!!el?.closest(`[${INTERACTIVE_ATTR}]`))
        }
      }),
      subscribe('onTestDrop', testDrop),
      // E2E: drops on the Feed Window (dropFilesOnFeed) — only the feed renderer handles them.
      host === 'feed' ? subscribe('onTestFeedDrop', testDrop) : () => undefined,
      subscribe('onTestCancel', () => cancelJob())
    ]
    return () => {
      alive = false
      for (const off of offs) off()
    }
  }, [cancelJob, dispatch, engage, host, measure, optionCenter, resolveDrop, setOverInteractive, updateLook])

  // ——— state-entry effects: sounds, job start, timers ———
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleLeave = useCallback(
    (ms: number) => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current)
      leaveTimer.current = setTimeout(function tick() {
        if (cardHovered.current) {
          leaveTimer.current = setTimeout(tick, 400)
          return
        }
        dispatch({ type: 'LEAVE' })
      }, ms)
    },
    [dispatch]
  )

  const { state, session } = model
  const poppedSession = useRef(0)
  const jobId = model.job?.id ?? null
  useEffect(() => {
    const m = modelRef.current
    const timers: ReturnType<typeof setTimeout>[] = []
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))
    if (session !== poppedSession.current && (state === 'appear' || state === 'feedMe' || state === 'refuse')) {
      poppedSession.current = session
      sounds.play('popIn')
    }
    switch (state) {
      case 'refuse':
        scheduleLeave(TIMING.resultMs)
        break
      case 'eat': {
        sounds.play('gulp')
        const job = m.job
        if (job) {
          const started = callStrict('startJob', { id: job.id, optionId: job.optionId, inputPaths: job.inputPaths })
          jobStarts.current.clear()
          jobStarts.current.set(job.id, started)
          started.catch(() =>
            dispatch({
              type: 'JOB_EVENT',
              event: { type: 'error', jobId: job.id, error: { code: 'INTERNAL', message: '' } }
            })
          )
        }
        later(m.settings.hungryMode ? TIMING.eatHungryMs : TIMING.eatMs, () => dispatch({ type: 'EAT_DONE' }))
        break
      }
      case 'chew':
        if (!m.minChewDone) later(TIMING.minChewMs, () => dispatch({ type: 'MIN_CHEW_ELAPSED' }))
        break
      case 'spit':
        sounds.play('whoosh')
        if (m.struggle) later(450, () => sounds.play('burp'))
        scheduleLeave(host === 'feed' ? TIMING.feedResultMs : TIMING.resultMs)
        break
      case 'cancel':
        sounds.play('whoosh')
        scheduleLeave(TIMING.cancelMs)
        break
      case 'choke':
        sounds.play('cough')
        scheduleLeave(host === 'feed' ? TIMING.feedResultMs : TIMING.resultMs)
        break
      case 'leave':
        later(TIMING.leaveMs, () => {
          dispatch({ type: 'LEAVE_DONE' })
          if (host === 'overlay') void call('overlayDone', undefined)
        })
        break
      default:
        break
    }
    return () => {
      for (const t of timers) clearTimeout(t)
    }
  }, [state, session, jobId, dispatch, host, scheduleLeave, sounds])

  useEffect(() => {
    if (state !== 'spit' && state !== 'choke' && state !== 'refuse' && state !== 'cancel' && leaveTimer.current) {
      clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
  }, [state])
  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current)
    },
    []
  )

  // Overlay takes focus/keys only while items are held (feedMe); never for result cards (D20, QA3-07).
  const interactive = wantsInteractive(model)
  const lastInteractive = useRef(false)
  useEffect(() => {
    if (host !== 'overlay' || interactive === lastInteractive.current) return
    lastInteractive.current = interactive
    void call('setOverlayInteractive', undefined, interactive)
  }, [host, interactive])

  // An element that disappears under the pointer never sends pointerleave: forget the hover when
  // the state changes (a new card starts un-hovered).
  useLayoutEffect(() => {
    setOverInteractive(false)
  }, [state, session, setOverInteractive])

  // D20: after the drop the overlay is click-through, except while the pointer is over the cancel
  // button or a result card. Re-sent on every state change while true (cheap, and robust if main
  // reset it on its own).
  const clickThrough = host === 'overlay' && wantsClickThrough(model) && !overInteractive
  useEffect(() => {
    if (host !== 'overlay') return
    if (clickThrough === sentClickThrough.current && !clickThrough) return
    sentClickThrough.current = clickThrough
    void call('setOverlayClickThrough', undefined, clickThrough)
  }, [host, clickThrough, state])

  // Look target follows hover changes too.
  useEffect(() => {
    updateLook()
  }, [model.hovered, updateLook])

  const choose = useCallback(
    (id: OptionId) => {
      const p = optionCenter(id)
      if (p) dropPointRef.current = p
      dispatch({ type: 'CHOOSE', optionId: id, jobId: newJobId() })
    },
    [dispatch, optionCenter]
  )
  const hoverOption = useCallback((id: OptionId | null) => dispatch({ type: 'HOVER', optionId: id }), [dispatch])
  const reveal = useCallback((path: string) => {
    void call('revealPath', undefined, path)
  }, [])
  return {
    model,
    dispatch,
    lookRef,
    dropPointRef,
    stageRef,
    sounds,
    choose,
    hoverOption,
    reveal,
    setOverInteractive,
    feedFiles,
    cancelJob
  }
}
