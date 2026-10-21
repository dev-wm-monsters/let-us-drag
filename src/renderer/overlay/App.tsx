// Overlay window: transparent, always-on-top, placed under the cursor by main while armed.
// Invisible "sensor" until a real file dragenter; then the Uncle pops in within one frame.
import { useEffect, useState } from 'react'
import { Stage } from '../common/Stage'
import { DEFAULT_RING, type RingGeometry, usePrefersReducedMotion, useUncleSession } from '../common/useUncleSession'

/** Fit the ring into the window: radius ~190 px when the window is large enough. */
export function overlayRing(w: number, h: number): RingGeometry {
  const radius = Math.max(120, Math.min(DEFAULT_RING.radius, Math.min(w, h) / 2 - 58))
  return { radius, hitRadius: DEFAULT_RING.hitRadius, mouthRadius: Math.round(radius * 0.52) }
}

function useWindowSize() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return size
}

export function OverlayApp() {
  const { w, h } = useWindowSize()
  const ring = overlayRing(w, h)
  const s = useUncleSession('overlay', ring)
  const reduced = usePrefersReducedMotion()
  const uncleWidth = Math.round(Math.min(250, ring.radius * 1.3))
  return <Stage s={s} testId="overlay-root" uncleWidth={uncleWidth} ring={ring} reducedMotion={reduced} />
}
