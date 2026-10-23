// 01 — Chacha Gappu (round 3 restyle): an older, lanky retired chacha so he no longer reads like
// Halwai Bhaiya. Tall egg-shaped head with a shiny bald dome, grey side hair with a side parting,
// thick black-rimmed reading glasses pushed up on his forehead, a neat grey moustache and the paan grin.
// Slim build: cream kurta under a navy waistcoat, the morning paper under his arm, a steel tumbler of
// cutting chai in his hand. Cool palette (navy / steel / cream) against Halwai's warm white-and-red.
import { INK, P, arm, circle, clip, ears, ell, eye, fileCard, fillP, hand, head, headD, inked, line, mirror, mouthClosed, mouthOpen, part } from '../lib.mjs'

export const meta = {
  num: '01',
  slug: 'chacha-gappu',
  name: 'Chacha Gappu',
  origin: 'India — the retired chacha on the colony bench, newspaper and opinions ready since 6 a.m.',
  signature: 'Thick black reading glasses pushed up on his bald head, a steel tumbler of chai, and the paan-red grin.',
  catchphrase: 'Arre wah!',
  eats: 'Lowers the newspaper, pulls his glasses down for a proper look, says “Arre wah!” and slurps the file like hot chai.',
  chews: 'Slow, thoughtful chewing with a sip of chai between bites; the glasses slide down his forehead at every chew.',
  spits: 'Folds the result neatly into the newspaper and hands it over with a proud “Le beta”.',
  bg: ['#e3eef0', '#c4dde0']
}

const SKIN = { base: '#d3a07a', shade: '#b07e5a', light: '#ecc39e', deep: '#88583c', blush: '#d9786a' }
const GREY = '#c9c6cc'
const GREY_SH = '#9a96a2'
const GREY_HI = '#ecebf0'
const KURTA = '#f4ecd9'
const KURTA_SH = '#d6cbb4'
const COAT = '#2d3f6e'
const COAT_SH = '#1f2c50'
const COAT_LT = '#4a5f92'
const STEEL = '#c3ccd4'
const STEEL_SH = '#8e9aa6'
const PAAN_RED = '#a8323e'

// Slim, sloping-shouldered torso (Halwai is a wide round dome).
const TORSO = 'M -58,96 C -104,104 -128,170 -120,236 L 120,236 C 128,170 104,104 58,96 Z'

function newspaper(ctx, x, y, rot) {
  const d = 'M -40,-26 L 40,-30 L 44,26 L -36,30 Z'
  return part(
    ctx,
    'newspaper',
    `<g transform="translate(${x} ${y}) rotate(${rot})">` +
      inked(d, '#f3efe4', 6) +
      fillP('M 40,-30 L 44,26 L 30,27 L 27,-29 Z', '#d8d2c2') +
      `<rect x="-32" y="-22" width="54" height="9" fill="#3a3a42"/>` +
      line('M -32,-4 L 20,-6 M -32,4 L 22,2 M -32,12 L 6,11 M -32,20 L 18,19', '#9b978e', 2.6) +
      line('M 34,-26 L 37,22', INK, 1.8) +
      `</g>`
  )
}

function tumbler(ctx, x, y, rot, eat) {
  const cup = 'M -14,-22 L 14,-22 L 11,18 Q 0,22 -11,18 Z'
  const steam = eat
    ? line('M 4,-30 l -6,-8 M 12,-28 l 2,-10', '#7fb6d4', 3) + circle(18, -40, 3, '#c9874a') + circle(26, -32, 2.4, '#c9874a')
    : line('M -4,-30 Q -10,-40 -4,-48 Q 2,-56 -4,-64 M 6,-30 Q 0,-42 6,-50', '#ffffff', 3.4, ' opacity="0.9"')
  return part(
    ctx,
    'tumbler',
    `<g transform="translate(${x} ${y}) rotate(${rot})">` +
      steam +
      inked(cup, STEEL, 6) +
      fillP('M 6,-22 L 14,-22 L 11,18 Q 6,20 3,20 Z', STEEL_SH) +
      fillP('M -9,-18 L -5,-18 L -6,14 L -9,14 Z', '#f4f8fb') +
      `<ellipse cx="0" cy="-22" rx="14" ry="4" fill="#9a5a2c" stroke="${INK}" stroke-width="2.4"/>` +
      ell(-3, -23, 6, 1.6, '#c9874a') +
      line('M -13,-10 L 13,-10', STEEL_SH, 1.6) +
      `</g>`
  )
}

function body(ctx) {
  const c = clip(ctx, 'torso', TORSO)
  // open waistcoat: two navy panels over the kurta, kurta placket in the V
  const PANEL_L = 'M -58,96 C -104,104 -128,170 -120,236 L -14,236 L -12,150 L -26,100 Z'
  const buttons = [128, 156, 184, 212].map((y) => circle(1, y + 1, 3.6, INK) + circle(0, y, 2.8, '#f8f4ea')).join('')
  return part(
    ctx,
    'body',
    inked(TORSO, KURTA, 9) +
      `<g ${c}>` +
      fillP('M 10,100 L 40,236 L 0,236 Z', KURTA_SH) +
      line('M 0,108 L 0,236', KURTA_SH, 3) +
      buttons +
      inked(PANEL_L, COAT, 5) +
      inked(mirror(PANEL_L), COAT, 5, { off: 'translate(1.6 2.2)' }) +
      ell(-70, 150, 34, 70, COAT_LT, -8, ' opacity="0.55"') +
      fillP('M 60,110 C 100,130 116,180 116,236 L 70,236 C 80,190 80,140 60,110 Z', COAT_SH) +
      // welt pockets + a pen
      fillP('M -92,176 L -50,172 L -49,180 L -91,184 Z', COAT_SH) +
      fillP('M 50,172 L 92,176 L 91,184 L 49,180 Z', COAT_SH) +
      `<rect x="62" y="128" width="5" height="20" rx="2" fill="#e6c25a" stroke="${INK}" stroke-width="1.6"/>` +
      fillP('M 50,144 L 90,148 L 89,155 L 49,151 Z', COAT_SH) +
      // waistcoat buttons
      [140, 172, 204].map((y) => circle(-17, y + 1, 4.4, INK) + circle(-18, y, 3.4, '#d7b24c')).join('') +
      `</g>` +
      // kurta band collar
      inked('M -30,94 Q 0,106 30,94 L 28,84 Q 0,96 -28,84 Z', KURTA, 5)
  )
}

function hair(ctx) {
  // bald dome; grey hair only around the sides and back, combed with a side parting on the left
  const SIDE_R = 'M 92,-110 C 108,-96 112,-70 108,-36 C 106,-20 104,-6 100,4 C 94,-12 90,-30 88,-50 C 84,-74 82,-92 76,-104 C 82,-110 88,-112 92,-110 Z'
  const SIDE_L = 'M -84,-120 C -104,-108 -114,-80 -110,-40 C -108,-22 -106,-8 -100,4 C -94,-14 -92,-32 -90,-52 C -88,-76 -82,-96 -66,-110 C -56,-118 -40,-124 -26,-128 C -44,-132 -66,-128 -84,-120 Z'
  return part(
    ctx,
    'hair',
    inked(SIDE_R, GREY, 6) +
      inked(SIDE_L, GREY, 6) +
      fillP('M 100,-60 C 104,-40 104,-16 100,4 C 96,-14 94,-34 92,-52 Z', GREY_SH) +
      line('M -96,-100 Q -102,-80 -100,-56 M -84,-112 Q -92,-96 -94,-72 M -60,-120 Q -76,-112 -84,-96', GREY_HI, 2.6) +
      line('M 96,-92 Q 100,-72 98,-50', GREY_HI, 2.6) +
      // the parting line
      line('M -28,-128 Q -60,-124 -80,-112', INK, 2.4) +
      // three brave strands across the bald patch
      line('M -30,-128 Q 0,-150 30,-146 M -26,-124 Q 4,-142 36,-136', GREY_SH, 2.4)
  )
}

function glasses(ctx, eat) {
  // thick black frames pushed up on the forehead; in the eat pose they have slid halfway down
  const y = eat ? -92 : -108
  const rim = (cx) => `<rect x="${cx - 24}" y="${y - 15}" width="48" height="30" rx="11" fill="#bcd9e6" fill-opacity="0.55" stroke="${INK}" stroke-width="7"/>` + line(`M ${P(cx - 14, y - 7)} L ${P(cx - 4, y - 9)}`, '#ffffff', 3)
  return part(
    ctx,
    'glasses',
    line(`M -82,${y - 2} L -96,${y + 8} M 82,${y - 2} L 96,${y + 8}`, INK, 6) + rim(-32) + rim(32) + line(`M -8,${y - 4} Q 0,${y - 9} 8,${y - 4}`, INK, 6)
  )
}

function face(ctx) {
  const eat = ctx.jaw > 0
  const look = ctx.look
  const lid = eat ? 0.02 : 0.36
  const browY = eat ? -10 : 0
  // bushy grey brows that droop at the outer ends (older)
  const BROW = 'M 14,-66 C 20,-80 46,-84 62,-76 C 70,-72 74,-64 74,-58 C 64,-66 48,-70 34,-66 C 26,-64 20,-62 14,-66 Z'
  const e = { rx: 15, ry: 17, pr: 7, look, lid, lidFill: SKIN.base, iris: '#5a3a24', smile: eat ? 0 : 0.25 }
  const eyes = eye(ctx, 'L', { cx: -34, cy: -36, ...e }) + eye(ctx, 'R', { cx: 34, cy: -36, ...e })
  const crow = line('M -56,-44 l -10,-4 M -56,-34 l -11,0 M -56,-24 l -10,4 M 56,-44 l 10,-4 M 56,-34 l 11,0 M 56,-24 l 10,4', SKIN.deep, 2.4)
  const brows = part(
    ctx,
    'brows',
    part(ctx, 'browR', inked(BROW, GREY, 5), ` transform="translate(0 ${browY}) rotate(${eat ? -8 : 4} 44 -72)"`) +
      part(ctx, 'browL', inked(mirror(BROW), GREY, 5, { off: 'translate(-0.6 2.2)' }), ` transform="translate(0 ${browY}) rotate(${eat ? 8 : -4} -44 -72)"`)
  )
  // long, narrow nose (Halwai's is a round blob)
  const NOSE = 'M -6,-30 C -10,-10 -24,4 -22,18 C -20,30 -8,32 0,28 C 8,32 20,30 22,18 C 24,4 10,-10 6,-30 C 2,-33 -2,-33 -6,-30 Z'
  const nose = part(ctx, 'nose', inked(NOSE, '#d9a07a', 7) + fillP('M 20,8 C 24,22 16,30 4,29 C 14,26 20,18 20,8 Z', '#b07e5a') + ell(-9, 6, 5, 8, '#efc29c', -10) + line('M -12,24 Q -8,28 -3,26 M 3,26 Q 8,28 12,24', INK, 2.4))
  // neat, trimmed grey moustache
  const MOUS = 'M 0,34 C 10,30 30,30 42,38 C 46,42 44,48 40,48 C 30,44 18,44 8,46 C 4,46 2,46 0,47 C -2,46 -4,46 -8,46 C -18,44 -30,44 -40,48 C -44,48 -46,42 -42,38 C -30,30 -10,30 0,34 Z'
  const moustache = part(ctx, 'moustache', `<g transform="translate(0 ${eat ? -6 : 0})">` + inked(MOUS, GREY, 6) + fillP('M 10,44 C 22,42 34,43 40,48 C 30,46 20,45 10,44 Z', GREY_SH) + `</g>`)
  const cheeks = part(
    ctx,
    'cheeks',
    ell(-62, eat ? 14 : 20, 16, 9, SKIN.blush, 0, ' opacity="0.45"') +
      ell(62, eat ? 14 : 20, 16, 9, SKIN.blush, 0, ' opacity="0.45"') +
      line(eat ? 'M -54,36 Q -64,62 -62,96 M 54,36 Q 64,62 62,96' : 'M -34,32 Q -50,48 -50,74 M 34,32 Q 50,48 50,74', SKIN.deep, 3)
  )
  const mouth = eat
    ? mouthOpen(ctx, { top: 60, w: 54, bottom: 148, corner: 64, gap: [1, 4], tongue: '#d8424f', teethColor: '#f3dcc6' }, SKIN.deep)
    : mouthClosed(ctx, { y: 70, w: 32, smile: 0.85, style: 'grin', teethColor: '#f2d2c0' }, PAAN_RED)
  const stain = eat ? '' : fillP('M 24,72 Q 30,78 27,84 Q 23,80 24,72 Z', PAAN_RED, ' opacity="0.75"')
  const chin = part(ctx, 'chin', line(eat ? 'M -22,176 Q 0,184 22,176' : 'M -26,112 Q 0,122 26,112', SKIN.deep, 3))
  const wrinkles = part(ctx, 'wrinkles', line('M -40,-100 Q 0,-108 40,-100 M -30,-90 Q 0,-96 30,-90', SKIN.shade, 2.6))
  return part(ctx, 'face', wrinkles + cheeks + chin + mouth + stain + moustache + nose + part(ctx, 'eyes', eyes + crow) + brows)
}

export function draw(ctx) {
  const eat = ctx.jaw > 0
  // tall egg: narrow jaw, high crown (T −176 vs Halwai's −132; W 96 vs 120)
  const H = headD({ T: -176, W: 96, S: -50, JW: 76, JY: 64, C: 110, cw: 34, crown: 0.5, jaw: ctx.jaw, drop: 60 })
  const skull = head(ctx, H, SKIN, { litRx: 104, litRy: 176, litCy: -40, litDx: -14, shineY: -146, shineX: -30, hatch: 'M 78,-6 l 12,-10 M 80,10 l 12,-10 M 78,26 l 11,-9' })
  const headG = part(ctx, 'head', ears(ctx, SKIN, 90, -26, 0.92) + part(ctx, 'skull', skull) + hair(ctx) + face(ctx) + glasses(ctx, eat), eat ? ' transform="rotate(-4 0 90)"' : '')
  const sL = { x: -70, y: 112 }
  const sR = { x: 70, y: 112 }
  let arms
  if (eat) {
    arms =
      newspaper(ctx, -112, 196, 14) +
      arm(ctx, 'L', sL, { x: -132, y: 62 }, { color: KURTA, width: 16, bend: -0.6 }) +
      arm(ctx, 'R', sR, { x: 134, y: 74 }, { color: KURTA, width: 16, bend: 0.6 }) +
      hand(ctx, 'L', { x: -132, y: 62, rot: -20, skin: SKIN, cuff: KURTA }) +
      tumbler(ctx, 142, 34, 18, true) +
      hand(ctx, 'R', { x: 136, y: 74, rot: 0, skin: SKIN, kind: 'fist', flip: true })
  } else {
    arms =
      arm(ctx, 'L', sL, { x: -96, y: 196 }, { color: KURTA, width: 16, bend: 0.3 }) +
      newspaper(ctx, -112, 166, -12) +
      hand(ctx, 'L', { x: -94, y: 200, rot: 10, skin: SKIN, kind: 'fist' }) +
      arm(ctx, 'R', sR, { x: 100, y: 168 }, { color: KURTA, width: 16, bend: -0.5 }) +
      tumbler(ctx, 104, 140, 0, false) +
      hand(ctx, 'R', { x: 100, y: 168, rot: 0, skin: SKIN, kind: 'fist', flip: true })
  }
  const file = eat ? fileCard(ctx, { label: 'JPG', color: '#e0664f' }) : ''
  return part(ctx, 'root', body(ctx) + headG + arms + file)
}
