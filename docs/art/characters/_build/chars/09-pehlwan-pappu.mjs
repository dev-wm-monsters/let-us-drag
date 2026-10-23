// 09 — Pehlwan Pappu: Indian village wrestler-uncle from the akhada. Buzz cut, curled moustache,
// striped vest over a big round belly, red langot-style shorts, akhada mitti (dust) on his shoulders.
// Signature: a tall glass of milk.
import { INK, arm, circle, clip, ears, ell, eye, fileCard, fillP, hand, head, headD, inked, line, mirror, mouthClosed, mouthOpen, part } from '../lib.mjs'

export const meta = {
  num: '09',
  slug: 'pehlwan-pappu',
  name: 'Pehlwan Pappu',
  origin: 'India — the village akhada’s wrestler-uncle, still dusty from the pit',
  signature: 'A tall glass of milk (with a foam moustache on top of his real one), and akhada mitti dusted on his shoulders.',
  catchphrase: 'Doodh piyo, file khao!',
  eats: 'Gulps his milk, flexes once, then wrestles the file straight into his mouth.',
  chews: 'Chews like push-ups — a grunt every 10 % — and dust puffs off his shoulders.',
  spits: 'Slaps his thigh, hands over the result and raises his glass: “Pehlwan approved!”',
  bg: ['#f6ecd8', '#e9cfa2']
}

const SKIN = { base: '#b8764c', shade: '#97593a', light: '#d3956a', deep: '#6b3a20', blush: '#d4634e' }
const HAIR = '#2f2a2e'
const STRIPE_A = '#f7f3ea'
const STRIPE_B = '#3d74c4'
const LANGOT = '#c8352f'
const MITTI = '#c9925a'

const TORSO = 'M -86,92 C -156,100 -186,180 -154,208 C -110,230 110,230 154,208 C 186,180 156,100 86,92 Z'

function dust(xs) {
  return xs.map(([x, y, r]) => circle(x, y, r, MITTI)).join('')
}

function body(ctx) {
  const c = clip(ctx, 'torso', TORSO)
  const stripes = [0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="-200" y="${100 + i * 20}" width="400" height="10" fill="${STRIPE_B}"/>`).join('')
  return part(
    ctx,
    'body',
    inked(TORSO, STRIPE_A, 9) +
      `<g ${c}>` +
      stripes +
      // bare shoulders through the armholes, dusted with mitti
      inked('M 160,98 C 124,92 96,100 88,116 C 96,140 124,152 166,148 Z', SKIN.base, 6) +
      inked('M -160,98 C -124,92 -96,100 -88,116 C -96,140 -124,152 -166,148 Z', SKIN.base, 6) +
      `<g opacity="0.85">${dust([[110, 108, 4], [124, 116, 3], [140, 106, 5], [132, 128, 3.4], [-112, 110, 4.4], [-130, 104, 3], [-138, 122, 4], [-120, 130, 3]])}</g>` +
      fillP('M 80,110 C 160,130 180,190 140,220 L 60,224 C 130,196 140,150 80,110 Z', '#000', ' opacity="0.13"') +
      ell(-60, 140, 56, 22, '#fff', -12, ' opacity="0.25"') +
      // langot-style shorts band
      inked('M -200,190 Q 0,178 200,190 L 200,250 L -200,250 Z', LANGOT, 6) +
      line('M -200,200 Q 0,188 200,200', '#8f211d', 3) +
      `</g>` +
      inked('M -18,186 L 18,186 L 12,226 L -12,226 Z', '#a52822', 4) +
      // scoop neck
      inked('M -46,90 C -36,128 36,128 46,90 Z', SKIN.base, 5)
  )
}

function glass(ctx, x, y, s = 1) {
  const g =
    inked('M -16,-40 L 16,-40 L 12,30 L -12,30 Z', '#e6f3f8', 5) +
    fillP('M -14,-24 L 14,-24 L 11,28 L -11,28 Z', '#fffdf6') +
    inked('M -18,-28 C -20,-40 -6,-44 0,-38 C 6,-46 22,-40 18,-28 Z', '#ffffff', 4) +
    line('M -10,-18 L -8,22', '#ffffff', 3) +
    line('M 8,-20 L 6,22', '#e2dccd', 2)
  return part(ctx, 'milk', `<g transform="translate(${x} ${y}) scale(${s})">${g}</g>`)
}

function face(ctx) {
  const eat = ctx.jaw > 0
  const look = ctx.look
  const e = { rx: 17, ry: 19, pr: 8, look, lid: eat ? 0 : 0.14, lidFill: SKIN.base, iris: '#4a2a16', smile: eat ? 0 : 0.36 }
  const eyes = eye(ctx, 'L', { cx: -40, cy: -40, ...e }) + eye(ctx, 'R', { cx: 40, cy: -40, ...e })
  const BROW = 'M 14,-70 C 20,-88 52,-94 76,-82 C 82,-78 84,-72 84,-66 C 70,-76 48,-76 32,-70 C 24,-68 18,-66 14,-70 Z'
  const bY = eat ? -12 : -2
  const brows = part(
    ctx,
    'brows',
    part(ctx, 'browR', inked(BROW, HAIR, 6), ` transform="translate(0 ${bY}) rotate(${eat ? 4 : 2} 50 -78)"`) +
      part(ctx, 'browL', inked(mirror(BROW), HAIR, 6, { off: 'translate(-0.6 2.2)' }), ` transform="translate(0 ${bY}) rotate(${eat ? -4 : -2} -50 -78)"`)
  )
  const NOSE = 'M -9,-24 C -14,-8 -32,-2 -31,12 C -30,26 -14,30 0,25 C 14,30 30,26 31,12 C 32,-2 14,-8 9,-24 C 4,-28 -4,-28 -9,-24 Z'
  const nose = part(ctx, 'nose', inked(NOSE, '#c27f55', 7) + fillP('M 29,6 C 32,20 22,30 4,27 C 18,25 26,18 29,6 Z', '#93573a') + ell(-12, 4, 8, 5, '#dda07a', -20) + line('M -14,21 Q -9,26 -4,23 M 4,23 Q 9,26 14,21', INK, 2.6))
  const MR = 'M 0,32 C 12,26 30,26 46,34 C 62,42 76,40 84,30 C 90,22 86,10 76,12 C 70,14 72,22 78,22 C 74,32 64,32 56,30 C 72,44 80,52 70,58 C 54,62 34,54 20,52 C 12,51 4,52 0,54'
  const MOUS = `${MR} C -4,52 -12,51 -20,52 C -34,54 -54,62 -70,58 C -80,52 -72,44 -56,30 C -64,32 -74,32 -78,22 C -72,22 -70,14 -76,12 C -86,10 -90,22 -84,30 C -76,40 -62,42 -46,34 C -30,26 -12,26 0,32 Z`
  const moustache = part(ctx, 'moustache', `<g transform="translate(0 ${eat ? -8 : 0})">${inked(MOUS, HAIR, 7)}${line('M 10,40 Q 32,36 54,44 M -10,40 Q -32,36 -54,44', '#5e5660', 2.8)}</g>`)
  const cheeks = part(ctx, 'cheeks', ell(-76, eat ? 8 : 14, 22, 14, SKIN.blush, 0, ' opacity="0.5"') + ell(76, eat ? 8 : 14, 22, 14, SKIN.blush, 0, ' opacity="0.5"') + line(eat ? 'M -52,40 Q -66,64 -66,92 M 52,40 Q 66,64 66,92' : 'M -44,42 Q -58,58 -58,78 M 44,42 Q 58,58 58,78', SKIN.deep, 3))
  const mouth = eat ? mouthOpen(ctx, { top: 62, w: 72, bottom: 150, corner: 64 }, SKIN.deep) : mouthClosed(ctx, { y: 74, w: 30, smile: 0.9 }, SKIN.deep)
  const chin = part(ctx, 'chin', line(eat ? 'M -40,178 Q 0,190 40,178' : 'M -44,118 Q 0,134 44,118', SKIN.deep, 3))
  return part(ctx, 'face', cheeks + chin + mouth + moustache + nose + part(ctx, 'eyes', eyes) + brows)
}

export function draw(ctx) {
  const eat = ctx.jaw > 0
  const H = headD({ T: -132, W: 118, S: -30, JW: 110, JY: 64, C: 110, cw: 56, jaw: ctx.jaw, drop: 60 })
  // buzz cut: a dark stubble cap clipped to the skull
  const buzz = part(ctx, 'hair', `<g ${clip(ctx, 'buzz', H)}>${fillP('M -130,-60 C -120,-150 120,-150 130,-60 C 100,-92 60,-104 0,-106 C -60,-104 -100,-92 -130,-60 Z', HAIR, ' opacity="0.82"')}${line('M -60,-118 l 4,-4 M -20,-124 l 4,-4 M 24,-122 l 4,-4 M 64,-114 l 4,-4', '#6a6268', 2.4)}</g>`)
  const headG = part(ctx, 'head', ears(ctx, SKIN, 114, -16) + part(ctx, 'skull', head(ctx, H, SKIN, { litRx: 128, litRy: 160, shineY: -96, hatch: false })) + buzz + face(ctx), eat ? ' transform="rotate(-4 0 90)"' : '')
  const sL = { x: -104, y: 112 }
  const sR = { x: 104, y: 112 }
  let arms
  let behind = ''
  const armDust = (x, y) => `<g opacity="0.8">${dust([[x, y, 3.4], [x + 8, y + 6, 2.6], [x - 6, y + 10, 3]])}</g>`
  if (eat) {
    behind = arm(ctx, 'L', sL, { x: -150, y: 50 }, { color: SKIN.base, width: 30, bend: -0.5 }) + arm(ctx, 'R', sR, { x: 150, y: 60 }, { color: SKIN.base, width: 30, bend: 0.5 })
    arms = hand(ctx, 'L', { x: -150, y: 46, rot: -20, skin: SKIN, cuff: SKIN.base, s: 1.6 }) + glass(ctx, 152, 18, 1) + hand(ctx, 'R', { x: 150, y: 60, rot: 0, skin: SKIN, kind: 'fist', s: 1.5 })
  } else {
    // flexing left arm, milk glass raised in the right
    arms =
      arm(ctx, 'L', sL, { x: -150, y: 14 }, { color: SKIN.base, width: 32, bend: 1.4 }) +
      armDust(-170, 90) +
      hand(ctx, 'L', { x: -146, y: 14, rot: 20, skin: SKIN, kind: 'fist', s: 1.5 }) +
      line('M -186,52 q -10,-4 -14,-14 M -186,70 q -12,0 -18,-6', INK, 3) +
      arm(ctx, 'R', sR, { x: 140, y: 80 }, { color: SKIN.base, width: 30, bend: 0.5 }) +
      glass(ctx, 142, 40, 1.05) +
      hand(ctx, 'R', { x: 140, y: 80, rot: 0, skin: SKIN, kind: 'fist', s: 1.5 })
  }
  const file = eat ? fileCard(ctx, { label: 'MKV', color: '#8a5bd6' }) : ''
  return part(ctx, 'root', body(ctx) + behind + headG + arms + file)
}
