// Animated Uncle: one requestAnimationFrame loop writes pose attributes straight into the SVG
// (no React re-render per frame, transforms/paths only, no layout reads inside the loop).
import { type RefObject, useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react'
import type { Point } from '../geometry'
import { type Attrs, PART_KEYS, type PartKey, poseAttrs } from './attrs'
import { createBrain, type Modifiers, type Mood, settle, step } from './pose'
import { UncleSvg, VIEWBOX } from './UncleSvg'

export interface UncleProps {
  mood: Mood
  mods: Modifiers
  /** Rendered width in CSS px. */
  width: number
  /** Look target in client (viewport) coordinates; null = idle wander. Read every frame. */
  lookRef: RefObject<Point | null>
  reducedMotion: boolean
  /** Called on every chew "crunch" (jaw closing) while chewing. */
  onChewBeat?: () => void
  /** Pause the animation loop (e.g. while the overlay is hidden). */
  paused?: boolean
  seed?: number
}

export function Uncle(props: UncleProps) {
  const { mood, mods, width, lookRef, reducedMotion, onChewBeat, paused, seed } = props
  const uid = 'u' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const svgRef = useRef<SVGSVGElement | null>(null)
  const els = useRef<Partial<Record<PartKey, SVGElement>>>({})
  const refFns = useMemo(() => {
    const m = {} as Record<PartKey, (el: SVGElement | null) => void>
    for (const k of PART_KEYS) {
      m[k] = (el) => {
        if (el) els.current[k] = el
        else delete els.current[k]
      }
    }
    return m
  }, [])
  // Initial attributes: a settled idle pose (never changes, so React never fights the rAF loop).
  const initial = useMemo(() => poseAttrs(settle('idle', 0.5, null)), [])

  // Live inputs read by the loop.
  const live = useRef({ mood, moodStart: 0, mods, reducedMotion, onChewBeat })
  const moodRef = useRef<Mood | null>(null)
  if (moodRef.current !== mood) {
    moodRef.current = mood
    live.current.moodStart = performance.now() / 1000
  }
  live.current.mood = mood
  live.current.mods = mods
  live.current.reducedMotion = reducedMotion
  live.current.onChewBeat = onChewBeat

  // Cached SVG rect (refreshed on resize/scroll and when the mood changes — never inside the loop).
  const rect = useRef<DOMRect | null>(null)
  useEffect(() => {
    const update = () => {
      if (svgRef.current) rect.current = svgRef.current.getBoundingClientRect()
    }
    update()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    if (ro && svgRef.current) ro.observe(svgRef.current)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [])
  useEffect(() => {
    if (svgRef.current) rect.current = svgRef.current.getBoundingClientRect()
  }, [mood, width])

  // Layout effect + one synchronous frame: the very first painted frame after engagement already
  // shows the correct pose (no stale frame), so the Uncle is visible within one frame.
  useLayoutEffect(() => {
    if (paused) return
    if (svgRef.current) rect.current = svgRef.current.getBoundingClientRect()
    const brain = createBrain(seed ?? 7)
    let raf = 0
    let last = performance.now() / 1000
    const prev: Partial<Record<PartKey, Attrs>> = {}
    const frame = (nowMs: number) => {
      const now = nowMs / 1000
      const dt = Math.min(0.1, Math.max(0, now - last))
      last = now
      const L = live.current
      let target: Point | null = null
      const look = lookRef.current
      const r = rect.current
      if (look && r && r.width > 0) {
        target = {
          x: VIEWBOX.x + ((look.x - r.left) / r.width) * VIEWBOX.w,
          y: VIEWBOX.y + ((look.y - r.top) / r.height) * VIEWBOX.h
        }
      }
      const { pose, chewBeat } = step(brain, {
        t: now,
        dt,
        mood: L.mood,
        moodT: Math.max(0, now - L.moodStart),
        target,
        mods: L.mods,
        reduced: L.reducedMotion
      })
      if (chewBeat) L.onChewBeat?.()
      const attrs = poseAttrs(pose)
      for (const k of PART_KEYS) {
        const el = els.current[k]
        if (!el) continue
        const a = attrs[k]
        const p = prev[k]
        for (const name in a) {
          const v = a[name]!
          if (!p || p[name] !== v) el.setAttribute(name, v)
        }
        prev[k] = a
      }
      raf = requestAnimationFrame(frame)
    }
    frame(performance.now())
    return () => cancelAnimationFrame(raf)
  }, [paused, seed, lookRef])

  return <UncleSvg ref={svgRef} attrs={initial} uid={uid} width={width} part={(k) => refFns[k]} />
}
