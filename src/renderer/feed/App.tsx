// Feed Window: an always-available drop target (fallback for Wayland / denied macOS permission).
// Plain HTML5 drag & drop + a file picker; after the drop it's the same flow as the overlay.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Stage } from '../common/Stage'
import { DEFAULT_RING, type RingGeometry, usePrefersReducedMotion, useUncleSession } from '../common/useUncleSession'
import { isBusy } from '../overlay/state'

export function feedRing(w: number, h: number): RingGeometry {
  const radius = Math.max(108, Math.min(DEFAULT_RING.radius, Math.min(w, h) / 2 - 54))
  return { radius, hitRadius: 42, mouthRadius: Math.round(radius * 0.52) }
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ w: 400, h: 400 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

export function FeedApp() {
  const [zoneRef, size] = useElementSize<HTMLDivElement>()
  const ring = feedRing(size.w, size.h)
  const s = useUncleSession('feed', ring)
  const reduced = usePrefersReducedMotion()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const uncleWidth = Math.round(Math.min(220, ring.radius * 1.22))
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    const on = () => setDragOver(true)
    const off = () => setDragOver(false)
    window.addEventListener('dragenter', on)
    window.addEventListener('drop', off)
    window.addEventListener('dragend', off)
    return () => {
      window.removeEventListener('dragenter', on)
      window.removeEventListener('drop', off)
      window.removeEventListener('dragend', off)
    }
  }, [])
  useEffect(() => {
    if (s.model.state === 'idle') setDragOver(false)
  }, [s.model.state])

  const busy = isBusy(s.model)
  return (
    <div className="feed">
      <header className="feed-head">
        <h1>
          Let us drag<span>!</span>
        </h1>
        <p>Feed me a file. I'll cook it right next to the original.</p>
      </header>
      <div
        ref={zoneRef}
        className={`feed-zone${dragOver ? ' is-over' : ''}`}
        data-testid="feed-dropzone"
        aria-label="Drop files here"
      >
        <Stage s={s} testId="feed-root" uncleWidth={uncleWidth} ring={ring} reducedMotion={reduced} />
      </div>
      <footer className="feed-foot">
        <button
          type="button"
          className="lud-btn"
          data-testid="feed-pick"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          Choose a file…
        </button>
        <span className="feed-note">Nothing leaves your computer.</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? [])
            e.currentTarget.value = ''
            s.feedFiles(files)
          }}
        />
      </footer>
    </div>
  )
}
