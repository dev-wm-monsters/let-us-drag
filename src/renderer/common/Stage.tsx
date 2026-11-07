// The stage: Uncle (or Plain Mode target) + options ring + progress ring + speech + result cards.
// Shared by the overlay window and the Feed Window. Pure presentation driven by the session model.
import { type CSSProperties, memo, type ReactNode, type RefObject, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_CHARACTER, isCharacterId } from '../../shared/characters'
import { LICENCE_PRICE, lockedExplanation, type LicenceStatus, unlockTitle } from '../../shared/licence'
import type { ConversionOption, DroppedItem, OptionId } from '../../shared/types'
import {
  chewCaption,
  currentRing,
  isLicenceLocked,
  lockPanel,
  type Model,
  showsGuess,
  showsUpdateHint,
  speech,
  uncleMoodAttr,
  visibleOptions
} from '../overlay/state'
import { heldChipTop, placeHint, type Point } from './geometry'
import { isNav, NAV_ID, pageLayout, type RingPage, type RingTarget, slotOf } from './paging'
import { baseName, LINES, shortName } from './text'
import { Character } from './character/Character'
import type { Mood } from './uncle/pose'
import { HEAD_CENTER, VIEWBOX } from './uncle/UncleSvg'
import { INTERACTIVE_ATTR, type RingGeometry, type UncleSession } from './useUncleSession'
import { UpdateHint, UpdatePanel } from './UpdateBubbles'

/** Space kept free at the window edges for hints, cards and captions. */
export const EDGE_MARGIN = 8
/** Radius kept free around a bubble (80 px circle + ink shadow + a little air), and the hovered one (×1.24). */
const BUBBLE_R = 48
const BUBBLE_HOVER_R = 50
/** Room kept between a bubble centre and the held-files chip below the ring (B-064). */
const HELD_CLEARANCE = BUBBLE_HOVER_R + 6

/**
 * Size of the stage (the window, or the Feed Window's drop zone) an element belongs to, in the
 * unscaled px of .lud-center (a small Feed Window scales the drawing down, B-064).
 */
function stageSizeOf(el: HTMLElement): { w: number; h: number } | null {
  const stage = el.closest('.lud-stage')
  if (!(stage instanceof HTMLElement) || stage.clientWidth === 0 || stage.clientHeight === 0) return null
  const k = Number(stage.dataset.stageScale) || 1
  return { w: stage.clientWidth / k, h: stage.clientHeight / k }
}

/**
 * Keep an absolutely positioned element of .lud-center (whose origin is the stage centre) inside the
 * stage: moves it up when its bottom would leave the window (QA3-04: long error cards). Layout
 * boxes only (offsetTop/offsetHeight), so the entry animations' transforms do not matter.
 */
function useKeepInside(ref: RefObject<HTMLElement | null>, deps: readonly unknown[]): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.marginTop = ''
    const size = stageSizeOf(el)
    if (!size) return
    const top = size.h / 2 + el.offsetTop
    const overflow = top + el.offsetHeight - (size.h - EDGE_MARGIN)
    if (overflow > 0) el.style.marginTop = `${-Math.min(overflow, Math.max(0, top - EDGE_MARGIN))}px`
  }, deps)
}

/**
 * Hover colours. Each bubble in a ring gets its own colour (by position), so a ring is never mostly
 * one hue (product feedback: image rings were all teal). Warm, saturated mid-tones that sit well on
 * cream with ink outlines; neighbours are deliberately far apart on the colour wheel.
 */
export const ACCENTS = [
  '#3fb6a8', // teal
  '#f2694b', // tomato
  '#8a6fd6', // violet
  '#f2a93b', // saffron
  '#4f8fdc', // blue
  '#e46a9b', // pink
  '#58b35a', // green
  '#c0784a' // cinnamon
] as const

export function accentFor(index: number): string {
  return ACCENTS[((index % ACCENTS.length) + ACCENTS.length) % ACCENTS.length]!
}

/** Pixel offset of a viewBox point from the head centre for a given Uncle width. */
export function uncleOffset(width: number, vx: number, vy: number): { x: number; y: number } {
  const s = width / VIEWBOX.w
  return { x: (vx - HEAD_CENTER.x) * s, y: (vy - HEAD_CENTER.y) * s }
}

function moodFor(m: Model): Mood {
  // Locked (D26): he pops in with his arms up, like 'appear', but nothing is offered.
  if (m.state === 'locked') return 'appear'
  return m.state
}

/** Unlock bubbles (D26): where the two round buttons sit on the ring (degrees, 0 = right, 90 = down). */
export const UNLOCK_BUY_ANGLE = 122
export const UNLOCK_KEY_ANGLE = 58

/** Distance of the unlock bubbles from the centre: on the ring, or below a big (Feed Window) Uncle. */
export function unlockDistance(radius: number, uncleWidth: number): number {
  return Math.round(Math.max(radius, uncleWidth * 0.95))
}

/**
 * "Unlock for $9.50" (D26): a big speech bubble above the Uncle with what it costs (or why the
 * licence is locked), and two round bubbles on the ring, "Buy $9.50" and "I have a key", in the
 * style of the option bubbles. × / Esc close it (the overlay; the Feed Window rests on it).
 */
function UnlockPanel({
  status,
  radius,
  headTopY,
  closable,
  onBuy,
  onKey,
  onClose,
  onOver
}: {
  status: LicenceStatus
  radius: number
  headTopY: number
  closable: boolean
  onBuy(): void
  onKey(): void
  onClose(): void
  onOver(on: boolean): void
}) {
  const at = (deg: number) => {
    const a = (deg * Math.PI) / 180
    return { '--x': `${Math.round(Math.cos(a) * radius)}px`, '--y': `${Math.round(Math.sin(a) * radius)}px` }
  }
  const hover = { onPointerEnter: () => onOver(true), onPointerLeave: () => onOver(false), [INTERACTIVE_ATTR]: '' }
  const explanation = lockedExplanation(status)
  // The key is still valid when only this computer's activation is gone: activating again is the main action.
  const keyFirst = status === 'reactivate'
  return (
    <div className="lud-unlock" data-testid="unlock" data-licence-status={status}>
      <div
        className={`lud-unlock-say${status === 'disabled' ? ' is-disabled' : ''}`}
        style={{ top: headTopY - 6 }}
        data-testid="unlock-bubble"
        role="status"
        {...hover}
      >
        <strong>{unlockTitle(status)}</strong>
        <span data-testid="unlock-explanation">{explanation}</span>
        {closable && (
          <button type="button" className="lud-unlock-close" data-testid="unlock-close" title="Close (Esc)" aria-label="Close" onClick={onClose}>
            <span aria-hidden>✕</span>
          </button>
        )}
      </div>
      <button
        type="button"
        className={`lud-unlock-btn is-buy${keyFirst ? '' : ' is-primary'}`}
        style={at(UNLOCK_BUY_ANGLE) as CSSProperties}
        data-testid="unlock-buy"
        aria-label={`Buy a licence (${LICENCE_PRICE})`}
        onClick={onBuy}
        {...hover}
      >
        <span className="lud-unlock-btn-bubble">
          <span className="lud-unlock-btn-label">
            Buy
            <b>{LICENCE_PRICE}</b>
          </span>
        </span>
      </button>
      <button
        type="button"
        className={`lud-unlock-btn is-key${keyFirst ? ' is-primary' : ''}`}
        style={{ ...at(UNLOCK_KEY_ANGLE), animationDelay: '40ms' } as CSSProperties}
        data-testid="unlock-key"
        aria-label={keyFirst ? 'Activate again' : 'I have a key'}
        onClick={onKey}
        {...hover}
      >
        <span className="lud-unlock-btn-bubble">
          <span className="lud-unlock-btn-label">
            {keyFirst ? (
              <>
                Activate
                <br />
                again
              </>
            ) : (
              <>
                I have
                <br />a key
              </>
            )}
          </span>
        </span>
      </button>
    </div>
  )
}

/** "Spit it out" button on the progress ring (TPM D3). Angle in degrees (0 = right, -90 = up). */
export const CANCEL_ANGLE = -45

function CancelButton({ radius, onCancel, onOver }: { radius: number; onCancel(): void; onOver(on: boolean): void }) {
  const a = (CANCEL_ANGLE * Math.PI) / 180
  const style = { '--x': `${Math.round(Math.cos(a) * radius)}px`, '--y': `${Math.round(Math.sin(a) * radius)}px` } as CSSProperties
  return (
    <button
      type="button"
      className="lud-cancel"
      style={style}
      data-testid="cancel-job"
      title={LINES.cancelHint}
      aria-label={`${LINES.cancelHint} (cancel)`}
      // The overlay is not focusable while chewing, but it still receives clicks (no focus needed).
      // It is click-through except while the pointer is over this button (D20).
      onClick={onCancel}
      onPointerEnter={() => onOver(true)}
      onPointerLeave={() => onOver(false)}
      {...{ [INTERACTIVE_ATTR]: '' }}
    >
      <span className="lud-cancel-x" aria-hidden>
        ✕
      </span>
      <span className="lud-cancel-tip" aria-hidden>
        {LINES.cancelHint}
      </span>
    </button>
  )
}

interface OptionsRingProps {
  ring: RingPage
  hovered: RingTarget | null
  radius: number
  clickable: boolean
  /** During a drag (no clicks): resting on More / Back turns the page; shows the dwell timer. */
  dwell: boolean
  /** More / Back may turn the page again (not latched after a turn, see Model.navLatched). */
  navArmed: boolean
  /** Lowest y (ring coordinates) a hint may reach: the top of the held-files chip, when it is shown. */
  hintFloor?: number | undefined
  session: number
  reducedMotion: boolean
  onChoose(id: OptionId): void
  onHover(id: RingTarget | null): void
  onTurn(): void
}

/** How long the bubbles of the previous page take to fall back into More / Back (D31). */
const PAGE_OUT_MS = 220

interface LeavingBubble {
  option: ConversionOption
  x: number
  y: number
  accent: string
}

/** Accent of a slot on a page: distinct within a page, shifted per page so a new page looks new. */
function pageAccent(slot: number, page: number): string {
  return accentFor(slot + page * 3)
}

const OptionsRing = memo(function OptionsRing({
  ring,
  hovered,
  radius,
  clickable,
  dwell,
  navArmed,
  hintFloor,
  session,
  reducedMotion,
  onChoose,
  onHover,
  onTurn
}: OptionsRingProps) {
  const slots = useMemo(() => pageLayout(ring, radius), [ring.slotCount, ring.guess, radius])
  const navSlot = ring.nav ? slots[ring.nav.slot] : undefined

  // Page turns of this session (the ring is keyed by session): the first page fans out of the Uncle,
  // later pages spill out of the More / Back bubble while the old page falls back into it.
  const [turned, setTurned] = useState(false)
  const shown = useRef(ring)
  const [leaving, setLeaving] = useState<{ page: number; bubbles: LeavingBubble[] } | null>(null)
  useLayoutEffect(() => {
    const prev = shown.current
    shown.current = ring
    if (prev.page === ring.page) return
    setTurned(true)
    if (reducedMotion) return
    const all = pageLayout(prev, radius)
    setLeaving({
      page: prev.page,
      bubbles: prev.entries.map((e) => ({ option: e.option, x: all[e.slot]!.x, y: all[e.slot]!.y, accent: pageAccent(e.slot, prev.page) }))
    })
    const t = setTimeout(() => setLeaving(null), PAGE_OUT_MS)
    return () => clearTimeout(t)
    // Only page turns matter: the options themselves never change within a session.
  }, [ring.page])

  const hoveredSlot = slotOf(ring, hovered)
  let hint: string | null = null
  if (hoveredSlot >= 0 && isNav(hovered) && ring.nav) {
    hint = ring.nav.kind === 'more' ? LINES.moreHint(ring.nav.count) : LINES.backHint(ring.nav.count)
  } else if (hoveredSlot >= 0) {
    hint = ring.entries.find((e) => e.slot === hoveredSlot)?.option.hint ?? null
  }
  const visible = useMemo(
    () => ring.entries.map((e) => slots[e.slot]!).concat(navSlot ? [navSlot] : []),
    [ring.entries, slots, navSlot]
  )
  const others = useMemo(() => visible.filter((s) => s.index !== hoveredSlot), [visible, hoveredSlot])
  const ringStyle = (navSlot ? { '--nx': `${navSlot.x}px`, '--ny': `${navSlot.y}px` } : {}) as CSSProperties
  return (
    <div
      className={`lud-ring${clickable ? ' is-clickable' : ''}${ring.pageCount > 1 ? ' is-paged' : ''}`}
      style={ringStyle}
      key={session}
      data-testid="options-ring"
      data-page={ring.page}
      data-pages={ring.pageCount}
    >
      {leaving?.bubbles.map((b) => (
        <span
          key={`out-${leaving.page}-${b.option.id}`}
          className={`lud-option is-leaving${b.option.label.length > 5 ? ' is-long' : ''}`}
          style={{ '--x': `${b.x}px`, '--y': `${b.y}px`, '--accent': b.accent } as CSSProperties}
          aria-hidden
        >
          <span className="lud-option-bubble">
            <span className="lud-option-label">{b.option.label}</span>
          </span>
        </span>
      ))}
      {ring.entries.map(({ option: o, slot: index }, i) => {
        const slot = slots[index]!
        const style = {
          '--x': `${slot.x}px`,
          '--y': `${slot.y}px`,
          '--accent': pageAccent(index, ring.page),
          animationDelay: `${turned ? 40 + i * 30 : index * 28}ms`
        } as CSSProperties
        const isHover = hovered === o.id
        return (
          <button
            key={o.id}
            type="button"
            className={`lud-option${isHover ? ' is-hover' : ''}${o.label.length > 5 ? ' is-long' : ''}${turned ? ' is-page-in' : ''}`}
            style={style}
            data-testid={`option-${o.id}`}
            data-option-id={o.id}
            tabIndex={clickable ? 0 : -1}
            aria-label={`${o.label}: ${o.hint}`}
            onClick={clickable ? () => onChoose(o.id) : undefined}
            onMouseEnter={clickable ? () => onHover(o.id) : undefined}
            onMouseLeave={clickable ? () => onHover(null) : undefined}
            onFocus={clickable ? () => onHover(o.id) : undefined}
            onBlur={clickable ? () => onHover(null) : undefined}
          >
            <span className="lud-option-bubble">
              <span className="lud-option-label">{o.label}</span>
            </span>
          </button>
        )
      })}
      {ring.nav && navSlot && (
        <NavBubble
          ring={ring}
          x={navSlot.x}
          y={navSlot.y}
          delay={ring.nav.slot * 28}
          hover={isNav(hovered)}
          clickable={clickable}
          dwell={dwell && navArmed && isNav(hovered)}
          onHover={onHover}
          onTurn={onTurn}
        />
      )}
      {hint !== null && (
        <OptionHint key={`${ring.page}-${String(hovered)}`} text={hint} at={slots[hoveredSlot]!} others={others} floor={hintFloor} />
      )}
    </div>
  )
})

/**
 * The More / Back bubble (D31): same size and spot on every page, but a different look from the
 * options (paper, dashed inner ring, dots or an arrow, a "+N" sticker and page dots). During a drag,
 * resting on it fills a ring around it and turns the page; in feedMe it is a button (click, Tab + Enter).
 */
function NavBubble({
  ring,
  x,
  y,
  delay,
  hover,
  clickable,
  dwell,
  onHover,
  onTurn
}: {
  ring: RingPage
  x: number
  y: number
  delay: number
  hover: boolean
  clickable: boolean
  dwell: boolean
  onHover(id: RingTarget | null): void
  onTurn(): void
}) {
  const nav = ring.nav!
  const more = nav.kind === 'more'
  const style = { '--x': `${x}px`, '--y': `${y}px`, '--accent': 'var(--orange)', animationDelay: `${delay}ms` } as CSSProperties
  return (
    <button
      type="button"
      className={`lud-option lud-nav is-${nav.kind}${hover ? ' is-hover' : ''}${dwell ? ' is-dwell' : ''}`}
      style={style}
      data-testid="ring-more"
      data-nav={nav.kind}
      tabIndex={clickable ? 0 : -1}
      aria-label={more ? `More: ${LINES.moreHint(nav.count)}` : `Back: ${LINES.backHint(nav.count)}`}
      onClick={clickable ? onTurn : undefined}
      onMouseEnter={clickable ? () => onHover(NAV_ID) : undefined}
      onMouseLeave={clickable ? () => onHover(null) : undefined}
      onFocus={clickable ? () => onHover(NAV_ID) : undefined}
      onBlur={clickable ? () => onHover(null) : undefined}
      {...{ [INTERACTIVE_ATTR]: '' }}
    >
      <span className="lud-option-bubble lud-nav-bubble">
        {dwell && (
          <svg className="lud-nav-dwell" key={`dwell-${ring.page}`} viewBox="-50 -50 100 100" aria-hidden>
            <circle className="lud-nav-dwell-ink" r="47" pathLength="100" />
            <circle className="lud-nav-dwell-fill" r="47" pathLength="100" />
          </svg>
        )}
        <span className="lud-nav-face" key={`face-${ring.page}`}>
          <span className="lud-nav-icon" aria-hidden>
            {more ? (
              <>
                <i />
                <i />
                <i />
              </>
            ) : (
              <svg viewBox="0 0 24 16" width="22" height="15">
                <path d="M9 2 L3 8 L9 14 M3.5 8 H21" />
              </svg>
            )}
          </span>
          <span className="lud-nav-label">{more ? 'More' : 'Back'}</span>
          <span className="lud-nav-pages" aria-hidden>
            {Array.from({ length: ring.pageCount }, (_, i) => (
              <i key={i} className={i === ring.page ? 'is-on' : undefined} />
            ))}
          </span>
        </span>
      </span>
      {more && (
        <span className="lud-nav-badge" key={`badge-${ring.page}`} aria-hidden>
          +{nav.count}
        </span>
      )}
    </button>
  )
}

/**
 * The hovered bubble's hint pill, placed next to it so it stays inside the window and covers no
 * other bubble (QA3-03). Measured and placed before paint.
 */
function OptionHint({ text, at, others, floor }: { text: string; at: Point; others: readonly Point[]; floor?: number | undefined }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const size = stageSizeOf(el) ?? { w: 560, h: 560 }
    const top = -size.h / 2 + EDGE_MARGIN
    // Never over the held-files chip under the ring (its top is the floor).
    const bottom = Math.max(top + el.offsetHeight, Math.min(size.h / 2 - EDGE_MARGIN, floor ?? Infinity))
    const p = placeHint({
      slot: at,
      others,
      bubbleRadius: BUBBLE_HOVER_R,
      otherRadius: BUBBLE_R,
      size: { w: el.offsetWidth, h: el.offsetHeight },
      bounds: { x: -size.w / 2 + EDGE_MARGIN, y: top, w: size.w - 2 * EDGE_MARGIN, h: bottom - top },
      gap: 5
    })
    el.style.left = `${Math.round(p.x)}px`
    el.style.top = `${Math.round(p.y)}px`
    el.dataset.side = p.side
    el.style.visibility = 'visible'
  }, [text, at, others, floor])
  return (
    <span ref={ref} className="lud-option-hint" data-testid="hover-hint" style={{ visibility: 'hidden' }} aria-hidden>
      {text}
    </span>
  )
}

function ProgressRing({ radius, progress, visible }: { radius: number; progress: number; visible: boolean }) {
  const r = radius - 4
  const c = 2 * Math.PI * r
  const indeterminate = progress < 0
  const p = indeterminate ? 0.22 : Math.max(0.03, Math.min(1, progress))
  const size = radius * 2 + 24
  return (
    <svg
      className={`lud-progress${visible ? ' is-visible' : ''}${indeterminate ? ' is-indeterminate' : ''}`}
      width={size}
      height={size}
      viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
      aria-hidden={!visible}
      data-testid="progress-ring"
    >
      <circle r={r} className="lud-progress-track" />
      <circle r={r} className="lud-progress-ink" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90) translate(1.5 2)" />
      <circle r={r} className="lud-progress-bar" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90)" />
    </svg>
  )
}

function FileGlyph({ ext }: { ext: string }) {
  return (
    <span className="lud-file-glyph" aria-hidden>
      <span className="lud-file-ext">{ext.slice(0, 4).toUpperCase() || 'FILE'}</span>
    </span>
  )
}

/**
 * "Holding these files, pick an option" chip (feedMe after a drop on the mouth). Compact and
 * click-through, placed where it covers no option bubble (B-064): under the ring in the overlay,
 * in the header of the Feed Window.
 */
export function HeldChip({
  held,
  className,
  style,
  onClose,
  onOver
}: {
  held: readonly DroppedItem[]
  className?: string
  style?: CSSProperties
  /** × button: close without converting (same as Esc, which still works). */
  onClose(): void
  onOver(on: boolean): void
}) {
  return (
    <div className={`lud-held ${className ?? ''}`} style={style} data-testid="held-files">
      <span className="lud-file-ext">{held[0]?.ext.slice(0, 4).toUpperCase() || 'FILE'}</span>
      <strong>{held.length === 1 ? shortName(held[0]!.name, 26) : `${held.length} files`}</strong>
      <small>Pick an option · Esc to cancel</small>
      <button
        type="button"
        className="lud-held-close"
        data-testid="held-close"
        title="Close (Esc)"
        aria-label="Close without converting"
        onClick={onClose}
        onPointerEnter={() => onOver(true)}
        onPointerLeave={() => onOver(false)}
        {...{ [INTERACTIVE_ATTR]: '' }}
      >
        <span aria-hidden>✕</span>
      </button>
    </div>
  )
}

function PlainTarget({ state }: { state: Model['state'] }) {
  return (
    <div className={`lud-plain lud-plain-${state}`} data-testid="plain-target">
      <div className="lud-plain-core">
        {state === 'spit'
          ? '✓'
          : state === 'choke' || state === 'refuse'
            ? '✕'
            : state === 'cancel'
              ? '↩'
              : state === 'chew' || state === 'eat'
                ? '…'
                : '+'}
      </div>
    </div>
  )
}

export interface StageProps {
  s: UncleSession
  testId: string
  uncleWidth: number
  ring: RingGeometry
  reducedMotion: boolean
  /** Extra content shown while idle (Feed Window). */
  idleExtra?: ReactNode
  /** Show the held-files chip under the ring (default). The Feed Window shows it in its header. */
  showHeld?: boolean
  className?: string
}

export function Stage({ s, testId, uncleWidth, ring, reducedMotion, idleExtra, showHeld = true, className }: StageProps) {
  const { model } = s
  const plain = model.settings.plainMode
  const character = isCharacterId(model.settings.character) ? model.settings.character : DEFAULT_CHARACTER
  const opts = visibleOptions(model)
  const guess = showsGuess(model)
  const ringPage = useMemo(() => currentRing(model), [opts, model.page, guess])
  const clickable = model.state === 'feedMe' && model.held !== null
  const dragging = model.state === 'appear' || model.state === 'hover'
  // With bubbles he only talks when the drag is a guess ("Feed me, or ZIP it!", D31).
  const say = opts.length === 0 || guess ? speech(model) : null
  const mouth = uncleOffset(uncleWidth, 0, 82)
  const headTop = uncleOffset(uncleWidth, 0, -150)
  const scale = uncleWidth / VIEWBOX.w
  const sounds = s.sounds
  const onChewBeat = useCallback(() => sounds.play('crunch'), [sounds])
  const mods = useMemo(() => ({ hamster: model.hamster, struggle: model.struggle }), [model.hamster, model.struggle])

  // Fly-in start point relative to the stage centre.
  let fly: CSSProperties | null = null
  if (model.state === 'eat' || model.state === 'cancel') {
    const el = s.stageRef.current
    const r = el?.getBoundingClientRect()
    const from = s.dropPointRef.current
    // Client px → the (possibly scaled) .lud-center's px.
    let fx = r && from ? (from.x - (r.left + r.width / 2)) / ring.scale : 0
    let fy = r && from ? (from.y - (r.top + r.height / 2)) / ring.scale : 0
    if (model.state === 'cancel' && Math.hypot(fx, fy) < 60) {
      // Dropped on the mouth (or unknown): spit it up and to the left, away from the cancel button.
      fx = -ring.radius * 0.8
      fy = -ring.radius * 0.45
    }
    fly = { '--fx': `${fx}px`, '--fy': `${fy}px`, '--tx': '0px', '--ty': `${plain ? 0 : mouth.y}px` } as CSSProperties
  }

  const out = model.outputPaths[0] ?? ''
  const firstItem = model.items[0]
  const hidden = model.state === 'hidden'
  // D26 / D29: which lock bubble ("Unlock for $9.50" / "Please update me"), if any.
  const panel = lockPanel(model)
  const unlock = panel !== null
  const caption = chewCaption(model)
  const cardRef = useRef<HTMLElement | null>(null)
  const captionRef = useRef<HTMLDivElement | null>(null)
  useKeepInside(cardRef, [model.state, model.session, model.message, out])
  useKeepInside(captionRef, [caption, ring.radius])

  return (
    <div
      ref={s.stageRef}
      className={`lud-stage${hidden ? ' is-hidden' : ''}${plain ? ' is-plain' : ''}${reducedMotion ? ' is-reduced' : ''} ${className ?? ''}`}
      data-testid={testId}
      data-uncle-state={model.state}
      data-hamster={model.hamster ? 'true' : 'false'}
      data-struggle={model.struggle ? 'true' : 'false'}
      data-plain={plain ? 'true' : 'false'}
      data-character={character}
      data-uncle-mood={uncleMoodAttr(model)}
      data-licensed={isLicenceLocked(model) ? 'false' : 'true'}
      data-lock-reason={panel ?? 'none'}
      data-update-status={model.update?.status ?? 'unknown'}
      data-stage-scale={ring.scale}
      style={{ '--uncle-scale': scale } as CSSProperties}
    >
      <div className="lud-center" style={ring.scale !== 1 ? { transform: `scale(${ring.scale})` } : undefined}>
        <ProgressRing
          radius={ring.radius}
          progress={model.state === 'eat' ? 0 : model.progress}
          visible={model.state === 'eat' || model.state === 'chew'}
        />
        {plain ? (
          <PlainTarget state={model.state} />
        ) : (
          <div
            className="lud-uncle"
            style={{ left: -uncleWidth / 2, top: -(HEAD_CENTER.y - VIEWBOX.y) * scale }}
            data-testid="uncle"
          >
            <Character
              id={character}
              mood={moodFor(model)}
              mods={mods}
              width={uncleWidth}
              lookRef={s.lookRef}
              reducedMotion={reducedMotion}
              onChewBeat={onChewBeat}
              paused={hidden}
            />
          </div>
        )}

        {opts.length > 0 && (
          <OptionsRing
            key={model.session}
            ring={ringPage}
            hovered={model.hovered}
            radius={ring.radius}
            clickable={clickable}
            dwell={dragging}
            navArmed={!model.navLatched}
            hintFloor={clickable && showHeld ? heldChipTop(ring.radius, HELD_CLEARANCE) - 4 : undefined}
            session={model.session}
            reducedMotion={reducedMotion}
            onChoose={s.choose}
            onHover={s.hoverOption}
            onTurn={s.turnPage}
          />
        )}

        {say && (
          <div
            className={`lud-speech${model.state === 'refuse' ? ' is-refuse' : ''}`}
            style={{ top: headTop.y - 6 }}
            data-testid="speech-bubble"
            role="status"
          >
            {say}
          </div>
        )}

        {clickable && model.held && showHeld && (
          <HeldChip
            held={model.held}
            className="is-under-ring"
            style={{ top: heldChipTop(ring.radius, HELD_CLEARANCE) }}
            onClose={s.dismiss}
            onOver={s.setOverInteractive}
          />
        )}

        {model.state === 'chew' && <CancelButton radius={ring.radius} onCancel={s.cancelJob} onOver={s.setOverInteractive} />}

        {caption && (
          <div
            ref={captionRef}
            className="lud-stage-text"
            style={{ top: ring.radius + 16 }}
            data-testid="stage-text"
            role="status"
          >
            {caption}
          </div>
        )}

        {fly && (
          <div
            className={model.state === 'cancel' ? 'lud-spitback' : 'lud-fly'}
            style={fly}
            key={`${model.state}-${model.session}`}
            data-testid={model.state === 'cancel' ? 'spit-back' : undefined}
          >
            <FileGlyph ext={firstItem?.ext ?? ''} />
          </div>
        )}

        {(model.state === 'chew' || model.state === 'eat') && model.hamster && (
          <div className="lud-badge" style={{ top: headTop.y - 10 }} data-testid="hamster-badge">
            nom ×{model.items.length}
          </div>
        )}

        {model.state === 'spit' && out && (
          <button
            ref={(el) => {
              cardRef.current = el
            }}
            type="button"
            className="lud-card lud-card-ok"
            data-testid="output-card"
            title="Show in folder"
            onClick={() => s.reveal(out)}
            onPointerEnter={() => s.setOverInteractive(true)}
            onPointerLeave={() => s.setOverInteractive(false)}
            {...{ [INTERACTIVE_ATTR]: '' }}
            style={{ '--from-y': `${mouth.y}px` } as CSSProperties}
          >
            <FileGlyph ext={baseName(out).split('.').pop() ?? ''} />
            <span className="lud-card-text">
              <strong>{shortName(baseName(out), 30)}</strong>
              <span>
                {LINES.saved}
                {model.outputPaths.length > 1 ? ` · +${model.outputPaths.length - 1} more` : ''}
              </span>
              <em>Click to show in folder</em>
            </span>
          </button>
        )}

        {model.state === 'choke' && (
          <div
            ref={(el) => {
              cardRef.current = el
            }}
            className="lud-card lud-card-err"
            data-testid="error-message"
            role="alert"
            onPointerEnter={() => s.setOverInteractive(true)}
            onPointerLeave={() => s.setOverInteractive(false)}
            {...{ [INTERACTIVE_ATTR]: '' }}
            style={{ '--from-y': `${mouth.y}px` } as CSSProperties}
          >
            <FileGlyph ext={firstItem?.ext ?? ''} />
            <span className="lud-card-text">
              <strong>*cough* *cough*</strong>
              <span className="lud-card-message">{model.message}</span>
            </span>
          </div>
        )}

        {panel === 'update' && (
          <UpdatePanel
            key={`update-${model.session}`}
            host={model.host}
            latest={model.update?.latestVersion ?? null}
            radius={unlockDistance(ring.radius, plain ? 0 : uncleWidth)}
            headTopY={headTop.y}
            closable={model.state === 'locked'}
            onDownload={s.downloadUpdate}
            onClose={s.dismiss}
            onOver={s.setOverInteractive}
          />
        )}

        {showsUpdateHint(model) && <UpdateHint key={`hint-${model.session}`} top={heldChipTop(ring.radius, HELD_CLEARANCE)} />}

        {panel === 'licence' && (
          <UnlockPanel
            key={`unlock-${model.session}`}
            status={model.licence?.status ?? 'unlicensed'}
            radius={unlockDistance(ring.radius, plain ? 0 : uncleWidth)}
            headTopY={headTop.y}
            closable={model.state === 'locked'}
            onBuy={s.buy}
            onKey={s.haveKey}
            onClose={s.dismiss}
            onOver={s.setOverInteractive}
          />
        )}

        {model.state === 'idle' && !unlock && idleExtra}
      </div>
    </div>
  )
}
