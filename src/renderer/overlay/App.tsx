// Overlay window: transparent, always-on-top, placed under the cursor by main while armed.
// Invisible "sensor" until a real file dragenter; then the Uncle pops in within one frame.
import { useEffect, useState } from 'react'
import { Stage } from '../common/Stage'
import { overlayRing, uncleWidthFor } from '../common/layout'
import { usePrefersReducedMotion, useUncleSession } from '../common/useUncleSession'

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
  const uncleWidth = uncleWidthFor(ring.radius, 250)
  return <Stage s={s} testId="overlay-root" uncleWidth={uncleWidth} ring={ring} reducedMotion={reduced} />
}
