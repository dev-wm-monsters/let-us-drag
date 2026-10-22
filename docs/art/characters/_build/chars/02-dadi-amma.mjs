// 02 — Dadi Amma: Indian grandma. Silver bun with a jasmine string, big cat-eye glasses on a beaded
// chain, saree with a gold-bordered pallu, gold bangles. Signature: her steel pressure cooker.
import { INK, P, arm, circle, clip, ears, ell, eye, fileCard, fillP, hand, head, headD, inked, line, mirror, mouthClosed, mouthOpen, part } from '../lib.mjs'

export const meta = {
  num: '02',
  slug: 'dadi-amma',
  name: 'Dadi Amma',
  origin: 'India — the grandma who feeds everyone, including your files',
  signature: 'Her steel pressure cooker: it whistles when the conversion is done. Cat-eye glasses on a beaded chain.',
  catchphrase: 'Kuch khaya ki nahi?',
  eats: 'Pushes her glasses up, says “Arre, so thin!” and gulps the file down to fatten it up.',
  chews: 'Chews patiently while counting cooker whistles — one whistle per 25 %.',
  spits: 'The cooker gives the final “phweeeet!” and she hands the result over, still warm.',
  bg: ['#fde3e6', '#f7c6cf']
}

const SKIN = { base: '#c98d64', shade: '#a86e49', light: '#e3ae86', deep: '#7f4d2e', blush: '#dc6d5e' }
const HAIR = '#e6e3ea'
const HAIR_SH = '#b8b2c2'
const SAREE = '#c2306a'
const SAREE_SH = '#93204f'
const SAREE_LT = '#de5b8c'
const GOLD = '#f2bd47'
const GOLD_SH = '#c98f22'
const BLOUSE = '#f0a63a'
const FRAME = '#7a2638'

const TORSO = 'M -66,90 C -114,98 -136,160 -122,192 C -90,212 90,212 122,192 C 136,160 114,98 66,90 Z'

function body(ctx) {
  const c = clip(ctx, 'torso', TORSO)
  // pallu: a wide band over her left shoulder (viewer's right) falling across the chest
  const PALLU = 'M 30,86 C 70,84 110,96 126,130 C 134,150 132,180 122,206 L 40,212 C 10,180 -40,140 -96,128 C -70,110 -20,96 30,86 Z'
  const border = 'M -96,128 C -40,140 10,180 40,212'
  return part(
    ctx,
    'body',
    inked(TORSO, BLOUSE, 9) +
      `<g ${c}>` +
      // saree skirt pleats under the pallu
      fillP('M -140,160 C -80,150 -20,170 20,214 L -140,214 Z', SAREE) +
      line('M -112,170 L -104,214 M -84,166 L -74,214 M -56,168 L -46,214', SAREE_SH, 3) +
      fillP(PALLU, SAREE) +
      fillP('M 90,100 C 124,118 136,160 122,206 L 84,210 C 112,170 114,130 90,100 Z', SAREE_SH) +
      ell(10, 120, 50, 18, SAREE_LT, -20, ' opacity="0.55"') +
      // gold border with a little zig-zag
      line(border, GOLD, 13) +
      line(border, GOLD_SH, 3, ' stroke-dasharray="4 7"') +
      line('M 30,86 C 70,84 110,96 126,130', GOLD, 9) +
      // tiny gold buti dots on the pallu
      [[20, 120], [50, 150], [80, 130], [70, 175], [100, 160], [96, 196], [40, 190]].map(([x, y]) => circle(x, y, 3.2, GOLD)).join('') +
      `</g>` +
      line(border, INK, 2.4, ' opacity="0.6"')
  )
}

function bun(ctx) {
  return part(
    ctx,
    'bun',
    inked('M -34,-146 C -38,-178 -12,-194 4,-192 C 30,-192 42,-170 36,-150 C 30,-132 -28,-130 -34,-146 Z', HAIR, 7) +
      line('M -24,-164 Q -4,-182 22,-170 M -26,-150 Q 0,-168 30,-154 M -6,-186 Q 14,-184 26,-172', HAIR_SH, 3) +
      // jasmine string (gajra) around the base of the bun
      [-30, -20, -10, 0, 10, 20, 30].map((x, i) => circle(x, -138 + Math.abs(x) * 0.14 - (i % 2) * 3, 6.2, INK) + circle(x - 0.6, -139 + Math.abs(x) * 0.14 - (i % 2) * 3, 4.8, '#fffef6')).join('')
  )
}

function hair(ctx) {
  // smooth silver hair, middle parting, combed back over the ears
  const capR = 'M 0,-104 C 26,-110 66,-96 88,-70 C 98,-58 104,-42 106,-22 C 112,-36 112,-80 96,-104 C 76,-130 40,-138 0,-136 Z'
  return part(
    ctx,
    'hair',
    inked(capR, HAIR, 7) +
      inked(mirror(capR), HAIR, 7, { off: 'translate(-0.6 2.2)' }) +
      fillP('M 40,-128 C 80,-118 106,-84 106,-22 C 100,-50 92,-72 78,-88 C 64,-104 40,-112 20,-112 Z', HAIR_SH, ' opacity="0.75"') +
      line('M 6,-124 Q 40,-128 70,-108 Q 86,-96 90,-84 M 12,-112 Q 46,-112 78,-88 M 30,-104 Q 62,-98 92,-66 M -6,-124 Q -40,-128 -70,-108 Q -86,-96 -90,-84 M -12,-112 Q -46,-112 -78,-88 M -30,-104 Q -62,-98 -92,-66', HAIR_SH, 2.8) +
      line('M 0,-136 L 0,-106', SKIN.shade, 3.4) +
      // flyaways
      line('M -60,-130 C -70,-146 -84,-142 -86,-132 M 54,-132 C 60,-148 76,-150 80,-140', INK, 2.6)
  )
}

function glasses(ctx) {
  const LENS = 'M 10,-46 C 24,-60 58,-62 76,-52 C 81,-40 77,-24 70,-12 C 61,1 42,4 28,-1 C 14,-6 8,-26 10,-46 Z'
  const one = (d, side) =>
    `<path d="${d}" fill="#d6eef6" opacity="0.28"/>` +
    `<path d="${d}" fill="none" stroke="${INK}" stroke-width="12" stroke-linejoin="round" transform="translate(1.2 1.8)"/>` +
    `<path d="${d}" fill="none" stroke="${FRAME}" stroke-width="7.5" stroke-linejoin="round"/>` +
    line(side === 'R' ? 'M 20,-38 Q 26,-48 38,-51' : 'M -66,-46 Q -60,-52 -50,-54', '#fff', 3.4, ' opacity="0.85"') +
    // cat-eye wing
    inked(side === 'R' ? 'M 70,-55 L 84,-57 L 79,-46 Z' : 'M -70,-55 L -84,-57 L -79,-46 Z', FRAME, 4)
  // beaded chain hanging from the temples, looping below the chin
  return part(
    ctx,
    'glasses',
    line('M -12,-40 Q 0,-48 12,-40', FRAME, 6) + one(mirror(LENS), 'L') + one(LENS, 'R') + line('M 80,-38 L 104,-30 M -80,-38 L -104,-30', FRAME, 5)
  )
}

function chain(ctx) {
  const d = 'M -104,-30 C -128,10 -120,70 -84,104 C -50,132 50,132 84,104 C 120,70 128,10 104,-30'
  return part(ctx, 'chain', line(d, INK, 6.4, ' stroke-dasharray="0.1 8.5"') + line(d, GOLD, 4.2, ' stroke-dasharray="0.1 8.5"'))
}

function face(ctx) {
  const eat = ctx.jaw > 0
  const look = ctx.look
  const lid = eat ? 0 : 0.2
  const e = { rx: 20, ry: 22, pr: 9.5, look, lid, lidFill: SKIN.base, iris: '#5b3a24', smile: eat ? 0 : 0.34 }
  const eyes = eye(ctx, 'L', { cx: -42, cy: -26, ...e }) + eye(ctx, 'R', { cx: 42, cy: -26, ...e })
  const BROW = 'M 16,-66 C 28,-80 58,-82 74,-66 C 60,-74 40,-74 26,-64 C 22,-62 18,-62 16,-66 Z'
  const bY = eat ? -14 : -2
  const brows = part(
    ctx,
    'brows',
    part(ctx, 'browR', inked(BROW, HAIR_SH, 5), ` transform="translate(0 ${bY}) rotate(${eat ? 6 : 10} 46 -66)"`) +
      part(ctx, 'browL', inked(mirror(BROW), HAIR_SH, 5, { off: 'translate(-0.6 2.2)' }), ` transform="translate(0 ${bY}) rotate(${eat ? -6 : -10} -46 -66)"`)
  )
  const wrinkles = part(
    ctx,
    'wrinkles',
    line('M -30,-96 Q 0,-104 30,-96 M -20,-86 Q 0,-91 20,-86', SKIN.deep, 2.6, ' opacity="0.7"') +
      line('M -88,-26 l -10,-6 M -88,-18 l -12,0 M -88,-10 l -10,6 M 88,-26 l 10,-6 M 88,-18 l 12,0 M 88,-10 l 10,6', SKIN.deep, 2.6)
  )
  const NOSE = 'M -6,-14 C -9,0 -24,6 -22,18 C -20,28 -8,30 0,26 C 8,30 20,28 22,18 C 24,6 9,0 6,-14 C 3,-18 -3,-18 -6,-14 Z'
  const nose = part(ctx, 'nose', inked(NOSE, '#d39470', 6) + fillP('M 20,12 C 23,22 16,30 4,28 C 13,26 18,20 20,12 Z', '#a8694a') + ell(-9, 12, 6, 4, '#ecb892', -20) + line('M -11,23 Q -7,27 -3,25 M 3,25 Q 7,27 11,23', INK, 2.4))
  const cheeks = part(
    ctx,
    'cheeks',
    ell(-70, eat ? 14 : 22, 18, 11, SKIN.blush, 0, ' opacity="0.5"') +
      ell(70, eat ? 14 : 22, 18, 11, SKIN.blush, 0, ' opacity="0.5"') +
      line(eat ? 'M -56,36 Q -68,60 -68,84 M 56,36 Q 68,60 68,84' : 'M -30,32 Q -48,44 -50,62 M 30,32 Q 48,44 50,62', SKIN.deep, 3)
  )
  const mouth = eat
    ? mouthOpen(ctx, { top: 54, w: 62, bottom: 134, corner: 58, gap: [1, 3, 4], teethN: 6 }, SKIN.deep)
    : mouthClosed(ctx, { y: 54, w: 28, smile: 0.9 }, SKIN.deep)
  const chin = part(ctx, 'chin', line(eat ? 'M -18,160 Q 0,166 18,160' : 'M -16,104 Q 0,110 16,104', SKIN.deep, 3))
  return part(ctx, 'face', wrinkles + cheeks + chin + mouth + nose + part(ctx, 'eyes', eyes + glasses(ctx)) + brows)
}

function cooker(ctx, x, y, s, whistling) {
  const steam = whistling
    ? inked('M -8,-62 C -22,-66 -24,-84 -10,-86 C -8,-100 12,-102 16,-90 C 30,-92 34,-74 22,-70 C 20,-62 2,-58 -8,-62 Z', '#ffffff', 5) +
      line('M -30,-92 l -10,-8 M 30,-100 l 8,-12 M 0,-110 l 0,-12', INK, 3.2)
    : fillP('M -2,-58 C -12,-66 6,-72 -2,-82 C 8,-76 12,-66 4,-58 Z', '#ffffff', ' opacity="0.85"')
  const g =
    // long bakelite handle
    inked('M 38,-22 L 104,-30 Q 112,-26 108,-18 L 42,-10 Z', '#2f2a2f', 6) +
    line('M 54,-20 L 96,-25', '#5a525a', 2.6) +
    inked('M -48,-14 L 48,-14 L 45,30 Q 43,42 30,42 L -30,42 Q -43,42 -45,30 Z', '#cdd5dc', 7) +
    fillP('M 20,-14 L 48,-14 L 45,30 Q 43,42 30,42 L 14,42 Q 28,30 20,-14 Z', '#9ea9b3') +
    fillP('M -36,-8 L -28,-8 L -28,34 L -36,34 Z', '#f3f6f8') +
    inked('M -54,-16 Q 0,-28 54,-16 Q 0,-4 -54,-16 Z', '#b9c2ca', 5) +
    inked('M -40,-22 Q 0,-34 40,-22 Q 0,-12 -40,-22 Z', '#e2e7eb', 4) +
    // the whistle weight
    inked('M -7,-28 L -7,-42 Q 0,-50 7,-42 L 7,-28 Z', '#3a363b', 4) +
    circle(-2, -42, 2, '#8a848c') +
    steam
  return part(ctx, 'cooker', `<g transform="translate(${x} ${y}) scale(${s})">${g}</g>`)
}

function bangles(x, y, rot) {
  return `<g transform="translate(${x} ${y}) rotate(${rot})">` + [0, 6, 12].map((d) => `<ellipse cx="0" cy="${d}" rx="13" ry="4.4" fill="none" stroke="${INK}" stroke-width="6.4"/><ellipse cx="0" cy="${d}" rx="13" ry="4.4" fill="none" stroke="${GOLD}" stroke-width="3.4"/>`).join('') + `</g>`
}

export function draw(ctx) {
  const eat = ctx.jaw > 0
  const H = headD({ T: -132, W: 104, S: -34, JW: 90, JY: 58, C: 98, cw: 36, jaw: ctx.jaw, drop: 56 })
  // gold stud earrings
  const studs = part(ctx, 'earrings', circle(-112, 22, 5.4, INK) + circle(-113, 21, 4.2, GOLD) + circle(112, 22, 5.4, INK) + circle(111, 21, 4.2, GOLD))
  const headG = part(
    ctx,
    'head',
    bun(ctx) + ears(ctx, SKIN, 100, -10, 0.92) + studs + part(ctx, 'skull', head(ctx, H, SKIN, { litRx: 112, litRy: 150, shineY: -104 })) + hair(ctx) + face(ctx),
    eat ? ' transform="rotate(-4 0 90)"' : ''
  )
  const sL = { x: -74, y: 108 }
  const sR = { x: 74, y: 108 }
  const sleeve = (side, s) => part(ctx, `sleeve${side}`, inked(`M ${P(s.x - 18, s.y - 10)} Q ${P(s.x, s.y - 22)} ${P(s.x + 18, s.y - 10)} L ${P(s.x + 16, s.y + 22)} Q ${P(s.x, s.y + 28)} ${P(s.x - 16, s.y + 22)} Z`, BLOUSE, 6))
  let arms
  let behind = ''
  if (eat) {
    const wL = { x: -134, y: 60 }
    const wR = { x: 134, y: 60 }
    behind =
      arm(ctx, 'L', sL, wL, { color: SKIN.base, width: 15, bend: -0.6 }) +
      arm(ctx, 'R', sR, wR, { color: SKIN.base, width: 15, bend: 0.6 }) +
      sleeve('L', sL) +
      sleeve('R', sR)
    arms =
      bangles(-132, 74, -24) +
      bangles(132, 74, 24) +
      hand(ctx, 'L', { x: -134, y: 60, rot: -20, skin: SKIN, cuff: SKIN.base }) +
      hand(ctx, 'R', { x: 134, y: 60, rot: 20, skin: SKIN, cuff: SKIN.base }) +
      cooker(ctx, -128, 182, 0.95, false)
  } else {
    arms =
      cooker(ctx, -112, 176, 1.05, true) +
      arm(ctx, 'L', sL, { x: -92, y: 150 }, { color: SKIN.base, width: 15, bend: 0.4 }) +
      sleeve('L', sL) +
      bangles(-92, 138, 10) +
      hand(ctx, 'L', { x: -88, y: 164, rot: -10, skin: SKIN, kind: 'fist' }) +
      arm(ctx, 'R', sR, { x: 112, y: 46 }, { color: SKIN.base, width: 15, bend: 0.5 }) +
      sleeve('R', sR) +
      bangles(112, 58, -14) +
      hand(ctx, 'R', { x: 108, y: 44, rot: -30, skin: SKIN, cuff: SKIN.base })
  }
  const file = eat ? fileCard(ctx, { label: 'PDF', color: '#d6453c' }) : ''
  return part(ctx, 'root', body(ctx) + chain(ctx) + behind + headG + arms + file)
}
