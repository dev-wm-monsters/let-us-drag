// 04 — Auto-wala Uncle: Mumbai rickshaw driver. Khaki uniform shirt + peaked cap, a huge curled
// handlebar moustache, sideburns. Signature: the old mechanical fare meter = the progress bar.
import { INK, arm, circle, clip, ears, ell, eye, fileCard, fillP, hand, head, headD, inked, line, mirror, mouthClosed, mouthOpen, part } from '../lib.mjs'

export const meta = {
  num: '04',
  slug: 'auto-wala-uncle',
  name: 'Auto-wala Uncle',
  origin: 'India (Mumbai) — the rickshaw driver who knows every shortcut',
  signature: 'His black-and-yellow fare meter: the flag drops when he starts chewing and the fare ticks up as progress. Plus a magnificent curled moustache.',
  catchphrase: 'Chalo, meter se!',
  eats: 'Twirls his moustache, flips the meter flag down — “Chalo!” — and the file hops in like a passenger.',
  chews: 'The meter clicks along with every chew; at 100 % it rings “ting!”.',
  spits: 'Hands the result over with a receipt-style card and a two-finger salute.',
  bg: ['#fff6cc', '#ffe066']
}

const SKIN = { base: '#b9784f', shade: '#965c39', light: '#d49769', deep: '#6b3b20', blush: '#d4654f' }
const HAIR = '#2c2629'
const HAIR_HI = '#5c5458'
const GREY = '#a9a3ab'
const KHAKI = '#c4a46c'
const KHAKI_SH = '#9c7f4b'
const KHAKI_LT = '#dcc08a'

const TORSO = 'M -70,96 C -118,104 -140,164 -124,194 C -90,212 90,212 124,194 C 140,164 118,104 70,96 Z'

function body(ctx) {
  const c = clip(ctx, 'torso', TORSO)
  const pocket = (x) => inked(`M ${x - 24},132 L ${x + 24},132 L ${x + 22},172 Q ${x},178 ${x - 22},172 Z`, KHAKI, 4) + inked(`M ${x - 26},128 L ${x + 26},128 L ${x + 24},144 Q ${x},150 ${x - 24},144 Z`, KHAKI_LT, 4) + circle(x, 140, 3, INK)
  return part(
    ctx,
    'body',
    inked(TORSO, KHAKI, 9) +
      `<g ${c}>` +
      fillP('M 64,110 C 120,130 132,180 110,214 L 50,214 C 100,190 104,150 64,110 Z', KHAKI_SH) +
      line('M 0,110 L 0,214', KHAKI_SH, 3) +
      [130, 160, 190].map((y) => circle(4, y, 3.6, '#efe3c4') + `<circle cx="4" cy="${y}" r="3.6" fill="none" stroke="${INK}" stroke-width="1.6"/>`).join('') +
      pocket(-56) +
      pocket(62) +
      // pen in the pocket + brass badge
      `<rect x="68" y="112" width="5" height="20" rx="2" fill="#2f63c8" stroke="${INK}" stroke-width="1.6"/>` +
      `</g>` +
      // white vest V + wide collar
      inked('M -30,94 L 0,134 L 30,94 Z', '#f7f3ea', 5) +
      inked('M -36,90 L -4,116 L -30,136 L -58,100 Z', KHAKI_LT, 5) +
      inked('M 36,90 L 4,116 L 30,136 L 58,100 Z', KHAKI_LT, 5)
  )
}

function cap(ctx) {
  // soft tweed flat cap, worn at a jaunty angle (not a uniform cap)
  const TWEED = '#7f8c6c'
  const crown = 'M -118,-90 C -130,-136 -84,-178 -6,-178 C 74,-178 128,-146 120,-96 C 80,-112 -70,-112 -118,-90 Z'
  const cc = clip(ctx, 'cap', crown)
  const checks = [-100, -70, -40, -10, 20, 50, 80, 110].map((x) => line(`M ${x},-190 L ${x - 14},-90`, '#5f6b4f', 2.2)).join('') + [-160, -140, -120].map((y) => line(`M -130,${y} Q 0,${y - 14} 130,${y}`, '#9aa786', 2.2)).join('')
  return part(
    ctx,
    'cap',
    `<g transform="rotate(-5 0 -100)">` +
      inked(crown, TWEED, 8) +
      `<g ${cc}>${checks}${fillP('M 40,-176 C 100,-168 128,-136 120,-96 C 104,-100 92,-104 80,-106 C 92,-130 76,-160 40,-176 Z', '#5f6b4f', ' opacity="0.7"')}</g>` +
      // seam + top button
      line('M -6,-178 C -20,-150 -16,-120 -6,-106', '#56614a', 3) +
      inked('M -14,-180 Q -6,-188 2,-180 Q -6,-176 -14,-180 Z', '#56614a', 4) +
      // short brim
      inked('M -96,-96 C -60,-110 60,-110 98,-96 C 84,-80 48,-74 0,-74 C -48,-74 -84,-80 -96,-96 Z', '#5f6b4f', 6) +
      line('M -66,-92 C -30,-98 30,-98 66,-92', '#9aa786', 2.6) +
      `</g>`
  )
}

function face(ctx) {
  const eat = ctx.jaw > 0
  const look = ctx.look
  const e = { rx: 17, ry: 19, pr: 8, look, lid: eat ? 0 : 0.2, lidFill: SKIN.base, iris: '#4e2f19', smile: eat ? 0 : 0.26 }
  const eyes = eye(ctx, 'L', { cx: -38, cy: -34, ...e }) + eye(ctx, 'R', { cx: 38, cy: -34, ...e })
  const BROW = 'M 14,-62 C 20,-78 48,-84 74,-74 C 80,-71 84,-66 84,-60 C 70,-68 48,-68 32,-62 C 26,-60 18,-58 14,-62 Z'
  const bY = eat ? -12 : 0
  const brows = part(
    ctx,
    'brows',
    part(ctx, 'browR', inked(BROW, HAIR, 6), ` transform="translate(0 ${bY}) rotate(${eat ? 4 : -4} 50 -70)"`) +
      part(ctx, 'browL', inked(mirror(BROW), HAIR, 6, { off: 'translate(-0.6 2.2)' }), ` transform="translate(0 ${eat ? bY : -8}) rotate(${eat ? -4 : -2} -50 -70)"`)
  )
  // long, straight nose
  const NOSE = 'M -7,-32 C -10,-12 -24,4 -24,16 C -24,28 -10,32 0,28 C 10,32 24,28 24,16 C 24,4 10,-12 7,-32 C 3,-36 -3,-36 -7,-32 Z'
  const nose = part(ctx, 'nose', inked(NOSE, '#c27f55', 7) + fillP('M 22,8 C 26,22 16,30 4,29 C 14,26 20,18 22,8 Z', '#93573a') + fillP('M -4,-28 C -6,-12 -12,0 -14,10 C -8,4 -4,-10 -4,-28 Z', '#d99e74') + line('M -12,24 Q -8,28 -3,26 M 3,26 Q 8,28 12,24', INK, 2.4))
  // the grand handlebar moustache with curled tips
  const MR = 'M 0,32 C 12,26 30,26 46,34 C 62,42 76,40 84,30 C 90,22 86,10 76,12 C 70,14 72,22 78,22 C 74,32 64,32 56,30 C 72,44 80,52 70,58 C 54,62 34,54 20,52 C 12,51 4,52 0,54'
  const MOUS = `${MR} C -4,52 -12,51 -20,52 C -34,54 -54,62 -70,58 C -80,52 -72,44 -56,30 C -64,32 -74,32 -78,22 C -72,22 -70,14 -76,12 C -86,10 -90,22 -84,30 C -76,40 -62,42 -46,34 C -30,26 -12,26 0,32 Z`
  const moustache = part(ctx, 'moustache', `<g transform="translate(0 ${eat ? -8 : 0})">` + inked(MOUS, HAIR, 7) + line('M 10,40 Q 32,36 54,44 M -10,40 Q -32,36 -54,44', GREY, 2.8) + line('M 66,24 Q 72,18 78,20 M -66,24 Q -72,18 -78,20', HAIR_HI, 2.4) + `</g>`)
  const cheeks = part(
    ctx,
    'cheeks',
    ell(-70, eat ? 10 : 18, 17, 10, SKIN.blush, 0, ' opacity="0.45"') +
      ell(70, eat ? 10 : 18, 17, 10, SKIN.blush, 0, ' opacity="0.45"') +
      line(eat ? 'M -52,40 Q -64,64 -62,92 M 52,40 Q 64,64 62,92' : 'M -40,40 Q -50,60 -48,80 M 40,40 Q 50,60 48,80', SKIN.deep, 3)
  )
  const mouth = eat
    ? mouthOpen(ctx, { top: 62, w: 62, bottom: 150, corner: 64, gold: 4 }, SKIN.deep)
    : mouthClosed(ctx, { y: 72, w: 26, smile: 0.8 }, SKIN.deep)
  const chin = part(ctx, 'chin', fillP(eat ? 'M -12,176 Q 0,184 12,176 Q 0,180 -12,176 Z' : 'M -14,110 Q 0,120 14,110 Q 0,114 -14,110 Z', SKIN.deep) + line(eat ? 'M -16,174 Q 0,182 16,174' : 'M -16,108 Q 0,118 16,108', SKIN.deep, 3))
  // sideburns
  const sideburns = part(ctx, 'sideburns', inked('M -104,-74 L -86,-74 L -88,-20 Q -96,-14 -104,-24 Z', HAIR, 5) + inked('M 104,-74 L 86,-74 L 88,-20 Q 96,-14 104,-24 Z', HAIR, 5) + fillP('M -102,-70 L -94,-70 L -96,-50 L -102,-50 Z', GREY) + fillP('M 102,-70 L 94,-70 L 96,-50 L 102,-50 Z', GREY))
  return part(ctx, 'face', sideburns + cheeks + chin + mouth + moustache + nose + part(ctx, 'eyes', eyes) + brows)
}

function meter(ctx, x, y, hired) {
  const digits = hired ? '18.50' : '00.00'
  const flagRot = hired ? -90 : 0
  const g =
    // stalk
    inked('M -6,30 L 6,30 L 8,120 L -8,120 Z', '#3a3436', 5) +
    // flag lever (red/white "for hire" flag)
    `<g transform="rotate(${flagRot} 30 -30)">` +
    inked('M 26,-30 L 34,-30 L 34,-92 L 26,-92 Z', '#3a3436', 4) +
    inked('M 34,-92 L 70,-92 L 70,-66 L 34,-66 Z', '#e04a3a', 5) +
    fillP('M 34,-79 L 70,-79 L 70,-72 L 34,-72 Z', '#fff') +
    `</g>` +
    // meter box
    inked('M -42,-34 L 42,-34 Q 50,-34 50,-24 L 50,26 Q 50,36 40,36 L -40,36 Q -50,36 -50,26 L -50,-24 Q -50,-34 -42,-34 Z', '#232022', 7) +
    fillP('M -42,-28 L 40,-28 Q 44,-28 44,-22 L 44,-14 L -44,-14 L -44,-22 Q -44,-28 -42,-28 Z', '#f2c230') +
    `<text x="0" y="-17" font-family="Inter, DejaVu Sans, Arial, sans-serif" font-weight="900" font-size="10" fill="${INK}" text-anchor="middle" letter-spacing="1">FARE</text>` +
    inked('M -36,-6 L 36,-6 L 36,18 L -36,18 Z', '#fffbe8', 3) +
    `<text x="0" y="13" font-family="JetBrains Mono, DejaVu Sans Mono, monospace" font-weight="800" font-size="18" fill="${INK}" text-anchor="middle">${digits}</text>` +
    circle(-40, 28, 2.4, '#8a8285') +
    circle(40, 28, 2.4, '#8a8285') +
    line('M -44,-30 Q -30,-34 -16,-32', '#6a6266', 3) +
    (hired ? line('M 60,-6 l 12,-4 M 62,8 l 13,0 M 60,22 l 12,4', INK, 3) : '')
  return part(ctx, 'meter', `<g transform="translate(${x} ${y}) scale(0.88)">${g}</g>`)
}

export function draw(ctx) {
  const eat = ctx.jaw > 0
  const H = headD({ T: -142, W: 104, S: -40, JW: 90, JY: 70, C: 114, cw: 34, jaw: ctx.jaw, drop: 58 })
  const headG = part(ctx, 'head', ears(ctx, SKIN, 100, -16, 0.95) + part(ctx, 'skull', head(ctx, H, SKIN, { litRx: 112, litRy: 160, hatch: false })) + face(ctx) + cap(ctx), eat ? ' transform="rotate(-4 0 90)"' : '')
  const sL = { x: -80, y: 112 }
  const sR = { x: 80, y: 112 }
  let arms
  let behind = ''
  if (eat) {
    behind = arm(ctx, 'L', sL, { x: -136, y: 54 }, { color: KHAKI, width: 18, bend: -0.6 }) + arm(ctx, 'R', sR, { x: 128, y: 44 }, { color: KHAKI, width: 18, bend: 0.6 })
    arms = hand(ctx, 'L', { x: -136, y: 54, rot: -20, skin: SKIN, cuff: KHAKI_LT }) + meter(ctx, 132, 140, true) + hand(ctx, 'R', { x: 128, y: 44, rot: 20, skin: SKIN, cuff: KHAKI_LT })
  } else {
    arms =
      meter(ctx, 132, 140, false) +
      arm(ctx, 'R', sR, { x: 152, y: 112 }, { color: KHAKI, width: 18, bend: 0.3 }) +
      hand(ctx, 'R', { x: 160, y: 112, rot: 0, skin: SKIN, kind: 'fist' }) +
      arm(ctx, 'L', sL, { x: -120, y: 86 }, { color: KHAKI, width: 18, bend: 0.6 }) +
      hand(ctx, 'L', { x: -122, y: 80, rot: -36, skin: SKIN, cuff: KHAKI_LT })
  }
  const file = eat ? fileCard(ctx, { label: 'MP4', color: '#2f9a63' }) : ''
  return part(ctx, 'root', body(ctx) + behind + headG + arms + file)
}
