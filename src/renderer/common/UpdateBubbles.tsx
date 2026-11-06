// Update notices on the Uncle's stage (TPM D29): the forced-update lock bubble ("Please update me" +
// Download) and the once-per-version soft-update hint ("I learned new tricks!"). Shared by the overlay
// and the Feed Window; rendered by Stage.tsx.
import type { CSSProperties } from 'react'
import { UPDATE_MESSAGES, versionLabel } from '../../shared/update'
import { INTERACTIVE_ATTR } from './useUncleSession'

/**
 * Where the round Download bubble sits on the ring (degrees, 0 = right, 90 = down): straight below the
 * small overlay Uncle; lower right in the Feed Window, where the big Uncle fills the space below
 * (the unlock bubble's "I have a key" spot).
 */
export const UPDATE_DOWNLOAD_ANGLE = { overlay: 90, feed: 58 } as const

/**
 * Forced update (D29), in the style of the unlock bubble (D26): a big speech bubble above the Uncle
 * and one round "Download" bubble below him. × / Esc close it (the overlay; the Feed Window rests on it).
 */
export function UpdatePanel({
  host,
  latest,
  radius,
  headTopY,
  closable,
  onDownload,
  onClose,
  onOver
}: {
  host: 'overlay' | 'feed'
  latest: string | null
  radius: number
  headTopY: number
  closable: boolean
  onDownload(): void
  onClose(): void
  onOver(on: boolean): void
}) {
  const a = (UPDATE_DOWNLOAD_ANGLE[host] * Math.PI) / 180
  const at = { '--x': `${Math.round(Math.cos(a) * radius)}px`, '--y': `${Math.round(Math.sin(a) * radius)}px` } as CSSProperties
  const hover = { onPointerEnter: () => onOver(true), onPointerLeave: () => onOver(false), [INTERACTIVE_ATTR]: '' }
  return (
    <div className="lud-unlock lud-update" data-testid="update-panel">
      <div className="lud-unlock-say is-update" style={{ top: headTopY - 6 }} data-testid="update-bubble" role="status" {...hover}>
        <strong>{UPDATE_MESSAGES.requiredTitle}</strong>
        <span data-testid="update-explanation">{UPDATE_MESSAGES.requiredBubble(latest)}</span>
        {closable && (
          <button type="button" className="lud-unlock-close" data-testid="update-close" title="Close (Esc)" aria-label="Close" onClick={onClose}>
            <span aria-hidden>✕</span>
          </button>
        )}
      </div>
      <button
        type="button"
        className="lud-unlock-btn is-primary is-download"
        style={at}
        data-testid="update-download"
        aria-label={`Download ${latest ? versionLabel(latest) : 'the update'} from our website`}
        onClick={onDownload}
        {...hover}
      >
        <span className="lud-unlock-btn-bubble">
          <span className="lud-unlock-btn-label">
            Download
            {latest && <small>{versionLabel(latest)}</small>}
          </span>
        </span>
      </button>
    </div>
  )
}

/** Soft update (D29): a small, click-through note under the ring. Never blocks a drop or a conversion. */
export function UpdateHint({ top }: { top: number }) {
  return (
    <div className="lud-update-hint" style={{ top }} data-testid="update-hint" role="status">
      <span className="lud-update-hint-star" aria-hidden>
        ★
      </span>
      {UPDATE_MESSAGES.hint}
    </div>
  )
}
