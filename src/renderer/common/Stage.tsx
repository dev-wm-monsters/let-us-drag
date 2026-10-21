// The stage: Uncle (or Plain Mode target) + options ring + progress ring + speech + result cards.
// Shared by the overlay window and the Feed Window. Pure presentation driven by the session model.
import { type CSSProperties, memo, type ReactNode, useCallback, useMemo } from 'react'
import type { ConversionOption, OptionId } from '../../shared/types'
import { type Model, speech, visibleOptions } from '../overlay/state'
import { ringLayout } from './geometry'
import { baseName, LINES, shortName } from './text'
import { Uncle } from './uncle/Uncle'
import type { Mood } from './uncle/pose'
import { HEAD_CENTER, VIEWBOX } from './uncle/UncleSvg'
import type { RingGeometry, UncleSession } from './useUncleSession'

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
            {isHover && <span className="lud-option-hint">{o.hint}</span>}
          </button>
        )
      })}
    </div>
  )
})

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

function PlainTarget({ state }: { state: Model['state'] }) {
  return (
    <div className={`lud-plain lud-plain-${state}`} data-testid="plain-target">
      <div className="lud-plain-core">
        {state === 'spit' ? '✓' : state === 'choke' || state === 'refuse' ? '✕' : state === 'chew' || state === 'eat' ? '…' : '+'}
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
  className?: string
}

export function Stage({ s, testId, uncleWidth, ring, reducedMotion, idleExtra, className }: StageProps) {
  const { model } = s
  const plain = model.settings.plainMode
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
  if (model.state === 'eat') {
    const el = s.stageRef.current
    const r = el?.getBoundingClientRect()
    const from = s.dropPointRef.current
    const fx = r && from ? from.x - (r.left + r.width / 2) : 0
    const fy = r && from ? from.y - (r.top + r.height / 2) : 0
    fly = { '--fx': `${fx}px`, '--fy': `${fy}px`, '--tx': '0px', '--ty': `${plain ? 0 : mouth.y}px` } as CSSProperties
  }

  const out = model.outputPaths[0] ?? ''
  const firstItem = model.items[0]
  const hidden = model.state === 'hidden'

  return (
    <div
      ref={s.stageRef}
      className={`lud-stage${hidden ? ' is-hidden' : ''}${plain ? ' is-plain' : ''}${reducedMotion ? ' is-reduced' : ''} ${className ?? ''}`}
      data-testid={testId}
      data-uncle-state={model.state}
      data-hamster={model.hamster ? 'true' : 'false'}
      data-struggle={model.struggle ? 'true' : 'false'}
      data-plain={plain ? 'true' : 'false'}
      style={{ '--uncle-scale': scale } as CSSProperties}
    >
      <div className="lud-center">
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
            <Uncle
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

        {clickable && model.held && (
          <div className="lud-held" data-testid="held-files">
            <FileGlyph ext={model.held[0]?.ext ?? ''} />
            <span>
              {model.held.length === 1
                ? shortName(model.held[0]!.name, 26)
                : `${model.held.length} files`}
              <small>Pick an option · Esc to cancel</small>
            </span>
          </div>
        )}

        {fly && (
          <div className="lud-fly" style={fly} key={`fly-${model.session}`}>
            <FileGlyph ext={firstItem?.ext ?? ''} />
          </div>
        )}

        {(model.state === 'chew' || model.state === 'eat') && model.hamster && (
          <div className="lud-badge" style={{ top: headTop.y - 10 }}>
            nom ×{model.items.length}
          </div>
        )}

        {model.state === 'spit' && out && (
          <button
            type="button"
            className="lud-card lud-card-ok"
            data-testid="output-card"
            title="Show in folder"
            onClick={() => s.reveal(out)}
            onMouseEnter={() => s.setCardHovered(true)}
            onMouseLeave={() => s.setCardHovered(false)}
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
            className="lud-card lud-card-err"
            data-testid="error-message"
            role="alert"
            onMouseEnter={() => s.setCardHovered(true)}
            onMouseLeave={() => s.setCardHovered(false)}
            style={{ '--from-y': `${mouth.y}px` } as CSSProperties}
          >
            <FileGlyph ext={firstItem?.ext ?? ''} />
            <span className="lud-card-text">
              <strong>*cough* *cough*</strong>
              <span>{model.message}</span>
            </span>
          </div>
        )}

        {model.state === 'idle' && idleExtra}
      </div>
    </div>
  )
}
