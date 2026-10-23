// 11 — Biscuit: an original chubby, lazy orange tabby. Same family as the others (bold ink, layered
// rig, huge eating mouth) but lit like a soft vinyl toy: key light from the LEFT (left rim light,
// highlights on the left of each form), smooth radial form shadows falling to the right, and a soft
// contact shadow under the feet. Gradients only — no filters, no rasters.
// Deliberately NOT a famous comic cat: separate almond eyes with heavy lids and slit pupils (no big
// conjoined round eyes), no muzzle blob (cream is on the chin, throat and belly), darker-orange tabby
// bars on the cheeks/flanks (not black head stripes), a cream heart on the forehead and a bell collar.
import { INK, P, clip, ell, circle, fileCard, fillP, headD, inked, line, mirror, part } from '../lib.mjs'

export const meta = {
  num: '11',
  slug: 'biscuit-cat',
  name: 'Biscuit',
  origin: 'The sofa — a chubby, lazy orange tabby who only gets up for snacks',
  signature: 'A cream heart-shaped patch on his forehead, and a teal collar with a gold bell that rings once per file.',
  catchphrase: 'Mrrrp… is that for me?',
  eats: 'Opens one sleepy eye, then both go wide; he stretches and swallows the file whole, bell jingling.',
  chews: 'Slow, smug chewing with a deep purr; the tail thumps the floor once per 10 % and the bell ticks.',
  spits: 'Coughs the result up like a neat hairball, then pushes it towards you with one chunky paw.',
  bg: ['#eef0f8', '#d7dcef']
}

const FUR = { light: '#ffd296', base: '#f39a45', shade: '#b4583a', deep: '#a8512a', rim: '#fff1d2' }
const STRIPE = '#c45f26'
const CREAM = { light: '#fffaf0', base: '#fbe8c8', shade: '#cfae97' }
const PINK = '#f29aa6'
const PINK_SH = '#cf6f80'
const EYE = '#9cc94f'
const COLLAR = '#2f9a95'
const GOLD = '#f2c14e'

/** Radial gradient lit from the left (key light up-left, form shadow to the right). */
function grad(ctx, name, c, { cx = 0.3, cy = 0.3, r = 0.85 } = {}) {
  const id = `${ctx.uid}-g-${name}`
  ctx.defs.push(
    `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}" fx="${cx - 0.06}" fy="${cy}">` +
      `<stop offset="0" stop-color="${c.light}"/><stop offset="0.42" stop-color="${c.base}"/><stop offset="1" stop-color="${c.shade}"/>` +
      `</radialGradient>`
  )
  return `url(#${id})`
}

/**
 * Soft-vinyl form: ink copy (down-right), then inside a clip a rim-light colour with the gradient fill
 * shifted right on top, so only a thin rim on the LEFT edge stays lit. extra = more art inside the clip.
 */
function vinyl(ctx, name, d, c, { w = 9, rim = 5, extra = '', g = {} } = {}) {
  const k = clip(ctx, name, d)
  return (
    `<path d="${d}" fill="${INK}" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" transform="translate(1.6 2.2)"/>` +
    `<g ${k}>` +
    fillP(d, c.rim ?? FUR.rim) +
    `<path d="${d}" fill="${grad(ctx, name, c, g)}" transform="translate(${rim} ${rim * 0.3})"/>` +
    extra +
    `</g>`
  )
}

/** Soft white specular (gradient to transparent), top-left of a form. */
function spec(ctx, name, cx, cy, rx, ry, rot = -25, o = 0.75) {
  const id = `${ctx.uid}-s-${name}`
  ctx.defs.push(`<radialGradient id="${id}"><stop offset="0" stop-color="#ffffff" stop-opacity="${o}"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>`)
  return ell(cx, cy, rx, ry, `url(#${id})`, rot)
}

function contactShadow(ctx) {
  const id = `${ctx.uid}-s-contact`
  ctx.defs.push(`<radialGradient id="${id}"><stop offset="0" stop-color="#3a2f5a" stop-opacity="0.5"/><stop offset="0.55" stop-color="#3a2f5a" stop-opacity="0.22"/><stop offset="1" stop-color="#3a2f5a" stop-opacity="0"/></radialGradient>`)
  return part(ctx, 'contactShadow', ell(18, 220, 180, 22, `url(#${id})`) + ell(-58, 218, 40, 7, '#3a2f5a', 0, ' opacity="0.22"') + ell(68, 218, 42, 8, '#3a2f5a', 0, ' opacity="0.3"'))
}

const BODY = 'M -64,40 C -128,58 -152,140 -140,186 C -128,222 128,222 140,186 C 152,140 128,58 64,40 Z'

function tail(ctx, eat) {
  const d = eat ? 'M 120,190 C 196,196 204,120 182,84 C 168,62 150,66 156,84 C 160,96 174,90 170,82' : 'M 120,196 C 200,204 208,128 186,92 C 172,70 152,72 158,92 C 162,104 178,98 172,88'
  return part(
    ctx,
    'tail',
    `<path d="${d}" fill="none" stroke="${INK}" stroke-width="34" stroke-linecap="round" transform="translate(1.6 2.2)"/>` +
      `<path d="${d}" fill="none" stroke="${FUR.shade}" stroke-width="26" stroke-linecap="round"/>` +
      `<path d="${d}" fill="none" stroke="${FUR.base}" stroke-width="18" stroke-linecap="round" transform="translate(-3 -1)"/>` +
      `<path d="${d}" fill="none" stroke="${STRIPE}" stroke-width="26" stroke-dasharray="9 22" stroke-dashoffset="4"/>` +
      `<path d="${d}" fill="none" stroke="${FUR.rim}" stroke-width="3" stroke-linecap="round" transform="translate(-9 -2)" opacity="0.7"/>`
  )
}

function body(ctx) {
  const eat = ctx.jaw > 0
  const belly = ell(-6, 150, 76, 62, grad(ctx, 'belly', { ...CREAM, light: '#ffffff' }, { cx: 0.32, cy: 0.3, r: 0.8 }))
  const stripes = line('M -132,112 Q -112,118 -104,132 M -140,140 Q -118,146 -110,160 M 132,104 Q 110,112 102,128 M 142,134 Q 118,142 110,158 M 140,166 Q 120,170 114,182', STRIPE, 7)
  const collar =
    `<path d="M -84,66 Q 0,112 84,66" fill="none" stroke="${INK}" stroke-width="20" stroke-linecap="round" transform="translate(1.6 2.2)"/>` +
    `<path d="M -84,66 Q 0,112 84,66" fill="none" stroke="${COLLAR}" stroke-width="13" stroke-linecap="round"/>` +
    `<path d="M -80,62 Q -40,86 -6,90" fill="none" stroke="#7fd3cc" stroke-width="3" stroke-linecap="round"/>`
  // the bell swings out to the right while he gulps
  const bx = eat ? 92 : 0
  const by = eat ? 112 : 104
  const bell = part(
    ctx,
    'bell',
    `<g transform="translate(${bx} ${by}) rotate(${eat ? -28 : 0})">` +
      inked('M -14,0 A 14,14 0 1 0 14,0 A 14,14 0 1 0 -14,0 Z', GOLD, 6) +
      `<g>${ell(-5, -5, 6, 4, '#fff6cf', -30)}</g>` +
      fillP('M 8,-8 A 14,14 0 0 1 2,13 A 12,12 0 0 0 8,-8 Z', '#c7912a') +
      line('M -11,2 L 11,2', INK, 2.4) +
      circle(0, 7, 2.6, INK) +
      `</g>` +
      (eat ? line('M 120,96 l 10,-6 M 122,110 l 12,0 M 118,124 l 10,6', INK, 3) : '')
  )
  return part(
    ctx,
    'body',
    vinyl(ctx, 'torso', BODY, FUR, { g: { cx: 0.28, cy: 0.28, r: 0.95 }, extra: belly + stripes + spec(ctx, 'torso', -96, 100, 26, 44, 10, 0.55) }) +
      part(ctx, 'collar', collar) +
      bell
  )
}

function foot(ctx, side, x) {
  const d = 'M -34,0 C -36,-18 -14,-24 0,-22 C 18,-24 36,-16 34,2 C 32,14 -32,16 -34,0 Z'
  return part(
    ctx,
    `foot${side}`,
    `<g transform="translate(${x} 208)">` + vinyl(ctx, `foot${side}`, d, { ...CREAM, rim: '#ffffff' }, { w: 7, rim: 3 }) + line('M -10,-6 L -10,8 M 8,-6 L 8,8', CREAM.shade, 2.6) + `</g>`
  )
}

/** Chunky paw (rig group handL/handR). open = palm out with pink beans; else knuckles with toe lines. */
function paw(ctx, side, { x, y, rot = 0, open = false, s = 1 }) {
  const d = 'M -24,4 C -30,-14 -22,-34 -2,-36 C 18,-38 30,-20 26,0 C 22,16 -18,20 -24,4 Z'
  const inner = open
    ? ell(0, -2, 13, 10, PINK) + ell(1, 0, 13, 8, PINK_SH, 0, ' opacity="0.35"') + circle(-15, -20, 5, PINK) + circle(-4, -27, 5, PINK) + circle(9, -26, 5, PINK) + circle(18, -16, 4.6, PINK)
    : line('M -10,-30 Q -12,-20 -9,-12 M 2,-33 Q 0,-24 2,-15 M 14,-28 Q 13,-20 15,-12', FUR.deep, 2.6)
  const c = open ? { ...CREAM, rim: '#ffffff' } : FUR
  return part(ctx, `hand${side}`, `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${side === 'L' ? -s : s} ${s})">` + vinyl(ctx, `paw${side}`, d, c, { w: 7, rim: side === 'L' ? -3 : 3 }) + inner + `</g>`)
}

/** Chunky fur arm (stroke) — lighter on the lit left side. */
function furArm(ctx, side, a, b, bend) {
  const mx = (a.x + b.x) / 2 + bend
  const my = (a.y + b.y) / 2
  const d = `M ${P(a.x, a.y)} Q ${P(mx, my)} ${P(b.x, b.y)}`
  const col = side === 'L' ? '#f6a75a' : '#df8338'
  return part(
    ctx,
    `arm${side}`,
    `<path d="${d}" fill="none" stroke="${INK}" stroke-width="40" stroke-linecap="round" transform="translate(1.6 2.2)"/>` +
      `<path d="${d}" fill="none" stroke="${col}" stroke-width="31" stroke-linecap="round"/>` +
      (side === 'L' ? `<path d="${d}" fill="none" stroke="${FUR.rim}" stroke-width="4" stroke-linecap="round" transform="translate(-11 0)" opacity="0.8"/>` : `<path d="${d}" fill="none" stroke="${FUR.shade}" stroke-width="10" stroke-linecap="round" transform="translate(9 3)" opacity="0.7"/>`)
  )
}

function earsG(ctx) {
  const R = 'M 52,-118 C 70,-150 94,-176 112,-182 C 124,-160 130,-124 126,-80 Z'
  const RIN = 'M 70,-120 C 84,-142 100,-160 110,-164 C 116,-144 118,-120 116,-96 Z'
  const one = (side, d, din, rim) =>
    part(ctx, `ear${side}`, vinyl(ctx, `ear${side}`, d, FUR, { w: 8, rim, g: { cx: side === 'L' ? 0.3 : 0.15, cy: 0.4, r: 1 } }) + fillP(din, PINK) + fillP(din, PINK_SH, ' opacity="0.35" transform="translate(5 3)"') + line(side === 'L' ? 'M -84,-132 l -10,-14 M -92,-122 l -12,-10' : 'M 84,-132 l 10,-14 M 92,-122 l 12,-10', '#fff4e6', 2.4))
  return one('R', R, RIN, 4) + one('L', mirror(R), mirror(RIN), 6)
}

function almond(cx, cy, w, h, tilt) {
  // outer corner slightly higher than the inner corner
  const o = Math.sign(cx)
  const xi = cx - o * w
  const xo = cx + o * w
  return `M ${P(xi, cy + tilt)} Q ${P(cx, cy - h * 1.25)} ${P(xo, cy - tilt)} Q ${P(cx, cy + h * 1.05)} ${P(xi, cy + tilt)} Z`
}

function catEye(ctx, side, eat) {
  const cx = side === 'L' ? -46 : 46
  const cy = -44
  const w = eat ? 26 : 25
  const h = eat ? 26 : 19
  const d = almond(cx, cy, w, h, 4)
  const k = clip(ctx, `eye${side}`, d)
  const lk = ctx.look
  const px = cx + lk.x * 9
  const py = cy + lk.y * 8
  const pupil = eat ? ell(px, py, 8, 11, INK) : ell(px, py, 3.6, 12, INK)
  const irisId = `${ctx.uid}-g-iris${side}`
  ctx.defs.push(`<radialGradient id="${irisId}" cx="0.4" cy="0.6" r="0.6"><stop offset="0" stop-color="#e2f29a"/><stop offset="0.6" stop-color="${EYE}"/><stop offset="1" stop-color="#5f8a2c"/></radialGradient>`)
  const lid = eat ? 0 : 0.55
  const top = cy - h * 1.3
  const edge = top + lid * h * 2.1
  const lidD = `M ${P(cx - w - 8, top - 10)} L ${P(cx + w + 8, top - 10)} L ${P(cx + w + 8, edge)} Q ${P(cx, edge + 7)} ${P(cx - w - 8, edge)} Z`
  return part(
    ctx,
    `eye${side}`,
    inked(d, '#fffdf6', 6) +
      `<g ${k}>` +
      part(ctx, `pupil${side}`, circle(px, py, 15, `url(#${irisId})`) + pupil + circle(px - 5, py - 6, 3.6, '#fff') + circle(px + 4, py + 5, 1.6, '#fff')) +
      (lid ? part(ctx, `lid${side}`, fillP(lidD, side === 'L' ? '#f7a85a' : FUR.base) + line(`M ${P(cx - w - 4, edge)} Q ${P(cx, edge + 7)} ${P(cx + w + 4, edge)}`, INK, 5)) : '') +
      `</g>` +
      `<path d="${d}" fill="none" stroke="${INK}" stroke-width="3"/>` +
      // a small lash flick at the outer corner
      line(`M ${P(cx + Math.sign(cx) * w, cy - 4)} l ${Math.sign(cx) * 8},-5`, INK, 3.4)
  )
}

function face(ctx) {
  const eat = ctx.jaw > 0
  const J = ctx.jaw * 50
  const eyes = part(ctx, 'eyes', catEye(ctx, 'L', eat) + catEye(ctx, 'R', eat))
  const bY = eat ? -14 : 0
  const brows = part(
    ctx,
    'brows',
    part(ctx, 'browL', line('M -66,-82 Q -50,-90 -32,-84', STRIPE, 6), ` transform="translate(0 ${bY})"`) + part(ctx, 'browR', line('M 32,-84 Q 50,-90 66,-82', STRIPE, 6), ` transform="translate(0 ${bY})"`)
  )
  // signature: a cream heart on the forehead
  const heart = part(
    ctx,
    'heart',
    `<g transform="translate(0 ${eat ? -112 : -108})">` + inked('M 0,14 C -14,4 -22,-4 -20,-12 C -18,-20 -6,-22 0,-12 C 6,-22 18,-20 20,-12 C 22,-4 14,4 0,14 Z', CREAM.base, 4) + ell(-9, -11, 4, 3, '#ffffff', -30) + `</g>`
  )
  const nose = part(ctx, 'nose', inked('M -11,-6 C -8,-12 8,-12 11,-6 C 9,1 4,5 0,6 C -4,5 -9,1 -11,-6 Z', PINK, 4) + ell(-4, -6, 3.4, 2, '#ffd3da'))
  const whiskers = part(ctx, 'whiskers', line('M -54,6 L -112,-2 M -54,14 L -114,16 M -52,22 L -106,34 M 54,6 L 112,-2 M 54,14 L 114,16 M 52,22 L 106,34', INK, 2.2) + circle(-34, 8, 2.2, FUR.deep) + circle(-42, 14, 2.2, FUR.deep) + circle(-30, 18, 2.2, FUR.deep) + circle(34, 8, 2.2, FUR.deep) + circle(42, 14, 2.2, FUR.deep) + circle(30, 18, 2.2, FUR.deep))
  const cheekStripes = part(ctx, 'cheeks', line('M -122,-24 Q -106,-22 -96,-14 M -126,-6 Q -110,-4 -100,4 M 122,-24 Q 106,-22 96,-14 M 126,-6 Q 110,-4 100,4', STRIPE, 6) + ell(-62, 22, 14, 8, '#ff8f7a', 0, ' opacity="0.4"') + ell(62, 22, 14, 8, '#ff8f7a', 0, ' opacity="0.3"'))
  let mouth
  if (eat) {
    const top = 14
    const bottom = 112
    const w = 54
    const d = `M ${P(-w, top + 8)} Q ${P(0, top - 6)} ${P(w, top + 8)} C ${P(w + 6, top + 70)} ${P(w * 0.5, bottom)} ${P(0, bottom)} C ${P(-w * 0.5, bottom)} ${P(-w - 6, top + 70)} ${P(-w, top + 8)} Z`
    const k = clip(ctx, 'mouth', d)
    const fang = (x, dir) => `<path d="M ${P(x - 7, top - 2)} L ${P(x + 7, top - 2)} L ${P(x + dir, top + 24)} Z" fill="#fffaf0" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`
    const lowFang = (x, dir) => `<path d="M ${P(x - 6, bottom + 2)} L ${P(x + 6, bottom + 2)} L ${P(x + dir, bottom - 16)} Z" fill="#fffaf0" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`
    mouth = part(
      ctx,
      'mouth',
      part(ctx, 'mouthFill', fillP(d, '#5a1119')) +
        `<g ${k}>` +
        part(ctx, 'throat', ell(4, 58, 28, 22, '#2a050b')) +
        part(ctx, 'uvula', fillP(`M -5,${top + 8} C -5,${top + 20} 5,${top + 20} 5,${top + 8} Z`, '#c23a4b')) +
        part(ctx, 'tongue', fillP(`M -44,${bottom + 4} C -44,72 -14,64 0,78 C 14,64 44,72 44,${bottom + 4} Z`, '#f07b8c') + line('M 0,80 L 0,100', '#c94557', 3) + ell(-22, 86, 8, 4, '#ffb1bc', -20)) +
        part(ctx, 'lowerTeeth', lowFang(-30, 2) + lowFang(30, -2)) +
        part(ctx, 'upperTeeth', fang(-34, 2) + fang(34, -2)) +
        `</g>` +
        part(ctx, 'mouthLine', `<path d="${d}" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linejoin="round"/>`)
    )
  } else {
    // little "w" cat mouth with a smug lazy smile
    mouth = part(ctx, 'mouth', part(ctx, 'mouthLine', line('M 0,6 L 0,16 M -30,14 Q -24,26 -12,24 Q -2,22 0,16 Q 2,22 12,24 Q 24,26 30,14', INK, 4.4)) + line('M -34,10 l 4,4 M 34,10 l -4,4', INK, 3))
  }
  const chin = part(ctx, 'chin', '')
  return part(ctx, 'face', cheekStripes + chin + whiskers + mouth + nose + heart + eyes + brows + `<g transform="translate(0 ${eat ? 0 : 0})"></g>`) + (J ? '' : '')
}

export function draw(ctx) {
  const eat = ctx.jaw > 0
  // wide round cat head, cheek fluff at the jowls; the chin drops with the jaw
  const H = headD({ T: -136, W: 128, S: -34, JW: 112, JY: 40, C: 74, cw: 60, crown: 0.62, jaw: ctx.jaw, drop: 52 })
  const J = ctx.jaw * 52
  // cream chin + throat (lower face only — no muzzle blob around the nose)
  const chinCream = `M -70,${46 + J * 0.7} C -50,${30 + J * 0.6} 50,${30 + J * 0.6} 70,${46 + J * 0.7} C 60,${70 + J} 30,${78 + J} 0,${78 + J} C -30,${78 + J} -60,${70 + J} -70,${46 + J * 0.7} Z`
  const _fluff = (s) => inked(`M ${s * 112},${30 + J * 0.5} L ${s * 144},${40 + J * 0.55} L ${s * 118},${48 + J * 0.6} L ${s * 140},${62 + J * 0.65} L ${s * 106},${62 + J * 0.7} Z`, s < 0 ? '#f7a85a' : FUR.shade, 6)
  const skull = part(
    ctx,
    'skull',
    vinyl(ctx, 'head', H, FUR, {
        w: 10,
        rim: 6,
        g: { cx: 0.3, cy: 0.28, r: 0.9 },
        extra: fillP(chinCream, CREAM.base) + fillP(chinCream, CREAM.shade, ' opacity="0.6" transform="translate(16 4)"') + line('M -40,-132 Q -44,-118 -38,-104 M 40,-132 Q 44,-118 38,-104', STRIPE, 6) + spec(ctx, 'head', -64, -86, 40, 24, -30, 0.8)
      })
  )
  const headG = part(ctx, 'head', earsG(ctx) + skull + face(ctx), eat ? ' transform="rotate(-4 0 80)"' : '')
  const sL = { x: -96, y: 90 }
  const sR = { x: 96, y: 90 }
  let arms
  if (eat) {
    arms = furArm(ctx, 'L', sL, { x: -150, y: 40 }, -20) + furArm(ctx, 'R', sR, { x: 150, y: 40 }, 20) + paw(ctx, 'L', { x: -152, y: 34, rot: -16, open: true }) + paw(ctx, 'R', { x: 152, y: 34, rot: 16, open: true })
  } else {
    arms = furArm(ctx, 'L', sL, { x: -50, y: 148 }, -30) + furArm(ctx, 'R', sR, { x: 52, y: 140 }, 30) + paw(ctx, 'L', { x: -44, y: 160, rot: -70 }) + paw(ctx, 'R', { x: 46, y: 152, rot: 70 })
  }
  const zz = eat ? '' : part(ctx, 'zzz', `<text x="128" y="-120" font-family="Inter, DejaVu Sans, Arial, sans-serif" font-weight="900" font-size="30" fill="#6c6aa6">z</text><text x="150" y="-146" font-family="Inter, DejaVu Sans, Arial, sans-serif" font-weight="900" font-size="22" fill="#6c6aa6">z</text>`)
  const file = eat ? fileCard(ctx, { label: 'GIF', color: '#8a5cd6' }) : ''
  return part(ctx, 'root', contactShadow(ctx) + tail(ctx, eat) + body(ctx) + foot(ctx, 'L', -62) + foot(ctx, 'R', 62) + headG + arms + zz + file)
}
