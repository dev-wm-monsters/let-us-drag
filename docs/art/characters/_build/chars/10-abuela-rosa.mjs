// 10 — Abuela Rosa: chubby Mexican grandma. Grey hair in a bun with a big red flower, a striped
// rebozo over her shoulders, an embroidered blouse, gold drop earrings. Signature: wooden spoon + clay olla.
import { INK, arm, circle, clip, ears, ell, eye, fileCard, fillP, hand, head, headD, inked, line, mirror, mouthClosed, mouthOpen, part } from '../lib.mjs'

export const meta = {
  num: '10',
  slug: 'abuela-rosa',
  name: 'Abuela Rosa',
  origin: 'Mexico — the abuela whose kitchen always smells of something wonderful',
  signature: 'Her clay olla simmering away and the wooden spoon she points with; a big red flower in her grey bun.',
  catchphrase: '¡Ay, mijo, come!',
  eats: 'Taps the file with her wooden spoon — “¡Ay, qué flaquito!” — and eats it in one loving gulp.',
  chews: 'Stirs the olla while she chews; the steam curls into the progress ring.',
  spits: 'Ladles the result out of the olla, still steaming: “Ándale, it’s ready.”',
  bg: ['#fdeee0', '#f8cfa6']
}

const SKIN = { base: '#d19b72', shade: '#b07b55', light: '#e9b892', deep: '#86533a', blush: '#e06c5c' }
const HAIR = '#d8d4dc'
const HAIR_SH = '#a9a3b1'
const BLOUSE = '#fbf7ee'
const CLAY = '#c4683a'
const CLAY_SH = '#9a4d27'

const TORSO = 'M -76,92 C -132,100 -158,170 -136,198 C -100,218 100,218 136,198 C 158,170 132,100 76,92 Z'

function body(ctx) {
  const c = clip(ctx, 'torso', TORSO)
  const REBOZO = 'M -150,96 C -100,92 -60,110 -36,140 L 0,214 L -160,214 Z M 150,96 C 100,92 60,110 36,140 L 0,214 L 160,214 Z'
  const rc = clip(ctx, 'rebozo', REBOZO)
  const bands = ['#e0457b', '#2f9a8f', '#f2b73a', '#7b3fa6', '#e0457b', '#2f9a8f', '#f2b73a'].map((col, i) => `<rect x="-200" y="${88 + i * 18}" width="400" height="18" fill="${col}" transform="rotate(${i % 2 ? 0 : 0})"/>`).join('')
  return part(
    ctx,
    'body',
    inked(TORSO, BLOUSE, 9) +
      `<g ${c}>` +
      // embroidered neckline
      [-36, -24, -12, 0, 12, 24, 36].map((x, i) => circle(x, 112 + Math.abs(x) * -0.3 + 10, 4, ['#e0457b', '#2f9a8f', '#f2b73a', '#7b3fa6'][i % 4])).join('') +
      `<g ${rc}>${bands}${[96, 114, 132, 150, 168, 186, 204].map((y) => line(`M -200,${y} L 200,${y}`, '#ffffff', 1.6, ' opacity="0.5" stroke-dasharray="3 4"')).join('')}${fillP('M 60,100 L 160,100 L 160,214 L 90,214 Z', '#000', ' opacity="0.14"')}</g>` +
      `</g>` +
      line('M -150,96 C -100,92 -60,110 -36,140 L -6,206 M 150,96 C 100,92 60,110 36,140 L 6,206', INK, 3) +
      inked('M -40,90 Q 0,112 40,90 L 36,100 Q 0,120 -36,100 Z', BLOUSE, 4)
  )
}

function hair(ctx) {
  const capR = 'M 0,-108 C 30,-112 70,-98 92,-70 C 102,-56 106,-40 106,-20 C 114,-40 114,-86 96,-110 C 74,-134 40,-140 0,-138 Z'
  const bun = inked('M -40,-140 C -46,-176 -10,-190 8,-186 C 40,-186 52,-160 42,-142 Z', HAIR, 7) + line('M -26,-160 Q 0,-180 30,-164 M -30,-148 Q 0,-166 38,-150', HAIR_SH, 3)
  const flower =
    `<g transform="translate(86 -116)">` +
    [0, 72, 144, 216, 288].map((a) => `<g transform="rotate(${a})">${inked('M 0,0 C -14,-8 -12,-30 0,-30 C 12,-30 14,-8 0,0 Z', '#e23a3a', 4)}</g>`).join('') +
    circle(0, 0, 7, '#f6c53e') +
    circle(-2, -2, 2.4, '#fff3b0') +
    inked('M -22,10 C -34,4 -44,16 -38,22 C -30,24 -24,18 -22,10 Z', '#3f9a4a', 3) +
    `</g>`
  return part(ctx, 'bun', bun) + part(ctx, 'hair', inked(capR, HAIR, 7) + inked(mirror(capR), HAIR, 7, { off: 'translate(-0.6 2.2)' }) + line('M 10,-122 Q 50,-124 84,-96 M 16,-110 Q 54,-110 92,-78 M -10,-122 Q -50,-124 -84,-96 M -16,-110 Q -54,-110 -92,-78', HAIR_SH, 2.8) + line('M 0,-138 L 0,-108', SKIN.shade, 3)) + part(ctx, 'flower', flower)
}

function face(ctx) {
  const eat = ctx.jaw > 0
  const look = ctx.look
  const e = { rx: 17, ry: 19, pr: 8.5, look, lid: eat ? 0 : 0.18, lidFill: SKIN.base, iris: '#4a2a18', smile: eat ? 0 : 0.4 }
  const eyes = eye(ctx, 'L', { cx: -40, cy: -30, ...e }) + eye(ctx, 'R', { cx: 40, cy: -30, ...e }) + line('M -66,-26 l -10,-4 M -66,-16 l -10,2 M 66,-26 l 10,-4 M 66,-16 l 10,2', SKIN.deep, 2.6)
  const BROW = 'M 16,-60 C 28,-74 56,-76 72,-62 C 58,-70 40,-68 26,-58 C 22,-56 18,-56 16,-60 Z'
  const bY = eat ? -14 : -2
  const brows = part(
    ctx,
    'brows',
    part(ctx, 'browR', inked(BROW, HAIR_SH, 5), ` transform="translate(0 ${bY}) rotate(${eat ? 6 : 8} 44 -64)"`) +
      part(ctx, 'browL', inked(mirror(BROW), HAIR_SH, 5, { off: 'translate(-0.6 2.2)' }), ` transform="translate(0 ${bY}) rotate(${eat ? -6 : -8} -44 -64)"`)
  )
  const NOSE = 'M -7,-16 C -10,-2 -26,4 -25,16 C -24,27 -10,29 0,25 C 10,29 24,27 25,16 C 26,4 10,-2 7,-16 C 3,-19 -3,-19 -7,-16 Z'
  const nose = part(ctx, 'nose', inked(NOSE, '#d08e66', 6) + fillP('M 23,10 C 26,20 18,28 4,27 C 14,25 20,18 23,10 Z', '#a5674a') + ell(-9, 8, 6, 4, '#ecb892', -20) + line('M -12,22 Q -8,26 -3,24 M 3,24 Q 8,26 12,22', INK, 2.4))
  const cheeks = part(ctx, 'cheeks', ell(-72, eat ? 12 : 20, 22, 14, SKIN.blush, 0, ' opacity="0.6"') + ell(72, eat ? 12 : 20, 22, 14, SKIN.blush, 0, ' opacity="0.6"') + line(eat ? 'M -54,36 Q -66,60 -66,86 M 54,36 Q 66,60 66,86' : 'M -32,32 Q -50,44 -52,62 M 32,32 Q 50,44 52,62', SKIN.deep, 3))
  const mouth = eat ? mouthOpen(ctx, { top: 54, w: 64, bottom: 136, corner: 58, gap: [4] }, SKIN.deep) : mouthClosed(ctx, { y: 56, w: 28, smile: 0.95 }, SKIN.deep)
  const chin = part(ctx, 'chin', line(eat ? 'M -36,160 Q 0,172 36,160' : 'M -38,104 Q 0,118 38,104', SKIN.deep, 3))
  const earrings = part(ctx, 'earrings', [-1, 1].map((s) => line(`M ${s * 110},20 L ${s * 111},34`, INK, 3.4) + inked(`M ${s * 111 - 6},34 Q ${s * 111},46 ${s * 111 + 6},34 Q ${s * 111},30 ${s * 111 - 6},34 Z`, '#f2bd47', 3)).join(''))
  return part(ctx, 'face', cheeks + chin + mouth + nose + part(ctx, 'eyes', eyes) + brows + earrings)
}

function olla(ctx, x, y, s, steam) {
  const g =
    inked('M -40,-20 C -58,-6 -56,34 -30,44 C -10,52 10,52 30,44 C 56,34 58,-6 40,-20 Z', CLAY, 7) +
    fillP('M 20,-16 C 48,-6 50,30 28,42 C 18,46 8,48 0,48 C 30,34 40,8 20,-16 Z', CLAY_SH) +
    inked('M -30,-34 L 30,-34 L 36,-20 L -36,-20 Z', CLAY, 5) +
    inked('M -34,-38 Q 0,-46 34,-38 Q 0,-30 -34,-38 Z', '#5a2a14', 4) +
    inked('M -52,-10 C -66,-12 -66,8 -52,6', 'none', 6) +
    line('M -52,-10 C -66,-12 -66,8 -52,6 M 52,-10 C 66,-12 66,8 52,6', CLAY, 4) +
    line('M -40,8 Q 0,16 40,8', '#f2d28a', 3) +
    [-24, -8, 8, 24].map((xx) => circle(xx, 22, 3, '#f2d28a')).join('') +
    (steam ? line('M -12,-48 C -20,-60 -4,-66 -12,-80 M 10,-50 C 2,-62 18,-68 10,-84', '#ffffff', 4, ' opacity="0.9"') : '')
  return part(ctx, 'olla', `<g transform="translate(${x} ${y}) scale(${s})">${g}</g>`)
}

function spoon(ctx, x, y, rot) {
  const g = inked('M -4,0 L 4,0 L 5,-80 L -5,-80 Z', '#c99257', 4) + inked('M -13,-90 C -14,-112 14,-112 13,-90 C 12,-78 -12,-78 -13,-90 Z', '#d9a56a', 5) + fillP('M 4,-104 C 10,-98 10,-88 4,-84 C 6,-92 6,-98 4,-104 Z', '#b07a42')
  return part(ctx, 'spoon', `<g transform="translate(${x} ${y}) rotate(${rot})">${g}</g>`)
}

export function draw(ctx) {
  const eat = ctx.jaw > 0
  const H = headD({ T: -132, W: 108, S: -32, JW: 100, JY: 60, C: 100, cw: 48, jaw: ctx.jaw, drop: 56 })
  const headG = part(ctx, 'head', ears(ctx, SKIN, 104, -10, 0.92) + part(ctx, 'skull', head(ctx, H, SKIN, { litRx: 118, litRy: 150, shineY: -100, hatch: false })) + hair(ctx) + face(ctx), eat ? ' transform="rotate(-4 0 90)"' : '')
  const sL = { x: -84, y: 110 }
  const sR = { x: 84, y: 110 }
  let arms
  let behind = ''
  if (eat) {
    behind = arm(ctx, 'L', sL, { x: -138, y: 60 }, { color: SKIN.base, width: 20, bend: -0.6 }) + arm(ctx, 'R', sR, { x: 138, y: 64 }, { color: SKIN.base, width: 20, bend: 0.6 })
    arms = hand(ctx, 'L', { x: -138, y: 60, rot: -20, skin: SKIN, cuff: BLOUSE }) + spoon(ctx, 144, 66, 14) + hand(ctx, 'R', { x: 140, y: 66, rot: 0, skin: SKIN, kind: 'fist' }) + olla(ctx, -128, 180, 0.9, true)
  } else {
    arms =
      olla(ctx, -116, 172, 1, true) +
      arm(ctx, 'L', sL, { x: -96, y: 150 }, { color: SKIN.base, width: 20, bend: 0.4 }) +
      hand(ctx, 'L', { x: -94, y: 150, rot: -60, skin: SKIN, cuff: BLOUSE }) +
      arm(ctx, 'R', sR, { x: 130, y: 90 }, { color: SKIN.base, width: 20, bend: 0.5 }) +
      spoon(ctx, 134, 94, 20) +
      hand(ctx, 'R', { x: 130, y: 92, rot: 0, skin: SKIN, kind: 'fist' })
  }
  const file = eat ? fileCard(ctx, { label: 'TXT', color: '#2f9a8f' }) : ''
  return part(ctx, 'root', body(ctx) + behind + headG + arms + file)
}
