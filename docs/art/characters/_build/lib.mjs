// Shared drawing kit for the character concepts. Same construction as the Uncle (UncleSvg.tsx):
// every form is a "filled outline shape" — an ink copy (fill + thick stroke, nudged down-right) under
// the colour copy — so lines read thin top-left and heavy bottom-right, like a brush.
// Coordinates: viewBox -200 -200 400 400, origin ≈ centre of the face, y grows downwards.

export const INK = '#2b1a14'
export const OFF = 'translate(1.6 2.2)'
export const VIEWBOX = '-220 -206 440 440'

const r1 = (x) => Math.round(x * 10) / 10
export const P = (x, y) => `${r1(x)},${r1(y)}`

/** Mirror a path horizontally (x → -x). Only for M/L/C/Q paths written as "x,y" pairs (no arcs). */
export function mirror(d) {
  return d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_m, x, y) => `${r1(-Number(x))},${y}`)
}

/** A shape with a variable-weight ink outline (ink copy offset down-right, colour copy on top). */
export function inked(d, fill, w = 8, opt = {}) {
  const off = opt.off ?? OFF
  return `<path d="${d}" fill="${INK}" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" transform="${off}"/><path d="${d}" fill="${fill}"${opt.attr ?? ''}/>`
}
export const fillP = (d, color, attr = '') => `<path d="${d}" fill="${color}"${attr}/>`
export const line = (d, color = INK, w = 3, attr = '') =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${attr}/>`
export const ellD = (cx, cy, rx, ry) =>
  `M ${P(cx - rx, cy)} A ${r1(rx)},${r1(ry)} 0 1 0 ${P(cx + rx, cy)} A ${r1(rx)},${r1(ry)} 0 1 0 ${P(cx - rx, cy)} Z`
export const circle = (cx, cy, r, color, attr = '') => `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${color}"${attr}/>`
export const ell = (cx, cy, rx, ry, color, rot = 0, attr = '') =>
  `<ellipse cx="${r1(cx)}" cy="${r1(cy)}" rx="${r1(rx)}" ry="${r1(ry)}" fill="${color}"${rot ? ` transform="rotate(${rot} ${r1(cx)} ${r1(cy)})"` : ''}${attr}/>`
export const inkedEll = (cx, cy, rx, ry, color, w = 6, rot = 0) =>
  `<g${rot ? ` transform="rotate(${rot} ${r1(cx)} ${r1(cy)})"` : ''}>${inked(ellD(cx, cy, rx, ry), color, w)}</g>`

/** A named, animatable layer: id is unique per document (uid prefix), data-part is the rig name. */
export function part(ctx, name, body, attr = '') {
  return `<g id="${ctx.uid}-${name}" data-part="${name}"${attr}>${body}</g>`
}
export function clip(ctx, name, d) {
  const id = `${ctx.uid}-clip-${name}`
  ctx.defs.push(`<clipPath id="${id}"><path d="${d}"/></clipPath>`)
  return `clip-path="url(#${id})"`
}

// ——— head ———

/**
 * Jowly head silhouette (generalised from the Uncle's headPath). The chin drops with the jaw.
 * T top, W half width at the temples (y = S), JW/JY jowl, C chin, cw chin control, drop = chin drop at jaw 1.
 */
export function headD({ T = -150, W = 112, S = -40, JW = 92, JY = 62, C = 100, cw = 40, crown = 0.6, jaw = 0, drop = 42 }) {
  const J = jaw * drop
  const half = [
    `C ${P(W * crown, T - 1)} ${P(W, T + 40)} ${P(W, S)}`,
    `C ${P(W + 1, S + 46)} ${P(W - 2, JY - 26 + J * 0.4)} ${P(JW, JY + J * 0.7)}`,
    `C ${P(JW * 0.8, JY + 28 + J)} ${P(cw, C + J)} ${P(0, C + J)}`
  ]
  const left = [
    `C ${P(-cw, C + J)} ${P(-JW * 0.8, JY + 28 + J)} ${P(-JW, JY + J * 0.7)}`,
    `C ${P(-W + 2, JY - 26 + J * 0.4)} ${P(-W - 1, S + 46)} ${P(-W, S)}`,
    `C ${P(-W, T + 40)} ${P(-W * crown, T - 1)} ${P(0, T)}`
  ]
  return `M ${P(0, T)} ${half.join(' ')} ${left.join(' ')} Z`
}

/**
 * Cel-shaded head: ink, shadow-tone fill, a lit ellipse up-left (clipped), a forehead shine and
 * editorial hatching on the shadow side.
 */
export function head(ctx, d, skin, { hatch = true, shineY = -112, shineX = -44, litDx = -16, litRx = 118, litRy = 150, litCy = -30, w = 9 } = {}) {
  const c = clip(ctx, 'head', d)
  return [
    `<path d="${d}" fill="${INK}" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" transform="${OFF}"/>`,
    fillP(d, skin.shade),
    `<g ${c}>`,
    ell(litDx, litCy, litRx, litRy, skin.base),
    ell(shineX, shineY, 26, 11, skin.light, -28),
    ell(shineX - 2, shineY - 2, 12, 4.6, '#fff6ec', -28, ' opacity="0.8"'),
    hatch ? line(typeof hatch === 'string' ? hatch : 'M 92,2 l 12,-10 M 95,18 l 12,-10 M 94,34 l 12,-10 M 90,50 l 11,-9', skin.deep, 2.4, ' opacity="0.7"') : '',
    `</g>`
  ].join('')
}

/** Right ear (the left one is mirrored). Attaches at x ≈ ax, centred on y ≈ ay. */
export function ears(ctx, skin, ax = 104, ay = -16, s = 1) {
  const R = `M ${P(ax - 2, ay - 22 * s)} C ${P(ax + 26 * s, ay - 40 * s)} ${P(ax + 48 * s, ay - 8 * s)} ${P(ax + 34 * s, ay + 18 * s)} C ${P(ax + 27 * s, ay + 33 * s)} ${P(ax + 12 * s, ay + 40 * s)} ${P(ax, ay + 32 * s)} Z`
  const inner = `M ${P(ax + 6 * s, ay - 8 * s)} C ${P(ax + 24 * s, ay - 16 * s)} ${P(ax + 32 * s, ay + 6 * s)} ${P(ax + 20 * s, ay + 18 * s)}`
  const shade = `${inner} C ${P(ax + 14 * s, ay + 14 * s)} ${P(ax + 10 * s, ay + 8 * s)} ${P(ax + 6 * s, ay - 8 * s)} Z`
  const one = (dd, ii, ss, off) => inked(dd, skin.base, 8, { off }) + fillP(ss, skin.shade) + line(ii, INK, 3)
  return (
    part(ctx, 'earR', one(R, inner, shade, OFF)) +
    part(ctx, 'earL', one(mirror(R), mirror(inner), mirror(shade), 'translate(-0.6 2.2)'))
  )
}

// ——— eyes ———

/** Upper lid covering the eye from the top; closed 0..1. */
function lidD(cx, cy, rx, ry, c, tilt = 0) {
  const top = cy - ry - 8
  const edge = cy - ry + c * (2 * ry + 2)
  const sag = 4 + c * 3
  return `M ${P(cx - rx - 8, top)} L ${P(cx + rx + 8, top)} L ${P(cx + rx + 8, edge - 2 + tilt)} Q ${P(cx, edge + sag)} ${P(cx - rx - 8, edge - 2 - tilt)} Z`
}
function lidLineD(cx, cy, rx, ry, c, tilt = 0) {
  const edge = cy - ry + c * (2 * ry + 2)
  const sag = 4 + c * 3
  return `M ${P(cx - rx - 2, edge - 1 - tilt)} Q ${P(cx, edge + sag)} ${P(cx + rx + 2, edge - 1 + tilt)}`
}

/** Lower lid pushed up by a smiling cheek (amount 0..1 of the eye height). */
function lowerD(cx, cy, rx, ry, a) {
  const edge = cy + ry - a * ry
  return `M ${P(cx - rx - 8, cy + ry + 8)} L ${P(cx + rx + 8, cy + ry + 8)} L ${P(cx + rx + 8, edge + 4)} Q ${P(cx, edge - 9)} ${P(cx - rx - 8, edge + 4)} Z`
}
function lowerLineD(cx, cy, rx, ry, a) {
  const edge = cy + ry - a * ry
  return `M ${P(cx - rx + 1, edge + 3)} Q ${P(cx, edge - 6.5)} ${P(cx + rx - 1, edge + 3)}`
}

/**
 * One eye: sclera with ink rim, clipped pupil group (moves with `look` -1..1), upper lid.
 * Groups: eyeL|eyeR > scleraL, pupilL, lidL.
 */
export function eye(ctx, side, { cx, cy, rx = 19, ry = 22, pr = 8.5, look = { x: 0, y: 0 }, lid = 0.2, lidFill, iris, tilt = 0, w = 6, sclera = '#fffdf6', smile = 0 }) {
  const S = side
  const d = ellD(cx, cy, rx, ry)
  const c = clip(ctx, `eye${S}`, d)
  const px = cx + look.x * (rx - pr - 3)
  const py = cy + look.y * (ry - pr - 3)
  const pupil =
    (iris ? circle(px, py, pr + 4.5, iris) : '') +
    circle(px, py, pr, INK) +
    circle(px - pr * 0.38, py - pr * 0.42, pr * 0.38, '#fff') +
    circle(px + pr * 0.38, py + pr * 0.4, pr * 0.16, '#fff')
  const t = S === 'L' ? -tilt : tilt
  return part(
    ctx,
    `eye${S}`,
    inked(d, sclera, w) +
      `<g ${c}>` +
      ell(cx + 3, cy + ry * 0.55, rx, ry * 0.5, '#eef0f4', 0, ' opacity="0.9"') +
      part(ctx, `pupil${S}`, pupil) +
      (smile > 0.02 ? part(ctx, `lower${S}`, fillP(lowerD(cx, cy, rx, ry, smile), lidFill) + line(lowerLineD(cx, cy, rx, ry, smile), INK, 3)) : '') +
      (lid > 0.02 ? part(ctx, `lid${S}`, fillP(lidD(cx, cy, rx, ry, lid, t), lidFill) + line(lidLineD(cx, cy, rx, ry, lid, t), INK, 3.4)) : '') +
      `</g>` +
      `<path d="${d}" fill="none" stroke="${INK}" stroke-width="2.6"/>`
  )
}

/** "Happy" closed eye arc (for squinting grins). */
export function happyEye(ctx, side, cx, cy, w = 16) {
  return part(ctx, `eye${side}`, line(`M ${P(cx - w, cy + 6)} Q ${P(cx, cy - 16)} ${P(cx + w, cy + 6)}`, INK, 6))
}

// ——— mouth ———

const MC = { throat: '#5a1119', deep: '#2a050b', tongue: '#f0707e', tongueShade: '#c94557', uvula: '#c23a4b', teeth: '#fffaf0', gold: '#f4c34d' }

export function openMouthD(top, w, bottom, corner, cx = 0) {
  return [
    `M ${P(cx - w, corner)}`,
    `Q ${P(cx, top - 8)} ${P(cx + w, corner)}`,
    `C ${P(cx + w + 6, corner + (bottom - corner) * 0.72)} ${P(cx + w * 0.55, bottom)} ${P(cx, bottom)}`,
    `C ${P(cx - w * 0.55, bottom)} ${P(cx - w - 6, corner + (bottom - corner) * 0.72)} ${P(cx - w, corner)}`,
    'Z'
  ].join(' ')
}

/**
 * Wide-open eating mouth. Groups: mouth > mouthFill, throat, uvula, tongue, lowerTeeth, upperTeeth, mouthLine.
 * o: { top, w, bottom, corner?, cx?, gold?: index of a gold tooth, gap?: missing tooth index, teethColor?, lowerTeeth? }
 */
export function mouthOpen(ctx, o, lipColor) {
  const cx = o.cx ?? 0
  const corner = o.corner ?? o.top + 6
  const d = openMouthD(o.top, o.w, o.bottom, corner, cx)
  const c = clip(ctx, 'mouth', d)
  const depth = o.bottom - o.top
  const teeth = o.teethColor ?? MC.teeth
  const n = o.teethN ?? 6
  const tw = (o.w * 2) / n
  let upper = `<path d="M ${P(cx - o.w - 6, o.top - 14)} L ${P(cx + o.w + 6, o.top - 14)} L ${P(cx + o.w, o.top + 14)} Q ${P(cx, o.top + 22)} ${P(cx - o.w, o.top + 14)} Z" fill="${teeth}" stroke="${INK}" stroke-width="2"/>`
  for (let i = 1; i < n; i++) {
    const x = cx - o.w + i * tw
    upper += line(`M ${P(x, o.top - 6)} L ${P(x, o.top + 17 - Math.abs(i - n / 2) * 1.5)}`, INK, 1.8)
  }
  if (o.gold != null) {
    const x = cx - o.w + o.gold * tw
    upper += `<path d="M ${P(x + 1, o.top - 6)} L ${P(x + tw - 1, o.top - 6)} L ${P(x + tw - 1, o.top + 17)} Q ${P(x + tw / 2, o.top + 20)} ${P(x + 1, o.top + 17)} Z" fill="${MC.gold}" stroke="${INK}" stroke-width="1.8"/>` + line(`M ${P(x + 4, o.top)} L ${P(x + 5, o.top + 10)}`, '#fff4c4', 2.2)
  }
  for (const g of o.gap == null ? [] : [].concat(o.gap)) {
    const x = cx - o.w + g * tw
    upper += `<path d="M ${P(x + 1, o.top - 6)} L ${P(x + tw - 1, o.top - 6)} L ${P(x + tw - 1, o.top + 18)} L ${P(x + 1, o.top + 18)} Z" fill="${MC.throat}"/>`
  }
  const lower =
    o.lowerTeeth === false
      ? ''
      : `<path d="M ${P(cx - o.w * 0.62, o.bottom + 4)} L ${P(cx - o.w * 0.62, o.bottom - 10)} Q ${P(cx - o.w * 0.5, o.bottom - 15)} ${P(cx - o.w * 0.38, o.bottom - 10)} L ${P(cx - o.w * 0.38, o.bottom + 4)} Z M ${P(cx + o.w * 0.3, o.bottom + 4)} L ${P(cx + o.w * 0.3, o.bottom - 11)} Q ${P(cx + o.w * 0.43, o.bottom - 16)} ${P(cx + o.w * 0.56, o.bottom - 11)} L ${P(cx + o.w * 0.56, o.bottom + 4)} Z" fill="${teeth}" stroke="${INK}" stroke-width="1.8"/>`
  const tongue =
    `<path d="M ${P(cx - o.w * 0.9, o.bottom + 6)} C ${P(cx - o.w * 0.9, o.bottom - depth * 0.42)} ${P(cx - o.w * 0.3, o.bottom - depth * 0.5)} ${P(cx, o.bottom - depth * 0.32)} C ${P(cx + o.w * 0.3, o.bottom - depth * 0.5)} ${P(cx + o.w * 0.9, o.bottom - depth * 0.42)} ${P(cx + o.w * 0.9, o.bottom + 6)} Z" fill="${o.tongue ?? MC.tongue}"/>` +
    line(`M ${P(cx, o.bottom - depth * 0.3)} Q ${P(cx + 2, o.bottom - depth * 0.18)} ${P(cx, o.bottom - depth * 0.06)}`, MC.tongueShade, 3) +
    line(`M ${P(cx - o.w * 0.6, o.bottom - depth * 0.3)} Q ${P(cx - o.w * 0.72, o.bottom - depth * 0.22)} ${P(cx - o.w * 0.72, o.bottom - depth * 0.1)}`, '#ff9aa5', 3)
  return part(
    ctx,
    'mouth',
    part(ctx, 'mouthFill', fillP(d, MC.throat)) +
      `<g ${c}>` +
      part(ctx, 'throat', ell(cx, o.top + depth * 0.46, o.w * 0.5, depth * 0.28, MC.deep)) +
      part(ctx, 'uvula', `<path d="M ${P(cx - 6, o.top + 12)} C ${P(cx - 6, o.top + 24)} ${P(cx - 4, o.top + 30)} ${P(cx, o.top + 31)} C ${P(cx + 4, o.top + 30)} ${P(cx + 6, o.top + 24)} ${P(cx + 6, o.top + 12)} Z" fill="${MC.uvula}"/>`) +
      part(ctx, 'tongue', tongue) +
      part(ctx, 'lowerTeeth', lower) +
      part(ctx, 'upperTeeth', upper) +
      `</g>` +
      part(ctx, 'mouthLine', `<path d="${d}" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linejoin="round"/>`) +
      (lipColor ? part(ctx, 'lip', line(`M ${P(cx - o.w * 0.45, o.bottom + 8)} Q ${P(cx, o.bottom + 15)} ${P(cx + o.w * 0.45, o.bottom + 8)}`, lipColor, 3.4)) : '')
  )
}

/**
 * Closed friendly smile (jaw shut). style 'smile' = ink line with dimple ticks; 'grin' = closed teeth
 * crescent. o: { y, w, smile (0..1), cx?, style?, teethColor?, lip? }
 */
export function mouthClosed(ctx, o, lipColor) {
  const cx = o.cx ?? 0
  const s = o.smile ?? 0.7
  const y = o.y
  const w = o.w
  if (o.style === 'grin') {
    const top = `M ${P(cx - w, y - s * 8)} Q ${P(cx, y + s * 6)} ${P(cx + w, y - s * 8)}`
    const d = `${top} Q ${P(cx + w * 0.7, y + s * 30)} ${P(cx, y + s * 30)} Q ${P(cx - w * 0.7, y + s * 30)} ${P(cx - w, y - s * 8)} Z`
    const c = clip(ctx, 'mouth', d)
    let teeth = `<g ${c}>${fillP(d, MC.throat)}${fillP(`M ${P(cx - w - 4, y - 20)} L ${P(cx + w + 4, y - 20)} L ${P(cx + w + 4, y + s * 12)} Q ${P(cx, y + s * 30)} ${P(cx - w - 4, y + s * 12)} Z`, o.teethColor ?? MC.teeth)}`
    for (let i = -2; i <= 2; i++) teeth += line(`M ${P(cx + i * w * 0.32, y - 6)} L ${P(cx + i * w * 0.3, y + s * 14 - Math.abs(i) * 2)}`, INK, 1.8)
    teeth += line(`M ${P(cx - w, y + s * 10)} Q ${P(cx, y + s * 26)} ${P(cx + w, y + s * 10)}`, INK, 2)
    teeth += `</g>`
    return part(
      ctx,
      'mouth',
      teeth +
        part(ctx, 'mouthLine', `<path d="${d}" fill="none" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`) +
        line(`M ${P(cx - w - 7, y - s * 13)} Q ${P(cx - w - 3, y - s * 6)} ${P(cx - w - 6, y + 1)} M ${P(cx + w + 7, y - s * 13)} Q ${P(cx + w + 3, y - s * 6)} ${P(cx + w + 6, y + 1)}`, INK, 3.4) +
        (lipColor ? part(ctx, 'lip', line(`M ${P(cx - w * 0.45, y + s * 36)} Q ${P(cx, y + s * 42)} ${P(cx + w * 0.45, y + s * 36)}`, lipColor, 3.4)) : '')
    )
  }
  const d = `M ${P(cx - w, y - s * 10)} Q ${P(cx, y + s * 22)} ${P(cx + w, y - s * 10)}`
  return part(
    ctx,
    'mouth',
    part(ctx, 'mouthLine', line(d, INK, 6)) +
      line(`M ${P(cx - w - 6, y - s * 16)} Q ${P(cx - w - 1, y - s * 10)} ${P(cx - w - 3, y - s * 3)} M ${P(cx + w + 6, y - s * 16)} Q ${P(cx + w + 1, y - s * 10)} ${P(cx + w + 3, y - s * 3)}`, INK, 3.4) +
      (lipColor ? part(ctx, 'lip', line(`M ${P(cx - w * 0.4, y + s * 18)} Q ${P(cx, y + s * 24)} ${P(cx + w * 0.4, y + s * 18)}`, lipColor, 3.4)) : '')
  )
}

// ——— hands & arms ———

const HAND = 'M -9,3 C -14,-6 -15,-14 -12,-19 C -13,-27 -6,-31 -3,-24 C -3,-33 6,-34 6,-25 C 8,-32 16,-30 14,-21 C 18,-25 22,-19 18,-13 C 17,-5 13,2 7,4 Z'
const THUMB = 'M -10,-7 C -20,-12 -25,-5 -20,-1 C -17,2 -12,1 -9,-1 Z'
const FIST = 'M -14,-14 C -16,-24 -6,-28 2,-26 C 12,-28 20,-22 19,-12 C 21,-4 16,6 6,8 C -4,9 -14,6 -15,-2 Z'
const FIST_LINES = 'M -6,-24 Q -9,-18 -7,-12 M 3,-25 Q 1,-19 2,-13 M 11,-23 Q 10,-17 11,-11'

/**
 * A cartoon hand with a cuff. kind 'open' (palm up, fingers spread) or 'fist' (holding something).
 * Rig group handL|handR. flip mirrors it for the left hand.
 */
export function hand(ctx, side, { x, y, rot = 0, s = 1.35, skin, cuff = '#fff', kind = 'open', flip } = {}) {
  const f = flip ?? side === 'L'
  const tf = `translate(${r1(x)} ${r1(y)}) rotate(${r1(rot)}) scale(${f ? -s : s} ${s})`
  let body
  if (kind === 'fist') {
    body = inked(FIST, skin.base, 6, { off: 'translate(1 1.4)' }) + fillP('M 19,-12 C 21,-4 16,6 6,8 C 14,2 17,-4 19,-12 Z', skin.shade) + line(FIST_LINES, skin.deep, 2) + inked('M -15,-6 C -22,-10 -24,-2 -19,1 C -16,3 -12,2 -10,0 Z', skin.base, 5, { off: 'translate(1 1.4)' })
  } else {
    body =
      ell(0, 6, 11, 6, INK, 0, ' transform="translate(1 1.5)"') +
      ell(0, 6, 9.5, 4.6, cuff) +
      inked(THUMB, skin.base, 6, { off: 'translate(1 1.4)' }) +
      inked(HAND, skin.base, 6, { off: 'translate(1 1.4)' }) +
      fillP(THUMB, skin.base) +
      fillP('M 14,-20 C 18,-12 14,-2 7,3 C 12,-4 13,-12 14,-20 Z', skin.shade) +
      line('M -3,-23 L -3,-15 M 6,-24 L 5.5,-15', skin.deep, 2)
  }
  return part(ctx, `hand${side}`, `<g transform="${tf}">${body}</g>`)
}

/** Rubber-hose arm from shoulder to wrist (sleeve colour over a fat ink stroke). Group armL|armR. */
export function arm(ctx, side, s, w, { bend = 0.6, color, width = 16, ink = 8 }) {
  const mx = (s.x + w.x) / 2
  const my = (s.y + w.y) / 2
  const dx = w.x - s.x
  const dy = w.y - s.y
  const len = Math.hypot(dx, dy) || 1
  const k = bend * Math.max(10, 70 - len * 0.35)
  const d = `M ${P(s.x, s.y)} Q ${P(mx + (-dy / len) * k, my + (dx / len) * k)} ${P(w.x, w.y)}`
  return part(
    ctx,
    `arm${side}`,
    `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${width + ink}" stroke-linecap="round" transform="translate(1 1.5)"/>` +
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`
  )
}

// ——— props / fx ———

/** The incoming file (eat pose): a dog-eared card with a format label, tilted, with speed lines. */
export function fileCard(ctx, { x = -150, y = -150, rot = -18, label = 'PNG', color = '#4f8fe0' } = {}) {
  const body =
    inked('M -22,-28 L 10,-28 L 22,-16 L 22,28 L -22,28 Z', '#fffdf6', 6) +
    fillP('M 10,-28 L 10,-16 L 22,-16 Z', '#d9dde6') +
    line('M 10,-28 L 10,-16 L 22,-16', INK, 2.4) +
    `<rect x="-16" y="-2" width="32" height="15" rx="3" fill="${color}"/>` +
    `<text x="0" y="9.6" font-family="Inter, DejaVu Sans, Arial, sans-serif" font-weight="800" font-size="11" fill="#fff" text-anchor="middle">${label}</text>` +
    line('M -14,-18 L 2,-18 M -14,-10 L 6,-10 M -14,20 L 12,20', '#b8c0cc', 2.4)
  const speed = line('M 30,30 L 52,52 M 16,40 L 32,58 M 38,16 L 58,34', '#ffffff', 3.4, ' opacity="0.9"')
  return part(ctx, 'fileIncoming', `<g transform="translate(${x} ${y}) rotate(${rot})">${speed}${body}</g>`)
}

/** Little excitement/motion marks. */
export function marks(d, color = INK, w = 3.4) {
  return line(d, color, w)
}

/** Wraps a body into a standalone SVG document. */
export function svgDoc(ctx, title, body, { comment = '' } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}" width="512" height="512" role="img" aria-label="${title}">
<title>${title}</title>
${comment ? `<!-- ${comment} -->\n` : ''}<defs>${ctx.defs.join('')}</defs>
${body}
</svg>
`
}

export const POSES = {
  idle: { pose: 'idle', jaw: 0, look: { x: 0.08, y: 0.12 } },
  eat: { pose: 'eat', jaw: 1, look: { x: -0.72, y: -0.62 } }
}
