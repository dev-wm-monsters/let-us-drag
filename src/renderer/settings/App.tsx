// Settings + onboarding window.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PlatformStatus, Settings, TriggerKey } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import type { Point } from '../common/geometry'
import { call, subscribe } from '../common/lud'
import { createSoundPlayer } from '../common/sounds'
import { Uncle } from '../common/uncle/Uncle'
import { usePrefersReducedMotion } from '../common/useUncleSession'
import { gestureMessage, type Platform, triggerKeyLabels } from './labels'

interface ToggleProps {
  k: 'sounds' | 'hungryMode' | 'plainMode' | 'launchAtLogin'
  label: string
  desc: string
  value: boolean
  onChange(k: ToggleProps['k'], v: boolean): void
  extra?: React.ReactNode
}

function Toggle({ k, label, desc, value, onChange, extra }: ToggleProps) {
  return (
    <label className="set-row">
      <span className="set-text">
        <strong>{label}</strong>
        <small>{desc}</small>
      </span>
      {extra}
      <input
        type="checkbox"
        role="switch"
        className="set-switch"
        data-testid={`setting-${k}`}
        checked={value}
        onChange={(e) => onChange(k, e.currentTarget.checked)}
      />
    </label>
  )
}

export function SettingsApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [status, setStatus] = useState<PlatformStatus | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [asking, setAsking] = useState(false)
  const reduced = usePrefersReducedMotion()
  const lookRef = useRef<Point | null>(null)
  const sounds = useMemo(() => createSoundPlayer({ enabled: true }), [])

  const refreshStatus = useCallback(async () => {
    const st = await call('getPlatformStatus', null as unknown as PlatformStatus)
    if (st) setStatus(st)
  }, [])

  useEffect(() => {
    let alive = true
    void call('getSettings', null as unknown as Settings).then((s) => {
      if (!alive) return
      if (s) setSettings(s)
      setLoaded(true)
    })
    void refreshStatus()
    const off = subscribe('onSettingsChanged', (s) => setSettings(s))
    const onFocus = () => void refreshStatus()
    window.addEventListener('focus', onFocus)
    const onMove = (e: MouseEvent) => {
      lookRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      alive = false
      off()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('mousemove', onMove)
    }
  }, [refreshStatus])

  const patch = useCallback(async (p: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...p }))
    const next = await call('setSettings', null as unknown as Settings, p)
    if (next) setSettings(next)
  }, [])

  const onToggle = useCallback((k: ToggleProps['k'], v: boolean) => void patch({ [k]: v }), [patch])
  const platform: Platform = status?.platform ?? 'linux'
  const labels = triggerKeyLabels(platform)
  const gesture = gestureMessage(status)
  const showA11y = platform === 'darwin'

  return (
    <div className="settings" data-testid="settings-root" data-loaded={loaded ? 'true' : 'false'}>
      <header className="set-head">
        <div className="set-uncle" aria-hidden>
          <Uncle mood="idle" mods={{ hamster: false, struggle: false }} width={110} lookRef={lookRef} reducedMotion={reduced} seed={3} />
        </div>
        <div>
          <h1>
            Let us drag<span>!</span>
          </h1>
          <p>Drag a file, hold {labels[settings.triggerKey]}, and feed it to the Uncle.</p>
        </div>
      </header>

      {loaded && !settings.firstRunDone && (
        <section className="set-card set-welcome" data-testid="onboarding">
          <h2>Welcome! Here's the trick:</h2>
          <ol>
            <li>
              Start dragging any file (from your desktop or a folder).
            </li>
            <li>
              While dragging, hold <kbd>{labels[settings.triggerKey]}</kbd> — the Uncle pops up, mouth open.
            </li>
            <li>Drop the file on what you want: PNG, MP3, PDF… He chews and spits the result next to the original.</li>
          </ol>
          <p className="set-small">Everything happens on your computer. Nothing is uploaded.</p>
          <button type="button" className="lud-btn" data-testid="onboarding-done" onClick={() => void patch({ firstRunDone: true })}>
            Got it!
          </button>
        </section>
      )}

      <section className="set-card">
        <h2>Gesture</h2>
        <label className="set-row">
          <span className="set-text">
            <strong>Trigger key</strong>
            <small>Hold it while dragging a file to summon the Uncle.</small>
          </span>
          <select
            className="set-select"
            data-testid="setting-triggerKey"
            value={settings.triggerKey}
            onChange={(e) => void patch({ triggerKey: e.currentTarget.value as TriggerKey })}
          >
            {(Object.keys(labels) as TriggerKey[]).map((k) => (
              <option key={k} value={k}>
                {labels[k]}
              </option>
            ))}
          </select>
        </label>
        <div className={`set-status${gesture.ok ? ' is-ok' : ' is-warn'}`} data-testid="platform-status">
          <span className="set-dot" />
          <span>{gesture.text}</span>
        </div>
        {showA11y && (
          <div className="set-a11y" data-testid="accessibility-section">
            <p>
              <strong>Why Accessibility?</strong> macOS only lets apps notice a drag + key press anywhere on screen when
              you allow it in <em>System Settings → Privacy &amp; Security → Accessibility</em>. The app never reads
              your keystrokes for anything else.
            </p>
            {status?.accessibilityTrusted ? (
              <p className="set-ok">Access granted. Thank you!</p>
            ) : (
              <button
                type="button"
                className="lud-btn"
                data-testid="grant-accessibility"
                disabled={asking}
                onClick={async () => {
                  setAsking(true)
                  await call('requestAccessibility', false)
                  await refreshStatus()
                  setAsking(false)
                }}
              >
                Grant access…
              </button>
            )}
          </div>
        )}
        <div className="set-row set-row-plain">
          <span className="set-text">
            <strong>Feed Window</strong>
            <small>A little window you can drop files on. Always works, on every system.</small>
          </span>
          <button type="button" className="lud-btn lud-btn-ghost" data-testid="open-feed-window" onClick={() => void call('openFeedWindow', undefined)}>
            Open Feed Window
          </button>
        </div>
      </section>

      <section className="set-card">
        <h2>The Uncle</h2>
        <Toggle
          k="sounds"
          label="Sounds"
          desc="Pops, gulps, crunches and the occasional burp."
          value={settings.sounds}
          onChange={onToggle}
          extra={
            <button type="button" className="lud-btn lud-btn-small" data-testid="test-sound" onClick={() => sounds.play('gulp')}>
              Test
            </button>
          }
        />
        <Toggle
          k="hungryMode"
          label="Hungry Mode"
          desc="Instant gulp — no minimum chewing time."
          value={settings.hungryMode}
          onChange={onToggle}
        />
        <Toggle
          k="plainMode"
          label="Plain Mode"
          desc="No character, just a simple ring of options."
          value={settings.plainMode}
          onChange={onToggle}
        />
        <Toggle
          k="launchAtLogin"
          label="Launch at login"
          desc="Start quietly in the menu bar / tray when you log in."
          value={settings.launchAtLogin}
          onChange={onToggle}
        />
      </section>
      <footer className="set-foot">Free &amp; open source · Local only · v0.1</footer>
    </div>
  )
}
