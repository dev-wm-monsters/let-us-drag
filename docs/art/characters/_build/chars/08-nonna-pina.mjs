// 08 — Nonna Pina: Italian grandma. White curly perm, rosy cheeks dusted with flour, pearl necklace,
// black dress under a red gingham apron. Signature: the rolling pin (and the flour on her cheeks).
import { INK, P, arm, circle, clip, ears, ell, eye, fileCard, fillP, hand, happyEye, head, headD, inked, line, mirror, mouthClosed, mouthOpen, part } from '../lib.mjs'

export const meta = {
  num: '08',
  slug: 'nonna-pina',
  name: 'Nonna Pina',
  origin: 'Italy — a nonna from a little town where Sunday lunch lasts until dinner',
  signature: 'Her rolling pin and the flour dusted on her cheeks (plus a floury handprint on the apron).',
  catchphrase: 'Mangia, mangia!',
  eats: 'Dusts the file with flour, rolls it flat with her rolling pin and slurps it like a ribbon of tagliatelle.',
  chews: 'Kneads while she chews — the progress ring fills like dough rising.',
  spits: 'Cuts the result into neat pasta-shaped cards: “Perfetto!” with a chef’s kiss.',
  bg: ['#eef6e4', '#d3e9bd']
}

const SKIN = { base: '#f5c4a0', shade: '#dc9f7c', light: '#ffe0c8', deep: '#b8775a', blush: '#f07b72' }
const HAIR = '#f4f2f6'
const HAIR_SH = '#c9c3d2'
const DRESS = '#2d2a33'
const DRESS_SH = '#1c1a21'
const GING = '#d8433b'
const FLOUR = '#fffdf8'

const TORSO = 'M -70,92 C -122,100 -146,166 -128,196 C -94,216 94,216 128,196 C 146,166 122,100 70,92 Z'

function body(ctx) {
  const c = clip(ctx, 'torso', TORSO)
  const APRON = 'M -70,128 L 70,128 C 96,150 112,190 112,220 L -112,220 C -112,190 -96,150 -70,128 Z'
  const ac = clip(ctx, 'apron', APRON)
  const gingham = []
  for (let i = -8; i <= 8; i++) gingham.push(`<rect x="${i * 16 - 4}" y="120" width="8" height="110" fill="${GING}" opacity="0.55"/>`)
  for (let j = 0; j < 7; j++) gingham.push(`<rect x="-130" y="${124 + j * 16}" width="260" height="8" fill="${GING}" opacity="0.55"/>`)
  return part(
    ctx,
    'body',
    inked(TORSO, DRESS, 9) +
      `<g ${c}>` +
      fillP('M 64,104 C 120,124 136,180 112,216 L 60,216 C 104,190 108,140 64,104 Z', DRESS_SH) +
      inked(APRON, '#fff', 5) +
      `<g ${ac}>${gingham.join('')}${fillP('M 50,128 L 70,128 C 96,150 112,190 112,220 L 74,220 C 84,180 70,150 50,128 Z', '#000', ' opacity="0.12"')}` +
      // floury handprint
      `<g transform="translate(-40 176) rotate(-14)" opacity="0.9">${fillP('M -10,8 C -14,-2 -12,-10 -8,-12 L -9,-26 Q -6,-30 -3,-26 L -2,-12 L -1,-30 Q 2,-34 5,-30 L 5,-12 L 8,-28 Q 11,-31 13,-27 L 11,-10 L 15,-20 Q 18,-22 19,-18 L 15,-2 C 13,8 4,12 -10,8 Z', FLOUR)}</g>` +
      `</g>` +
      `</g>` +
      line('M -70,128 L 70,128', INK, 3) +
      // lace collar + pearls
      inked('M -40,90 Q 0,118 40,90 L 44,98 Q 0,130 -44,98 Z', '#fbf7ee', 4) +
      [-36, -24, -12, 0, 12, 24, 36].map((x) => circle(x + 0.8, 112 - (36 - Math.abs(x)) * 0.36 + 1.2, 5.6, INK) + circle(x, 112 - (36 - Math.abs(x)) * 0.36, 4.6, '#fbf8f2') + circle(x - 1.4, 110.6 - (36 - Math.abs(x)) * 0.36, 1.4, '#fff')).join('')
  )
}

function hair(ctx) {
  // a cloud of tight white curls (perm)
  const curls = [
    [-98, -60, 24], [-104, -92, 24], [-84, -122, 26], [-50, -142, 27], [-12, -152, 28], [28, -148, 27], [64, -132, 26], [92, -104, 24], [104, -70, 22],
    [-60, -112, 22], [-20, -124, 22], [20, -122, 22], [58, -106, 20]
  ]
  const ink = curls.map(([x, y, r]) => `<circle cx="${x + 1.6}" cy="${y + 2.2}" r="${r + 3.6}" fill="${INK}"/>`).join('')
  const fill = curls.map(([x, y, r]) => circle(x, y, r, HAIR)).join('')
  const swirls = curls.map(([x, y, r]) => line(`M ${P(x - r * 0.4, y + r * 0.2)} Q ${P(x - r * 0.3, y - r * 0.5)} ${P(x + r * 0.3, y - r * 0.3)} Q ${P(x + r * 0.5, y + r * 0.2)} ${P(x, y + r * 0.3)}`, HAIR_SH, 2.6)).join('')
  return part(ctx, 'hair', ink + fill + swirls)
}

function face(ctx) {
  const eat = ctx.jaw > 0
  const look = ctx.look
  const eyes = eat
    ? eye(ctx, 'L', { cx: -38, cy: -30, rx: 17, ry: 19, pr: 8.5, look, lid: 0, lidFill: SKIN.base, iris: '#4f6f3a' }) + eye(ctx, 'R', { cx: 38, cy: -30, rx: 17, ry: 19, pr: 8.5, look, lid: 0, lidFill: SKIN.base, iris: '#4f6f3a' })
    : happyEye(ctx, 'L', -38, -28, 16) + happyEye(ctx, 'R', 38, -28, 16)
  const crow = line('M -62,-30 l -10,-6 M -62,-22 l -12,0 M -62,-14 l -10,6 M 62,-30 l 10,-6 M 62,-22 l 12,0 M 62,-14 l 10,6', SKIN.deep, 2.6)
  const BROW = 'M 16,-58 C 26,-70 50,-74 66,-62 C 54,-66 38,-64 26,-56 Z'
  const bY = eat ? -14 : -4
  const brows = part(
    ctx,
    'brows',
    part(ctx, 'browR', inked(BROW, HAIR_SH, 5), ` transform="translate(0 ${bY}) rotate(${eat ? 4 : 8} 40 -62)"`) +
      part(ctx, 'browL', inked(mirror(BROW), HAIR_SH, 5, { off: 'translate(-0.6 2.2)' }), ` transform="translate(0 ${bY}) rotate(${eat ? -4 : -8} -40 -62)"`)
  )
  const NOSE = 'M -6,-14 C -9,-2 -22,4 -21,14 C -20,24 -8,26 0,22 C 8,26 20,24 21,14 C 22,4 9,-2 6,-14 C 3,-17 -3,-17 -6,-14 Z'
  const nose = part(ctx, 'nose', inked(NOSE, '#f6ae8f', 6) + fillP('M 19,8 C 22,18 15,25 4,24 C 12,22 17,16 19,8 Z', '#d98a6c') + ell(-8, 6, 6, 4, '#ffe0cf', -20) + line('M -10,19 Q -6,23 -2,21 M 2,21 Q 6,23 10,19', INK, 2.4))
  // flour dust: soft white smudges + a few specks
  const flour = part(ctx, 'flour', `<g opacity="0.92">${fillP('M -92,10 C -88,-2 -70,-4 -60,4 C -52,10 -60,22 -74,22 C -86,24 -96,20 -92,10 Z', FLOUR)}${fillP('M 60,14 C 64,6 80,4 86,12 C 90,20 80,26 70,24 C 62,22 58,20 60,14 Z', FLOUR)}${fillP('M 20,-92 C 26,-98 40,-96 40,-88 C 38,-82 26,-82 20,-92 Z', FLOUR)}</g>` + [[-66, 30], [-54, 18], [74, 30], [88, 2], [30, -100]].map(([x, y]) => circle(x, y, 2, FLOUR)).join(''))
  const cheeks = part(ctx, 'cheeks', ell(-68, eat ? 4 : 12, 20, 13, SKIN.blush, 0, ' opacity="0.65"') + ell(68, eat ? 4 : 12, 20, 13, SKIN.blush, 0, ' opacity="0.65"') + line(eat ? 'M -48,30 Q -60,54 -58,80 M 48,30 Q 60,54 58,80' : 'M -30,30 Q -46,40 -46,56 M 30,30 Q 46,40 46,56', SKIN.deep, 3))
  const mouth = eat ? mouthOpen(ctx, { top: 46, w: 60, bottom: 128, corner: 50, gap: [2], teethN: 5 }, SKIN.deep) : mouthClosed(ctx, { y: 48, w: 24, smile: 0.95 }, SKIN.deep)
  const chin = part(ctx, 'chin', line(eat ? 'M -14,150 Q 0,156 14,150' : 'M -14,94 Q 0,100 14,94', SKIN.deep, 3))
  return part(ctx, 'face', cheeks + flour + chin + mouth + nose + part(ctx, 'eyes', eyes + (eat ? '' : crow)) + brows)
}

function pin(ctx, x, y, rot, sc = 1) {
  const g =
    inked('M -78,-6 L -58,-6 L -58,6 L -78,6 Q -84,0 -78,-6 Z', '#b77a42', 4) +
    inked('M 78,-6 L 58,-6 L 58,6 L 78,6 Q 84,0 78,-6 Z', '#b77a42', 4) +
    inked('M -58,-14 L 58,-14 Q 64,0 58,14 L -58,14 Q -64,0 -58,-14 Z', '#e2b07a', 6) +
    fillP('M -58,4 L 58,4 Q 62,8 58,14 L -58,14 Z', '#c48c55') +
    line('M -50,-8 L 40,-8', '#f4d3a6', 3) +
    `<g opacity="0.9">${fillP('M -20,-14 C -16,-20 -2,-20 4,-14 Z', FLOUR)}${circle(20, -10, 2.4, FLOUR)}${circle(-36, 8, 2, FLOUR)}</g>`
  return part(ctx, 'rollingPin', `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${sc})">${g}</g>`)
}

export function draw(ctx) {
  const eat = ctx.jaw > 0
  const H = headD({ T: -126, W: 100, S: -30, JW: 90, JY: 52, C: 90, cw: 42, jaw: ctx.jaw, drop: 56 })
  const headG = part(ctx, 'head', ears(ctx, SKIN, 96, -8, 0.9) + part(ctx, 'skull', head(ctx, H, SKIN, { litRx: 108, litRy: 140, shineY: -96, hatch: false })) + hair(ctx) + face(ctx) + part(ctx, 'earrings', circle(-108, 26, 5.4, INK) + circle(-109, 25, 4.2, '#fbf8f2') + circle(108, 26, 5.4, INK) + circle(107, 25, 4.2, '#fbf8f2')), eat ? ' transform="rotate(-4 0 90)"' : '')
  const sL = { x: -80, y: 110 }
  const sR = { x: 80, y: 110 }
  let arms
  let behind = ''
  if (eat) {
    behind = arm(ctx, 'L', sL, { x: -132, y: 62 }, { color: DRESS, width: 17, bend: -0.6 }) + arm(ctx, 'R', sR, { x: 132, y: 62 }, { color: DRESS, width: 17, bend: 0.6 })
    arms = hand(ctx, 'L', { x: -132, y: 62, rot: -20, skin: SKIN, cuff: '#fbf7ee' }) + pin(ctx, 150, 4, 74) + hand(ctx, 'R', { x: 134, y: 62, rot: 0, skin: SKIN, kind: 'fist' })
  } else {
    arms =
      arm(ctx, 'L', sL, { x: -84, y: 164 }, { color: DRESS, width: 17, bend: 0.5 }) +
      arm(ctx, 'R', sR, { x: 84, y: 160 }, { color: DRESS, width: 17, bend: -0.5 }) +
      pin(ctx, 0, 162, -4, 1.3) +
      hand(ctx, 'L', { x: -86, y: 170, rot: 0, skin: SKIN, kind: 'fist' }) +
      hand(ctx, 'R', { x: 86, y: 164, rot: 0, skin: SKIN, kind: 'fist', flip: true })
  }
  const file = eat ? fileCard(ctx, { label: 'DOC', color: '#3c6fd1' }) : ''
  return part(ctx, 'root', body(ctx) + behind + headG + arms + file)
}
