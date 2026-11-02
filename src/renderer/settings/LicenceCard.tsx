// Settings → Licence (TPM D26): state, masked key, Activate, Buy a licence, Deactivate this computer.
// The renderer only sees the LicenceView; activation and deactivation run in main.
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { LICENCE_PRICE, lockedExplanation, type LicenceActionResult, type LicenceView } from '../../shared/licence'
import { call } from '../common/lud'
import { licenceStatusLabel, licenceSummary } from './labels'

type Busy = null | 'activate' | 'deactivate'

interface Note {
  ok: boolean
  text: string
}

const FAILED: Note = { ok: false, text: 'Something went wrong. Please try again.' }

export function LicenceCard({ view, onView }: { view: LicenceView | null; onView(v: LicenceView): void }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [confirming, setConfirming] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const status = view?.status ?? 'unlicensed'
  const active = status === 'active'
  const pill = licenceStatusLabel(status)
  const summary = view ? licenceSummary(view) : ''
  const explanation = status === 'disabled' || status === 'reactivate' ? lockedExplanation(status) : null
  const hasKey = !!view?.maskedKey

  // "I have a key" opens this window: put the cursor in the field.
  const focused = useRef(false)
  useEffect(() => {
    if (!view || active || focused.current) return
    focused.current = true
    inputRef.current?.focus()
  }, [view, active])

  const apply = useCallback(
    (r: LicenceActionResult | null) => {
      if (!r) {
        setNote(FAILED)
        return
      }
      onView(r.view)
      setNote({ ok: r.ok, text: r.message })
      if (r.ok) setKey('')
    },
    [onView]
  )

  const activate = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault()
      if (busy) return
      setBusy('activate')
      setNote(null)
      apply(await call('activateLicence', null as unknown as LicenceActionResult, key))
      setBusy(null)
    },
    [apply, busy, key]
  )

  const deactivate = useCallback(async () => {
    setConfirming(false)
    if (busy) return
    setBusy('deactivate')
    setNote(null)
    apply(await call('deactivateLicence', null as unknown as LicenceActionResult))
    setBusy(null)
  }, [apply, busy])

  const buy = () => void call('openLicenceLink', undefined, 'checkout')

  return (
    <section className={`set-card set-licence is-${status}`} data-testid="licence-card" data-licence-status={status} aria-labelledby="licence-title">
      <div className="set-licence-head">
        <h2 id="licence-title">Licence</h2>
        {view?.testMode && (
          <span className="set-tag" title="Built for Dodo Payments test mode">
            Test mode
          </span>
        )}
        <span className={`set-pill is-${pill.tone}`} data-testid="licence-status">
          {pill.text}
        </span>
      </div>

      {hasKey && (
        <p className="set-licence-key">
          Key <code data-testid="licence-masked-key">{view?.maskedKey}</code>
        </p>
      )}
      {summary && <p className="set-small set-licence-summary">{summary}</p>}
      {explanation && (
        <p className={`set-licence-why${status === 'disabled' ? ' is-bad' : ''}`} data-testid="licence-explanation">
          {explanation}
        </p>
      )}

      {!active && (
        <form className="set-licence-form" onSubmit={(e) => void activate(e)}>
          <label className="set-licence-label" htmlFor="licence-key">
            {status === 'reactivate' ? 'Activate again (or paste another key)' : 'Activate'}
          </label>
          <div className="set-licence-row">
            <input
              ref={inputRef}
              id="licence-key"
              className="set-input"
              data-testid="licence-key"
              type="text"
              placeholder="Paste your licence key"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={key}
              disabled={busy !== null}
              onChange={(e) => setKey(e.currentTarget.value)}
            />
            <button
              type="submit"
              className="lud-btn"
              data-testid="licence-activate"
              disabled={busy !== null || (key.trim() === '' && status !== 'reactivate')}
            >
              {busy === 'activate' ? 'Activating…' : status === 'reactivate' && key.trim() === '' ? 'Activate again' : 'Activate'}
            </button>
          </div>
        </form>
      )}

      {note && (
        <p className={`set-licence-note${note.ok ? ' is-ok' : ' is-bad'}`} data-testid="licence-message" role={note.ok ? 'status' : 'alert'}>
          {note.text}
        </p>
      )}

      <div className="set-licence-actions">
        {!active && (
          <button type="button" className="lud-btn lud-btn-ghost" data-testid="licence-buy" onClick={buy}>
            Buy a licence ({LICENCE_PRICE})
          </button>
        )}
        {hasKey && (
          <button
            type="button"
            className="lud-btn lud-btn-ghost lud-btn-quiet"
            data-testid="licence-deactivate"
            disabled={busy !== null}
            onClick={() => setConfirming(true)}
          >
            {busy === 'deactivate' ? 'Deactivating…' : 'Deactivate this computer'}
          </button>
        )}
      </div>
      <p className="set-small set-licence-links">
        <button type="button" className="set-link" onClick={() => void call('openLicenceLink', undefined, 'refund')}>
          7-day refunds
        </button>
        {' · '}
        <button type="button" className="set-link" onClick={() => void call('openLicenceLink', undefined, 'terms')}>
          Terms
        </button>
        {' · '}
        <button type="button" className="set-link" onClick={() => void call('openLicenceLink', undefined, 'privacy')}>
          Privacy
        </button>
      </p>

      {confirming && (
        <div className="set-dialog-backdrop" onClick={() => setConfirming(false)}>
          <div
            className="set-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="deactivate-title"
            data-testid="deactivate-dialog"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setConfirming(false)
            }}
          >
            <h3 id="deactivate-title">Deactivate this computer?</h3>
            <p>
              Let's Drag! stops converting files here until you activate it again. Your key keeps working, and the seat is
              freed for another computer. This needs the internet.
            </p>
            <div className="set-dialog-actions">
              <button type="button" className="lud-btn lud-btn-ghost" data-testid="deactivate-cancel" autoFocus onClick={() => setConfirming(false)}>
                Keep it
              </button>
              <button type="button" className="lud-btn lud-btn-danger" data-testid="deactivate-confirm" onClick={() => void deactivate()}>
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
