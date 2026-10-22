// 05 — Great-Uncle Nickels: a scheming roadside-shop great-uncle (inspired by the *genre* of the
// lovable con-man grand-uncle; deliberately original: no fez, no eyepatch, no glasses, no black suit).
// Loud orange plaid jacket, crooked toupee, pencil moustache, gold tooth. Signature: the coin.
import { INK, arm, circle, clip, ears, ell, eye, fileCard, fillP, hand, head, headD, inked, line, mirror, mouthOpen, part } from '../lib.mjs'

export const meta = {
  num: '05',
  slug: 'great-uncle-nickels',
  name: 'Great-Uncle Nickels',
  origin: 'International — a roadside “Mystery Deals” shack great-uncle (an original take on the lovable con-man genre)',
  signature: 'One coin per file, flipped with a wink and a gold-tooth “ting”; a crooked toupee that lifts off when he gulps; the hand-painted MYSTERY DEALS sign.',
  catchphrase: 'One coin. No refunds. Ha!',
  eats: 'Flips a coin, bites it to check it is real, then gulps the file with the coin chaser.',
  chews: 'Chews suspiciously, eyes darting; the sign flips from MYSTERY DEALS to ALMOST DONE.',
  spits: 'Slaps the result on the counter: “Genuine article! Practically new!”',
  bg: ['#e4f4ec', '#bfe6d2']
}

const SKIN = { base: '#f0b893', shade: '#d4916d', light: '#fbd6bb', deep: '#a86246', blush: '#ec7a6a' }
const WIG = '#b0612d'
const WIG_LT = '#d98a4c'
const WIG_DK = '#7f4120'
const GREYH = '#cfcad3'
const JACKET = '#e88a33'
const JACKET_SH = '#b9651f'
const PLAID = '#2f8f86'
const SHIRT = '#fff4dc'
const TIE = '#8e3fae'

const TORSO = 'M -70,104 C -122,112 -140,170 -124,198 C -90,216 90,216 124,198 C 140,170 122,112 70,104 Z'

function body(ctx) {
  const c = clip(ctx, 'torso', TORSO)
  const plaid =
    [-110, -70, -30, 30, 70, 110].map((x) => `<rect x="${x - 4}" y="90" width="8" height="140" fill="${PLAID}" opacity="0.75"/>`).join('') +
    [120, 160, 200].map((y) => `<rect x="-150" y="${y - 4}" width="300" height="8" fill="${PLAID}" opacity="0.75"/>`).join('') +
    [-90, -50, 50, 90].map((x) => line(`M ${x},90 L ${x},230`, '#ffd27a', 2)).join('') +
    [140, 180].map((y) => line(`M -150,${y} L 150,${y}`, '#ffd27a', 2)).join('')
  return part(
    ctx,
    'body',
    inked(TORSO, JACKET, 9) +
      `<g ${c}>` +
      plaid +
      fillP('M 64,116 C 120,136 132,186 110,216 L 50,216 C 100,190 104,150 64,116 Z', JACKET_SH, ' opacity="0.6"') +
      `</g>` +
      // shirt + wide tie with polka dots
      inked('M -34,100 L 0,170 L 34,100 Z', SHIRT, 5) +
      inked('M -12,112 L 12,112 L 18,176 L 0,196 L -18,176 Z', TIE, 5) +
      [[-4, 130], [6, 148], [-6, 164], [6, 182]].map(([x, y]) => circle(x, y, 2.8, '#f6c74a')).join('') +
      inked('M -14,104 L 14,104 L 10,116 L -10,116 Z', TIE, 4) +
      // big lapels
      inked('M -40,100 L -6,176 L -30,170 L -60,128 L -46,118 Z', JACKET, 5) +
      inked('M 40,100 L 6,176 L 30,170 L 60,128 L 46,118 Z', JACKET, 5) +
      // carnation in the lapel
      `<g transform="translate(-44 132)">${inked('M -8,-2 C -12,-12 -2,-16 0,-10 C 4,-16 14,-12 9,-2 C 14,4 6,12 0,7 C -6,12 -14,4 -8,-2 Z', '#e8443d', 4)}${circle(0, -2, 2.6, '#a52822')}</g>`
  )
}

function toupee(ctx, eat) {
  const W = 'M -96,-92 C -110,-132 -70,-170 -10,-168 C 50,-174 104,-146 100,-100 C 86,-110 70,-114 54,-108 C 40,-122 6,-120 -10,-110 C -30,-120 -70,-116 -96,-92 Z'
  const lift = eat ? ' transform="translate(10 -30) rotate(10 0 -130)"' : ' transform="rotate(-7 0 -130)"'
  const fx = eat ? line('M -50,-120 l -6,10 M 0,-128 l 0,12 M 50,-120 l 6,10', INK, 3) : ''
  return (
    fx +
    part(
      ctx,
      'toupee',
      inked(W, WIG, 8) +
        fillP('M -86,-118 C -60,-160 20,-170 70,-140 C 30,-150 -30,-150 -86,-118 Z', WIG_LT) +
        line('M -70,-140 Q -30,-158 20,-152 M -60,-124 Q -20,-140 40,-136 M 30,-160 Q 70,-150 90,-124', WIG_DK, 2.8) +
        fillP('M -10,-110 C 6,-120 40,-122 54,-108 C 40,-112 14,-112 -10,-110 Z', WIG_DK),
      lift
    )
  )
}

function face(ctx) {
  const eat = ctx.jaw > 0
  const look = eat ? ctx.look : { x: 0.55, y: 0.1 }
  const e = { rx: 17, ry: 20, pr: 8, look, lidFill: SKIN.base, iris: '#3f6f45' }
  const eyes = eye(ctx, 'L', { cx: -36, cy: -36, ...e, lid: eat ? 0 : 0.28, smile: eat ? 0 : 0.2 }) + eye(ctx, 'R', { cx: 36, cy: -36, ...e, lid: eat ? 0 : 0.52, smile: eat ? 0 : 0.28 })
  const BROW = 'M 12,-62 C 20,-76 46,-80 70,-70 C 76,-68 80,-64 80,-60 C 66,-66 46,-66 30,-60 C 24,-58 16,-58 12,-62 Z'
  // the scheming eyebrow: left one shoots up, right one stays low and flat
  const brows = part(
    ctx,
    'brows',
    part(ctx, 'browR', inked(BROW, GREYH, 6), ` transform="translate(0 ${eat ? -12 : 2}) rotate(${eat ? 6 : -4} 46 -68)"`) +
      part(ctx, 'browL', inked(mirror(BROW), GREYH, 6, { off: 'translate(-0.6 2.2)' }), ` transform="translate(0 ${eat ? -14 : -16}) rotate(${eat ? -6 : 10} -46 -68)"`)
  )
  // big potato nose
  const NOSE = 'M -10,-26 C -18,-8 -40,-2 -38,18 C -36,36 -16,40 0,33 C 16,40 36,36 38,18 C 40,-2 18,-8 10,-26 C 4,-31 -4,-31 -10,-26 Z'
  const nose = part(ctx, 'nose', inked(NOSE, '#f19f86', 8) + fillP('M 36,10 C 40,28 24,40 4,35 C 20,34 32,24 36,10 Z', '#d27a63') + ell(-14, 6, 9, 6, '#ffd3c4', -20) + circle(-4, -10, 2.4, '#ffe2d6') + line('M -16,28 Q -11,33 -5,30 M 5,30 Q 11,33 16,28', INK, 2.6))
  // pencil moustache
  const PM = 'M -40,48 C -26,40 -8,40 0,44 C 8,40 26,40 40,48 C 30,46 14,46 0,50 C -14,46 -30,46 -40,48 Z'
  const moustache = part(ctx, 'moustache', `<g transform="translate(0 ${eat ? -8 : 0})">${inked(PM, GREYH, 4)}</g>`)
  const cheeks = part(ctx, 'cheeks', ell(-66, 12, 16, 10, SKIN.blush, 0, ' opacity="0.45"') + ell(66, 12, 16, 10, SKIN.blush, 0, ' opacity="0.45"') + line(eat ? 'M -48,30 Q -60,60 -58,96 M 48,30 Q 60,60 58,96' : 'M -40,30 Q -54,50 -50,74 M 40,30 Q 54,50 50,74', SKIN.deep, 3))
  // lopsided smirk: the right side pulls up, gold tooth shows on that side
  const mouth = eat
    ? mouthOpen(ctx, { top: 60, w: 70, bottom: 152, corner: 62, gold: 4 }, SKIN.deep)
    : part(
        ctx,
        'mouth',
        part(ctx, 'mouthLine', inked('M -40,66 Q 0,80 46,56 Q 44,70 30,76 Q 0,84 -40,66 Z', '#5a1119', 4)) +
          fillP('M 14,70 L 26,66 L 26,74 L 14,78 Z', '#f4c34d') +
          fillP('M -6,74 L 12,71 L 12,78 L -6,79 Z', '#fffaf0') +
          line('M 50,52 Q 54,58 50,64 M -44,62 Q -46,66 -44,70', INK, 3.2) +
          // gold-tooth glint
          `<g transform="translate(34 76)">${fillP('M 0,-9 L 2,-2 L 9,0 L 2,2 L 0,9 L -2,2 L -9,0 L -2,-2 Z', '#fff7c2')}</g>`
      )
  const chin = part(ctx, 'chin', line(eat ? 'M -8,186 Q 0,192 8,186 M 0,188 L 0,178' : 'M -8,122 Q 0,128 8,122 M 0,124 L 0,114', SKIN.deep, 3))
  const temples = part(ctx, 'sideHair', inked('M -98,-80 C -112,-60 -110,-30 -100,-14 C -94,-30 -92,-54 -90,-78 Z', GREYH, 5) + inked('M 98,-80 C 112,-60 110,-30 100,-14 C 94,-30 92,-54 90,-78 Z', GREYH, 5))
  return part(ctx, 'face', temples + cheeks + chin + mouth + moustache + nose + part(ctx, 'eyes', eyes) + brows)
}

function sign(ctx, x, y, rot, s = 1, stick = 150) {
  const g =
    inked(`M -5,10 L 5,10 L 6,${stick} L -6,${stick} Z`, '#8a5a32', 5) +
    inked('M -78,-46 L 78,-40 L 74,22 L -74,18 Z', '#f3e2b8', 7) +
    fillP('M 40,-42 L 78,-40 L 74,22 L 46,20 Z', '#d9c391') +
    `<text x="0" y="-16" font-family="Inter, DejaVu Sans, Arial, sans-serif" font-weight="900" font-size="20" fill="#c2392f" text-anchor="middle" transform="rotate(2)">MYSTERY</text>` +
    `<text x="-4" y="10" font-family="Inter, DejaVu Sans, Arial, sans-serif" font-weight="900" font-size="20" fill="#1f5f9a" text-anchor="middle" transform="rotate(2)">DEALS</text>` +
    `<text x="56" y="12" font-family="Inter, DejaVu Sans, Arial, sans-serif" font-weight="900" font-size="22" fill="#c2392f" text-anchor="middle" transform="rotate(12 56 6)">?</text>` +
    circle(-66, -36, 3, '#6b6b6b') +
    circle(64, -30, 3, '#6b6b6b')
  return part(ctx, 'sign', `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">${g}</g>`)
}

function coin(ctx, x, y, s = 1) {
  return part(
    ctx,
    'coin',
    `<g transform="translate(${x} ${y}) scale(${s})">` +
      inked('M -14,0 A 14,14 0 1 0 14,0 A 14,14 0 1 0 -14,0 Z', '#f2c24a', 5) +
      `<circle cx="0" cy="0" r="9.5" fill="none" stroke="#c8901f" stroke-width="2"/>` +
      `<text x="0" y="5.5" font-family="Inter, DejaVu Sans, Arial, sans-serif" font-weight="900" font-size="15" fill="#9a6a12" text-anchor="middle">1</text>` +
      line('M -8,-8 Q -4,-11 0,-11', '#fff6c8', 2.4) +
      line('M 16,-16 l 6,-6 M 20,-4 l 8,0 M -16,-16 l -6,-6', INK, 2.6) +
      `</g>`
  )
}

export function draw(ctx) {
  const eat = ctx.jaw > 0
  const H = headD({ T: -128, W: 98, S: -44, JW: 102, JY: 72, C: 128, cw: 62, crown: 0.55, jaw: ctx.jaw, drop: 58 })
  const headG = part(
    ctx,
    'head',
    ears(ctx, SKIN, 94, -14, 1.05) + part(ctx, 'skull', head(ctx, H, SKIN, { litRx: 108, litRy: 170, shineY: -96, hatch: 'M 86,20 l 12,-10 M 90,36 l 12,-10 M 90,52 l 12,-10 M 86,68 l 11,-9' })) + face(ctx) + toupee(ctx, eat),
    eat ? ' transform="rotate(-4 0 90)"' : ' transform="rotate(3 0 90)"'
  )
  const sL = { x: -80, y: 120 }
  const sR = { x: 80, y: 120 }
  let arms
  let behind = ''
  if (eat) {
    behind = arm(ctx, 'L', sL, { x: -136, y: 64 }, { color: JACKET, width: 18, bend: -0.6 }) + arm(ctx, 'R', sR, { x: 136, y: 56 }, { color: JACKET, width: 18, bend: 0.6 })
    arms = hand(ctx, 'L', { x: -136, y: 64, rot: -20, skin: SKIN, cuff: SHIRT }) + coin(ctx, 140, 8, 1.1) + hand(ctx, 'R', { x: 136, y: 56, rot: 14, skin: SKIN, kind: 'fist' })
  } else {
    behind = sign(ctx, 150, -132, 6, 0.74, 330)
    arms =
      arm(ctx, 'R', sR, { x: 128, y: 104 }, { color: JACKET, width: 18, bend: 0.4 }) +
      hand(ctx, 'R', { x: 132, y: 104, rot: 0, skin: SKIN, kind: 'fist' }) +
      arm(ctx, 'L', sL, { x: -126, y: 84 }, { color: JACKET, width: 18, bend: 0.6 }) +
      coin(ctx, -134, 28, 1) +
      hand(ctx, 'L', { x: -128, y: 80, rot: -30, skin: SKIN, cuff: SHIRT })
  }
  const file = eat ? fileCard(ctx, { label: 'ZIP', color: '#d18b1f' }) : ''
  return part(ctx, 'root', behind + body(ctx) + headG + arms + file)
}
