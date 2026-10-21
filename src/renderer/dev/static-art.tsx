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
 * Tray glyph: a simple silhouette (bald head + glasses + moustache + open mouth) in one colour.
 * `color` = '#000' for macOS template images.
 */
export function renderTraySvg(size: number, color: string, colored = false): string {
  const fg = colored ? '#2b1a14' : color
  const skin = colored ? '#f6c39b' : 'none'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <g fill="none" stroke="${fg}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M16 2.5 C 24 2.5 28.5 7.5 28.5 14.5 C 28.5 22 23.5 29.5 16 29.5 C 8.5 29.5 3.5 22 3.5 14.5 C 3.5 7.5 8 2.5 16 2.5 Z" fill="${skin}" stroke-width="2.4"/>
  </g>
  <g fill="${fg}">
    <circle cx="11" cy="12" r="3.6"/><circle cx="21" cy="12" r="3.6"/>
    <rect x="13.5" y="11" width="5" height="1.6" rx="0.8"/>
    <path d="M7 18.5 C 10 16 13.5 16.2 16 17.6 C 18.5 16.2 22 16 25 18.5 C 23 19.6 20.5 19.4 19 18.9 C 18.5 24.5 13.5 24.5 13 18.9 C 11.5 19.4 9 19.6 7 18.5 Z"/>
  </g>
  ${colored ? '<circle cx="11" cy="12" r="1.7" fill="#fff"/><circle cx="21" cy="12" r="1.7" fill="#fff"/><path d="M14 20.3 Q16 22.6 18 20.3 Z" fill="#f0707e"/>' : '<circle cx="11" cy="12" r="1.7" fill="#000" style="mix-blend-mode:destination-out"/>'}
</svg>`
}
