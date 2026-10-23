// A drawn (SVG file) character driven by the Uncle's brain. One requestAnimationFrame loop writes
// transforms straight into the inlined drawings' data-part groups (no React re-render per frame).
// Both drawings (idle = mouth closed, eat = mouth open) are in the DOM; only one is visible.
import { useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react'
import type { CharacterArt } from '../../characters'
import type { Point } from '../geometry'
import { createBrain, step } from '../uncle/pose'
import { VIEWBOX } from '../uncle/UncleSvg'
import type { UncleProps } from '../uncle/Uncle'
import { blinkAmount, type Box, compose, lidTransform, mouthOpen, partTransforms, prefixIds, RIG_PARTS, rootAttrs } from './rig'

interface Bound {
  el: SVGGraphicsElement
  own: string | null
  last: string
}

interface Layer {
  g: SVGGElement
  parts: Map<string, Bound[]>
  lids: { el: Bound; lid: Box; eye: Box }[]
}

const inner = (svg: string): string => svg.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')

function bindLayer(g: SVGGElement): Layer {
  const parts = new Map<string, Bound[]>()
  for (const name of RIG_PARTS) {
    const list: Bound[] = []
    g.querySelectorAll<SVGGraphicsElement>(`[data-part="${name}"]`).forEach((el) => {
      list.push({ el, own: el.getAttribute('transform'), last: '' })
    })
    if (list.length) parts.set(name, list)
  }
  const lids: Layer['lids'] = []
  for (const side of ['L', 'R'] as const) {
    const lid = parts.get(`lid${side}`)?.[0]
    const eye = g.querySelector<SVGGraphicsElement>(`[data-part="eye${side}"]`)
    if (!lid || !eye) continue
    try {
      const lb = lid.el.getBBox()
      const eb = eye.getBBox()
      lids.push({ el: lid, lid: { y: lb.y, height: lb.height }, eye: { y: eb.y, height: eb.height } })
    } catch {
      // Not rendered (e.g. detached): no blink.
    }
  }
  return { g, parts, lids }
}

function write(b: Bound, dynamic: string): void {
  const v = compose(dynamic, b.own)
  if (v === b.last) return
  b.last = v
  if (v) b.el.setAttribute('transform', v)
  else b.el.removeAttribute('transform')
}

export interface DrawnCharacterProps extends UncleProps {
  art: CharacterArt
}

export function DrawnCharacter(props: DrawnCharacterProps) {
  const { art, mood, mods, width, lookRef, reducedMotion, onChewBeat, paused, seed } = props
  const uid = 'c' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const svgRef = useRef<SVGSVGElement | null>(null)
  const rootRef = useRef<SVGGElement | null>(null)
  const idleRef = useRef<SVGGElement | null>(null)
  const eatRef = useRef<SVGGElement | null>(null)
  const html = useMemo(
    () => ({ idle: { __html: prefixIds(inner(art.idle), `${uid}-i`) }, eat: { __html: prefixIds(inner(art.eat), `${uid}-e`) } }),
    [art, uid]
  )

  const live = useRef({ mood, moodStart: 0, mods, reducedMotion, onChewBeat })
  const moodRef = useRef<typeof mood | null>(null)
  if (moodRef.current !== mood) {
    moodRef.current = mood
    live.current.moodStart = performance.now() / 1000
  }
  live.current.mood = mood
  live.current.mods = mods
  live.current.reducedMotion = reducedMotion
  live.current.onChewBeat = onChewBeat

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

  useLayoutEffect(() => {
    if (paused || !idleRef.current || !eatRef.current || !rootRef.current) return
    if (svgRef.current) rect.current = svgRef.current.getBoundingClientRect()
    const layers = { idle: bindLayer(idleRef.current), eat: bindLayer(eatRef.current) }
    const root = rootRef.current
    const brain = createBrain(seed ?? 7)
    let raf = 0
    let last = performance.now() / 1000
    let shown: 'idle' | 'eat' | null = null
    let rootLast = ''
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
      const moodT = Math.max(0, now - L.moodStart)
      const { pose } = step(brain, { t: now, dt, mood: L.mood, moodT, target, mods: L.mods, reduced: L.reducedMotion })
      const open = mouthOpen(L.mood, moodT, L.mods, L.reducedMotion)
      const want = open ? 'eat' : 'idle'
      if (want !== shown) {
        // A chew "crunch" = the mouth closing while chewing.
        if (shown === 'eat' && L.mood === 'chew') L.onChewBeat?.()
        layers.idle.g.setAttribute('visibility', open ? 'hidden' : 'visible')
        layers.eat.g.setAttribute('visibility', open ? 'visible' : 'hidden')
        shown = want
      }
      const ra = rootAttrs(pose)
      const rs = ra.transform + ra.opacity
      if (rs !== rootLast) {
        root.setAttribute('transform', ra.transform)
        root.setAttribute('opacity', ra.opacity)
        rootLast = rs
      }
      const xf = partTransforms(pose)
      const layer = layers[want]
      for (const [name, list] of layer.parts) {
        const dyn = (xf as Record<string, string | undefined>)[name]
        if (dyn === undefined) continue
        for (const b of list) write(b, dyn)
      }
      const blink = blinkAmount(pose.lid)
      for (const l of layer.lids) write(l.el, lidTransform(blink, l.lid, l.eye))
      raf = requestAnimationFrame(frame)
    }
    frame(performance.now())
    return () => cancelAnimationFrame(raf)
  }, [paused, seed, lookRef, html])

  const height = (width * VIEWBOX.h) / VIEWBOX.w
  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.w} ${VIEWBOX.h}`}
      width={width}
      height={height}
      role="img"
      aria-label={art.id}
      style={{ overflow: 'visible' }}
      data-character-art={art.id}
    >
      <g ref={rootRef}>
        <g transform={`scale(${art.scale})`}>
          <g ref={idleRef} data-pose="idle" dangerouslySetInnerHTML={html.idle} />
          <g ref={eatRef} data-pose="eat" visibility="hidden" dangerouslySetInnerHTML={html.eat} />
        </g>
      </g>
    </svg>
  )
}
