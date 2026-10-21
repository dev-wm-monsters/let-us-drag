// Static (server-side) renders of the Uncle for icons and quick art reviews.
// Loaded by src/renderer/dev/render-art.mjs through Vite's ssrLoadModule (never shipped in the app).
import { renderToStaticMarkup } from 'react-dom/server'
import type { Point } from '../common/geometry'
import { poseAttrs } from '../common/uncle/attrs'
import { type Modifiers, type Mood, settle } from '../common/uncle/pose'
import { UncleSvg } from '../common/uncle/UncleSvg'

export interface StaticUncleOptions {
  mood: Mood
  seconds?: number
  target?: Point | null
  mods?: Modifiers
  width?: number
}

export function renderUncleSvg(o: StaticUncleOptions): string {
  const pose = settle(o.mood, o.seconds ?? 0.6, o.target ?? null, o.mods)
  return renderToStaticMarkup(<UncleSvg attrs={poseAttrs(pose)} uid="s" width={o.width ?? 512} />)
}

/** App icon: the Uncle's face, mouth wide open, on a warm rounded square (1024×1024). */
export function renderIconSvg(): string {
  const pose = settle('appear', 0.9, { x: 0, y: 40 })
  const face = renderToStaticMarkup(<UncleSvg attrs={poseAttrs(pose)} uid="i" width={350} />)
  const inner = face.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="bg" cx="40%" cy="30%" r="80%">
      <stop offset="0" stop-color="#ffe7a8"/>
      <stop offset="1" stop-color="#ffb347"/>
    </radialGradient>
    <clipPath id="sq"><rect x="64" y="64" width="896" height="896" rx="200"/></clipPath>
  </defs>
  <rect x="72" y="80" width="896" height="896" rx="200" fill="#2b1a14"/>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#bg)"/>
  <g clip-path="url(#sq)">
    <circle cx="512" cy="470" r="380" fill="#fff3c9" opacity="0.55"/>
    <g transform="translate(512 500) scale(2.45)">${inner}</g>
  </g>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="none" stroke="#2b1a14" stroke-width="14"/>
</svg>`
}

/**
 * Tray glyph: a bold, simple Uncle face (bald head, round glasses, moustache, open mouth).
 * Template mode = black + alpha only (macOS menu bar); colored = skin + ink for Windows/Linux trays.
 */
export function renderTraySvg(size: number, colored = false): string {
  const ink = colored ? '#2b1a14' : '#000'
  const skin = colored ? '#f6c39b' : 'none'
  const lens = colored ? '#ffffff' : 'none'
  const mouth = colored ? '#7a1420' : '#000'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <path d="M16 3.2 Q 17 1 19.2 1.8" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="16" cy="17" r="12.6" fill="${skin}" stroke="${ink}" stroke-width="3"/>
  <circle cx="11.2" cy="13.6" r="3.7" fill="${lens}" stroke="${ink}" stroke-width="2.5"/>
  <circle cx="20.8" cy="13.6" r="3.7" fill="${lens}" stroke="${ink}" stroke-width="2.5"/>
  ${colored ? '<circle cx="11.8" cy="14" r="1.5" fill="#2b1a14"/><circle cx="21.4" cy="14" r="1.5" fill="#2b1a14"/>' : ''}
  <path d="M7.5 20.2 C 10.5 17.6 13.6 17.8 16 19 C 18.4 17.8 21.5 17.6 24.5 20.2 C 21.8 21.6 18.8 21.2 16 20.6 C 13.2 21.2 10.2 21.6 7.5 20.2 Z" fill="${ink}" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M12.2 21.6 L 19.8 21.6 Q 19.4 26.6 16 26.6 Q 12.6 26.6 12.2 21.6 Z" fill="${mouth}"/>
  ${colored ? '<path d="M13.6 25 Q 16 23.4 18.4 25 Q 16 26.4 13.6 25 Z" fill="#f0707e"/>' : ''}
</svg>`
}
