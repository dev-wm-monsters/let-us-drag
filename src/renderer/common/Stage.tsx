// The stage: Uncle (or Plain Mode target) + options ring + progress ring + speech + result cards.
// Shared by the overlay window and the Feed Window. Pure presentation driven by the session model.
import { type CSSProperties, memo, type ReactNode, type RefObject, useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { DEFAULT_CHARACTER, isCharacterId } from '../../shared/characters'
import type { ConversionOption, DroppedItem, OptionId } from '../../shared/types'
import { chewCaption, type Model, speech, uncleMoodAttr, visibleOptions } from '../overlay/state'
import { heldChipTop, placeHint, ringLayout } from './geometry'
import { baseName, LINES, shortName } from './text'
import { Character } from './character/Character'
import type { Mood } from './uncle/pose'
import { HEAD_CENTER, VIEWBOX } from './uncle/UncleSvg'
import { INTERACTIVE_ATTR, type RingGeometry, type UncleSession } from './useUncleSession'

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

const ACCENT: Partial<Record<OptionId, string>> = {}
for (const id of ['to-png', 'to-jpg', 'to-webp', 'to-avif', 'to-ico', 'remove-bg', 'pdf-to-png', 'pdf-to-jpg'] as const)
  ACCENT[id] = '#3fb6a8'
for (const id of ['to-mp4', 'to-mov', 'to-webm', 'to-gif'] as const) ACCENT[id] = '#8a6fd6'
for (const id of ['to-mp3', 'to-wav', 'to-m4a', 'to-ogg', 'to-flac'] as const) ACCENT[id] = '#e46a9b'
for (const id of ['to-pdf', 'to-html', 'to-md', 'to-txt', 'to-docx'] as const) ACCENT[id] = '#4f8fdc'
for (const id of ['to-csv', 'to-json', 'to-yaml', 'to-xlsx'] as const) ACCENT[id] = '#58b35a'
for (const id of ['zip', 'unzip', 'compress', 'pdf-merge'] as const) ACCENT[id] = '#f08a3c'

export function accentFor(id: OptionId): string {
  return ACCENT[id] ?? '#f08a3c'
}

/** Pixel offset of a viewBox point from the head centre for a given Uncle width. */
export function uncleOffset(width: number, vx: number, vy: number): { x: number; y: number } {
  const s = width / VIEWBOX.w
  return { x: (vx - HEAD_CENTER.x) * s, y: (vy - HEAD_CENTER.y) * s }
}

function moodFor(m: Model): Mood {
  return m.state
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
  options: ConversionOption[]
  hovered: OptionId | null
  radius: number
  clickable: boolean
  session: number
  onChoose(id: OptionId): void
  onHover(id: OptionId | null): void
}

const OptionsRing = memo(function OptionsRing({ options, hovered, radius, clickable, session, onChoose, onHover }: OptionsRingProps) {
  const slots = useMemo(() => ringLayout(options.length, radius), [options.length, radius])
  const hoverIndex = hovered ? options.findIndex((o) => o.id === hovered) : -1
  return (
    <div className={`lud-ring${clickable ? ' is-clickable' : ''}`} key={session}>
      {options.map((o, i) => {
        const slot = slots[i]!
        const style = {
          '--x': `${slot.x}px`,
          '--y': `${slot.y}px`,
          '--accent': accentFor(o.id),
          animationDelay: `${i * 28}ms`
        } as CSSProperties
        const isHover = hovered === o.id
        return (
          <button
            key={o.id}
            type="button"
            className={`lud-option${isHover ? ' is-hover' : ''}${o.label.length > 5 ? ' is-long' : ''}`}
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
      {hoverIndex >= 0 && (
        <OptionHint key={options[hoverIndex]!.id} text={options[hoverIndex]!.hint} index={hoverIndex} slots={slots} />
      )}
    </div>
  )
})

/**
 * The hovered option's hint pill, placed next to its bubble so it stays inside the window and covers
 * no other bubble (QA3-03). Measured and placed before paint.
 */
function OptionHint({ text, index, slots }: { text: string; index: number; slots: readonly { x: number; y: number }[] }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const slot = slots[index]
    if (!el || !slot) return
    const size = stageSizeOf(el) ?? { w: 560, h: 560 }
    const p = placeHint({
      slot,
      others: slots.filter((_, i) => i !== index),
      bubbleRadius: BUBBLE_HOVER_R,
      otherRadius: BUBBLE_R,
      size: { w: el.offsetWidth, h: el.offsetHeight },
      bounds: { x: -size.w / 2 + EDGE_MARGIN, y: -size.h / 2 + EDGE_MARGIN, w: size.w - 2 * EDGE_MARGIN, h: size.h - 2 * EDGE_MARGIN },
      gap: 5
    })
    el.style.left = `${Math.round(p.x)}px`
    el.style.top = `${Math.round(p.y)}px`
    el.dataset.side = p.side
    el.style.visibility = 'visible'
  }, [text, index, slots])
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
export function HeldChip({ held, className, style }: { held: readonly DroppedItem[]; className?: string; style?: CSSProperties }) {
  return (
    <div className={`lud-held ${className ?? ''}`} style={style} data-testid="held-files">
      <span className="lud-file-ext">{held[0]?.ext.slice(0, 4).toUpperCase() || 'FILE'}</span>
      <strong>{held.length === 1 ? shortName(held[0]!.name, 26) : `${held.length} files`}</strong>
      <small>Pick an option · Esc to cancel</small>
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
  const clickable = model.state === 'feedMe' && model.held !== null
  const say = opts.length === 0 ? speech(model) : null
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
            options={opts}
            hovered={model.hovered}
            radius={ring.radius}
            clickable={clickable}
            session={model.session}
            onChoose={s.choose}
            onHover={s.hoverOption}
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
          <HeldChip held={model.held} className="is-under-ring" style={{ top: heldChipTop(ring.radius, HELD_CLEARANCE) }} />
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

        {model.state === 'idle' && idleExtra}
      </div>
    </div>
  )
}
