// 00 — Motu Uncle: a jolly, very round Indian uncle who is always ready for the next snack.
// Deliberately NOT the in-app Uncle: a round moon face with big puffed cheeks, small squinty smiling
// eyes, short arched black brows, a button nose and no moustache; oiled black hair with a side
// parting and a front puff. A bright turquoise bush shirt with a mango print over a huge belly.
// Signature: the napkin tucked into his collar (with a haldi stain), and a samosa in his hand.
import { INK, P, clip, ears, ell, eye, fileCard, fillP, head, inked, line, mirror, mouthClosed, mouthOpen, part } from '../lib.mjs'

export const meta = {
  num: '00',
  slug: 'motu-uncle',
  name: 'Motu Uncle',
  origin: 'India — the neighbourhood’s happiest foodie, never more than one arm’s length from a samosa',
  signature: 'The napkin tucked into his collar (one haldi stain, always), and a hot samosa in hand.',
  catchphrase: 'Arre, bas ek aur! (Just one more!)',
  eats: 'Tucks the napkin in tighter, puts the samosa down for a second and swallows the file in one big gulp.',
  chews: 'Moon cheeks puff out on every chew, the napkin flaps and the belly bounces.',
  spits: 'Dabs his mouth with a corner of the napkin, pats the belly and hands the result over with a happy “Wah!”.',
  bg: ['#f1ecfb', '#dcd1f4']
}

const SKIN = { base: '#e9ad7c', shade: '#cc8a5e', light: '#f8cba3', deep: '#a9603d', blush: '#ee6f5f' }
const HAIR = '#211a1e'
const HAIR_HI = '#5d5670'
const SHIRT = '#1fa6a0'
const SHIRT_SH = '#157b79'
const MANGO = '#ffd23f'
const ORANGE = '#ff7b3a'
const NAPKIN = '#fbf6ec'
const NAPKIN_SH = '#ddd2c2'
const HALDI = '#f0a82a'
const SAMOSA = { base: '#e3a443', shade: '#b8772b', light: '#f6cf7a' }

const TORSO = 'M -90,96 C -178,104 -208,198 -170,228 C -116,250 116,250 170,228 C 208,198 178,104 90,96 Z'

/** Little mango-shaped print, alternating yellow and orange, on a loose grid. */
function print() {
  const MANGO_D = 'M 0,-9 C 7,-9 10,-2 8,4 C 6,10 -2,12 -6,8 C -10,4 -7,-1 -3,-2 C -1,-4 -3,-8 0,-9 Z'
  let s = ''
  let i = 0
  for (let y = 112; y <= 240; y += 30) {
    for (let x = -200 + ((y / 30) % 2) * 22; x <= 200; x += 44) {
      const c = i++ % 3 === 0 ? ORANGE : MANGO
      s += `<g transform="translate(${x} ${y}) rotate(${(i * 37) % 80 - 40})">${fillP(MANGO_D, c)}${line('M 0,-9 Q 2,-13 5,-14', '#2f6b3a', 2)}</g>`
    }
  }
  return s
}

function napkin(ctx, eat) {
  // A white napkin tucked into the collar, hanging over the belly as a soft triangle.
  const BIB = 'M -66,104 C -24,114 24,114 66,104 C 60,140 40,196 0,238 C -40,196 -60,140 -66,104 Z'
  const flap = eat ? ' transform="rotate(-5 0 104)"' : ''
  const c = clip(ctx, 'napkin', BIB)
  return part(
    ctx,
    'napkin',
    `<g${flap}>` +
      inked(BIB, NAPKIN, 7) +
      `<g ${c}>` +
      fillP('M 40,108 C 50,150 34,200 0,238 L 60,238 L 76,100 Z', NAPKIN_SH) +
      line('M -54,116 C -48,150 -30,190 0,222 C 30,190 48,150 54,116', ORANGE, 4) + line('M -46,120 C -40,152 -24,186 0,214 C 24,186 40,152 46,120', ORANGE, 2) +
      `</g>` +
      // the haldi stain
      `<g transform="translate(-4 -10) translate(16 170) scale(1.25) translate(-16 -155)">${fillP('M 10,146 C 18,138 30,142 28,152 C 34,158 26,168 18,164 C 12,170 4,162 8,156 C 2,152 4,146 10,146 Z', HALDI)}</g>` +
      ell(34, 140, 3.4, 3, HALDI) +
      `</g>`
  )
}

function body(ctx, eat) {
  const c = clip(ctx, 'torso', TORSO)
  return part(
    ctx,
    'body',
    inked(TORSO, SHIRT, 9) +
      `<g ${c}>` +
      print() +
      fillP('M 84,108 C 166,124 196,196 158,230 C 112,248 60,248 20,248 C 118,226 146,170 84,108 Z', SHIRT_SH, ' opacity="0.8"') +
      ell(-84, 150, 52, 24, '#5fd0c6', -18, ' opacity="0.45"') +
      // belly button-line and a fold under the belly
      line('M -120,226 Q 0,240 120,226', SHIRT_SH, 3) +
      `</g>` +
      // collar points
      inked('M -54,96 L -18,104 L -46,128 Z', SHIRT, 5) +
      inked('M 54,96 L 18,104 L 46,128 Z', SHIRT, 5) +
      napkin(ctx, eat)
  )
}

function fatHand(ctx, side, x, y, rot, open, s = 1.15) {
  // short sausage fingers: palm + four fat capsules + thumb, with a steel kada on the wrist
  const f = side === 'L' ? -1 : 1
  const fingers = open
    ? [[-12, -20, -16, -38], [-3, -24, -4, -44], [7, -23, 8, -42], [15, -18, 20, -33]]
    : [[-12, -14, -12, -20], [-3, -16, -3, -22], [6, -16, 6, -22], [14, -12, 14, -18]]
  const fd = fingers.map(([a, b, c2, d]) => `M ${P(a, b)} L ${P(c2, d)}`).join(' ')
  const g =
    `<path d="${fd}" stroke="${INK}" stroke-width="16" stroke-linecap="round" transform="translate(1 1.5)"/>` +
    inked('M -20,-14 C -22,-28 18,-30 22,-14 C 26,4 14,14 0,14 C -14,14 -24,4 -20,-14 Z', SKIN.base, 7) +
    `<path d="${fd}" stroke="${SKIN.base}" stroke-width="10.5" stroke-linecap="round"/>` +
    line('M -20,-2 C -32,-6 -36,6 -26,10', INK, 15) +
    line('M -20,-2 C -32,-6 -36,6 -26,10', SKIN.base, 9.5) +
    fillP('M 22,-14 C 26,4 14,14 0,14 C 14,6 20,-4 22,-14 Z', SKIN.shade)
  return part(ctx, `hand${side}`, `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${f * s} ${s})">${g}</g>`)
}

/** A chubby arm: skin hose with a short turquoise half-sleeve at the shoulder. */
function chubbyArm(ctx, side, s, w, bend) {
  const mx = (s.x + w.x) / 2
  const my = (s.y + w.y) / 2
  const dx = w.x - s.x
  const dy = w.y - s.y
  const len = Math.hypot(dx, dy) || 1
  const k = bend * Math.max(10, 70 - len * 0.35)
  const cx = mx + (-dy / len) * k
  const cy = my + (dx / len) * k
  const d = `M ${P(s.x, s.y)} Q ${P(cx, cy)} ${P(w.x, w.y)}`
  // sleeve = the first ~45 % of the same curve
  const t = 0.45
  const qx = s.x + (cx - s.x) * t
  const qy = s.y + (cy - s.y) * t
  const ex = (1 - t) * (1 - t) * s.x + 2 * (1 - t) * t * cx + t * t * w.x
  const ey = (1 - t) * (1 - t) * s.y + 2 * (1 - t) * t * cy + t * t * w.y
  const sd = `M ${P(s.x, s.y)} Q ${P(qx, qy)} ${P(ex, ey)}`
  return part(
    ctx,
    `arm${side}`,
    `<path d="${d}" fill="none" stroke="${INK}" stroke-width="38" stroke-linecap="round" transform="translate(1 1.5)"/>` +
      `<path d="${d}" fill="none" stroke="${SKIN.base}" stroke-width="30" stroke-linecap="round"/>` +
      `<path d="${sd}" fill="none" stroke="${INK}" stroke-width="50" stroke-linecap="round" transform="translate(1 1.5)"/>` +
      `<path d="${sd}" fill="none" stroke="${SHIRT}" stroke-width="42" stroke-linecap="round"/>` +
      `<circle cx="${P(ex, ey).split(',')[0]}" cy="${P(ex, ey).split(',')[1]}" r="5" fill="${MANGO}"/>`
  )
}

function samosa(ctx, x, y, rot, s = 1) {
  // a fat golden samosa, fresh from the kadhai (steaming)
  const D = 'M -42,20 C -40,8 -16,-18 -4,-26 C 2,-30 8,-29 13,-24 C 26,-10 44,6 41,20 C 14,29 -16,29 -42,20 Z'
  return part(
    ctx,
    'samosa',
    `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">` +
      inked(D, SAMOSA.base, 6) +
      fillP('M 13,-24 C 26,-10 44,6 41,20 C 30,24 18,26 8,26 C 26,12 24,-8 13,-24 Z', SAMOSA.shade) +
      fillP('M -32,14 C -24,2 -12,-12 -4,-18 C -8,-8 -16,4 -24,16 Z', SAMOSA.light) +
      // the folded seam and crisp bubbles
      [[-12, 8], [6, 14], [-24, 18]].map(([a, b]) => ell(a, b, 2.4, 1.8, SAMOSA.shade)).join('') +
      // steam
      line('M -10,-46 q -6,-8 0,-16 q 6,-8 0,-16 M 10,-48 q -5,-7 0,-13 q 5,-7 0,-13', '#ffffff', 3.2, ' opacity="0.9"') +
      `</g>`
  )
}

function hair(ctx) {
  // oiled black hair, side parting on his left (our right), with a puff swept across the front
  const CAP =
    'M -114,-60 C -134,-118 -96,-172 -24,-170 C 30,-170 72,-152 94,-128 C 116,-106 124,-84 114,-60 C 106,-78 92,-90 72,-96 L 40,-100 C 22,-80 -6,-102 -34,-90 C -56,-80 -70,-94 -88,-84 C -100,-78 -108,-70 -114,-60 Z'
  return part(
    ctx,
    'hair',
    inked(CAP, HAIR, 8) +
      // parting line
      line('M 40,-100 C 46,-118 52,-136 60,-152', '#6e4a3c', 3) +
      // oily shine streaks, swept toward the left
      line('M 24,-134 C -10,-146 -60,-138 -92,-104', HAIR_HI, 4.5) +
      line('M 10,-116 C -20,-124 -54,-118 -78,-98', HAIR_HI, 3) +
      line('M 70,-140 C 86,-128 100,-112 106,-90', HAIR_HI, 3) +
      ell(-40, -136, 9, 3.4, '#9a93ad', -14, ' opacity="0.9"') +
      // the front wave
      line('M 36,-102 C 18,-90 -6,-104 -34,-96', '#3a3138', 2.6)
  )
}

function sideburns(ctx) {
  const SB = 'M 102,-72 L 116,-66 C 118,-46 116,-30 112,-18 L 104,-20 C 106,-34 104,-52 102,-72 Z'
  return part(ctx, 'sideburns', inked(SB, HAIR, 5) + inked(mirror(SB), HAIR, 5, { off: 'translate(-0.6 2.2)' }))
}

function face(ctx) {
  const eat = ctx.jaw > 0
  const look = ctx.look
  // small, round, squinty-happy eyes pushed up by the big cheeks
  const e = { rx: 14, ry: 15, pr: 7.5, look, lidFill: SKIN.base, iris: '#4a2a17' }
  const eyes = part(
    ctx,
    'eyes',
    eye(ctx, 'L', { cx: -40, cy: -32, ...e, lid: eat ? 0.06 : 0.22, smile: eat ? 0 : 0.42 }) +
      eye(ctx, 'R', { cx: 40, cy: -32, ...e, lid: eat ? 0.06 : 0.22, smile: eat ? 0 : 0.42 })
  )
  // short, thick, high-arched black brows (commas)
  const BROW = 'M 22,-62 C 26,-80 50,-84 64,-72 C 66,-70 66,-66 62,-66 C 52,-72 38,-70 30,-60 C 27,-56 22,-57 22,-62 Z'
  const bY = eat ? -12 : 0
  const brows = part(
    ctx,
    'brows',
    part(ctx, 'browR', inked(BROW, HAIR, 5), ` transform="translate(0 ${bY}) rotate(${eat ? -6 : 0} 44 -70)"`) +
      part(ctx, 'browL', inked(mirror(BROW), HAIR, 5, { off: 'translate(-0.6 2.2)' }), ` transform="translate(0 ${bY}) rotate(${eat ? 6 : 0} -44 -70)"`)
  )
  // a small round button nose
  const NOSE = 'M -14,8 C -16,-6 -6,-12 0,-12 C 6,-12 16,-6 14,8 C 12,16 4,18 0,16 C -4,18 -12,16 -14,8 Z'
  const nose = part(ctx, 'nose', inked(NOSE, '#ee9f74', 5) + fillP('M 13,4 C 13,14 6,17 0,16 C 7,13 11,9 13,4 Z', '#cf7f58') + ell(-5, -3, 4.5, 3.2, '#ffd9bd', -20))
  // big round moon cheeks
  const cy = eat ? 14 : 20
  const cheeks = part(
    ctx,
    'cheeks',
    ell(-78, cy, 30, 22, SKIN.blush, 0, ' opacity="0.42"') +
      ell(78, cy, 30, 22, SKIN.blush, 0, ' opacity="0.42"') +
      ell(-86, cy - 8, 8, 4, '#fff1e2', -20, ' opacity="0.7"') +
      ell(70, cy - 8, 8, 4, '#fff1e2', -20, ' opacity="0.7"') +
      line(eat ? 'M -64,36 Q -86,70 -84,110 M 64,36 Q 86,70 84,110' : 'M -46,40 Q -60,52 -58,66 M 46,40 Q 60,52 58,66', SKIN.deep, 3)
  )
  const mouth = eat ? mouthOpen(ctx, { top: 48, w: 74, bottom: 156, corner: 52 }, SKIN.deep) : mouthClosed(ctx, { y: 50, w: 28, smile: 1 }, SKIN.deep)
  // a soft double chin
  const chin = part(ctx, 'chin', line(eat ? 'M -50,178 Q 0,194 50,178' : 'M -58,116 Q 0,138 58,116', SKIN.deep, 3.2))
  return part(ctx, 'face', cheeks + chin + mouth + nose + eyes + brows)
}

/** Round moon face: a dome on top, cheeks that bulge out below the ears, a soft round chin. */
function moonD(J) {
  const R = [
    `C ${P(72, -136)} ${P(116, -94)} ${P(116, -34)}`,
    `C ${P(118, 0)} ${P(130, 30 + J * 0.3)} ${P(120, 64 + J * 0.6)}`,
    `C ${P(106, 108 + J)} ${P(62, 132 + J)} ${P(0, 132 + J)}`
  ]
  const L = [
    `C ${P(-62, 132 + J)} ${P(-106, 108 + J)} ${P(-120, 64 + J * 0.6)}`,
    `C ${P(-130, 30 + J * 0.3)} ${P(-118, 0)} ${P(-116, -34)}`,
    `C ${P(-116, -94)} ${P(-72, -136)} ${P(0, -136)}`
  ]
  return `M ${P(0, -136)} ${R.join(' ')} ${L.join(' ')} Z`
}

export function draw(ctx) {
  const eat = ctx.jaw > 0
  // a wide moon face: the cheeks bulge out past the temples
  const H = moonD(ctx.jaw * 52)
  const skull = part(ctx, 'skull', head(ctx, H, SKIN, { litRx: 136, litRy: 168, litCy: -10, shineY: -112, hatch: 'M 112,10 l 12,-10 M 112,26 l 12,-10 M 108,42 l 12,-10 M 102,58 l 11,-9' }))
  const headG = part(ctx, 'head', ears(ctx, SKIN, 108, -14, 0.95) + skull + sideburns(ctx) + face(ctx) + hair(ctx), eat ? ' transform="rotate(-4 0 100)"' : ' transform="rotate(2 0 100)"')
  const sL = { x: -116, y: 136 }
  const sR = { x: 116, y: 136 }
  let arms
  if (eat) {
    arms = chubbyArm(ctx, 'L', sL, { x: -160, y: 96 }, -0.4) + chubbyArm(ctx, 'R', sR, { x: 160, y: 96 }, 0.4) + fatHand(ctx, 'L', -162, 88, -24, true) + fatHand(ctx, 'R', 162, 88, 24, true)
  } else {
    arms =
      chubbyArm(ctx, 'R', sR, { x: 98, y: 200 }, -0.4) +
      fatHand(ctx, 'R', 96, 206, -160, false) +
      chubbyArm(ctx, 'L', sL, { x: -150, y: 120 }, -0.5) +
      samosa(ctx, -152, 62, -6, 1.45) +
      fatHand(ctx, 'L', -150, 112, -10, false)
  }
  const file = eat ? fileCard(ctx, { x: -160, y: -160, label: 'PNG', color: '#4f8fe0' }) : ''
  return part(ctx, 'root', `<g transform="translate(0 -14) scale(0.94)">` + body(ctx, eat) + headG + arms + `</g>` + file)
}
