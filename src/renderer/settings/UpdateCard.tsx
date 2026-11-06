// Settings → Updates (TPM D29). Two pieces:
// - UpdateBanner, at the top of Settings: a soft update the user has not put off ("Download" / "Later"),
//   or a forced update (red, no "Later").
// - UpdateCard, lower down: "You're up to date (v0.1.0)" / "v0.2.0 is available" + "Check for updates".
// The renderer never sees a download URL: "Download" asks main to open this computer's download.
import { useCallback, useState } from 'react'
import {
  formatReleaseDate,
  showsUpdateBanner,
  UPDATE_MESSAGES,
  type UpdateCheckResult,
  type UpdateView,
  versionLabel
} from '../../shared/update'
import { call } from '../common/lud'

const download = (): void => void call('openUpdateDownload', undefined)

export function UpdateBanner({ view, onView }: { view: UpdateView | null; onView(v: UpdateView): void }) {
  if (!view || !showsUpdateBanner(view)) return null
  const required = view.status === 'required'
  const date = formatReleaseDate(view.releasedAt)
  const later = async (): Promise<void> => {
    const v = await call('dismissUpdate', null as unknown as UpdateView)
    if (v) onView(v)
  }
  return (
    <section
      className={`set-card set-update-banner${required ? ' is-required' : ' is-available'}`}
      data-testid="update-banner"
      data-update-status={view.status}
      aria-labelledby="update-banner-title"
      role={required ? 'alert' : 'status'}
    >
      <div className="set-update-head">
        <span className="set-update-badge" aria-hidden>
          {required ? '!' : '★'}
        </span>
        <div className="set-update-titles">
          <h2 id="update-banner-title">{required ? 'Update required' : UPDATE_MESSAGES.availableTitle(view.latestVersion)}</h2>
          {!required && date && <span className="set-small">Released {date}</span>}
        </div>
      </div>
      {required && (
        <p className="set-update-why" data-testid="update-required-text">
          {UPDATE_MESSAGES.requiredBanner(view.currentVersion, view.latestVersion)}
        </p>
      )}
      {view.notes.length > 0 && (
        <ul className="set-update-notes" data-testid="update-notes">
          {view.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      <div className="set-update-actions">
        <button type="button" className={`lud-btn${required ? ' lud-btn-danger' : ''}`} data-testid="update-download" onClick={download}>
          Download {versionLabel(view.latestVersion)}
        </button>
        {!required && (
          <button type="button" className="lud-btn lud-btn-ghost" data-testid="update-later" onClick={() => void later()}>
            Later
          </button>
        )}
      </div>
      <p className="set-small set-update-howto">{UPDATE_MESSAGES.howTo}</p>
    </section>
  )
}

type Check = null | 'checking' | 'failed'

export function UpdateCard({ view, onView }: { view: UpdateView | null; onView(v: UpdateView): void }) {
  const [check, setCheck] = useState<Check>(null)
  const status = view?.status ?? 'current'
  const checkNow = useCallback(async () => {
    setCheck('checking')
    const r = await call('checkForUpdates', null as unknown as UpdateCheckResult)
    if (r?.view) onView(r.view)
    setCheck(r?.ok ? null : 'failed')
  }, [onView])

  let line: string
  if (!view) line = ''
  else if (status === 'current') line = UPDATE_MESSAGES.upToDate(view.currentVersion)
  else if (status === 'available') line = UPDATE_MESSAGES.availableLine(view.latestVersion)
  else line = `Update required: ${versionLabel(view.latestVersion)} is waiting.`

  return (
    <section className="set-card set-updates" data-testid="update-card" data-update-status={status} aria-labelledby="updates-title">
      <h2 id="updates-title">Updates</h2>
      <div className="set-row set-row-plain">
        <span className="set-text">
          <strong data-testid="update-status-text">{line}</strong>
          <small>
            {check === 'checking' ? UPDATE_MESSAGES.checking : 'We check our website now and then and tell you here.'}
          </small>
        </span>
        {status !== 'current' && showsUpdateBanner(view) === false && (
          <button type="button" className="lud-btn lud-btn-small" data-testid="update-card-download" onClick={download}>
            Download
          </button>
        )}
        <button
          type="button"
          className="lud-btn lud-btn-ghost lud-btn-small"
          data-testid="update-check"
          disabled={check === 'checking'}
          onClick={() => void checkNow()}
        >
          {check === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>
      </div>
      {check === 'failed' && (
        <p className="set-small set-update-failed" data-testid="update-check-failed" role="status">
          {UPDATE_MESSAGES.checkFailed}
        </p>
      )}
    </section>
  )
}
