// 01 — Chacha Gappu: chubby Indian uncle, kurta + buttoned Nehru vest straining over a round belly,
// thick oiled side-parted hair with grey temples, paan-red grin. Signature: the paan bida.
import { INK, arm, clip, ears, eye, fileCard, fillP, hand, head, headD, inked, line, mirror, mouthClosed, mouthOpen, part, ell, circle } from '../lib.mjs'

export const meta = {
  num: '01',
  slug: 'chacha-gappu',
  name: 'Chacha Gappu',
  origin: 'India — everybody’s favourite neighbourhood chacha',
  signature: 'A folded paan in his fist and a paan-red grin; the vest buttons strain over his belly.',
  catchphrase: 'Arre wah!',
  eats: 'Pats his belly, says “Arre wah!” and slurps the file in like the last gulab jamun.',
  chews: 'Slow, happy chewing with eyes shut; the belly jiggles and a vest button pings off at 100 %.',
  spits: 'Tucks the result into his vest pocket and hands it over with a proud “Le beta”.',
  bg: ['#fbe6c9', '#f6d3a4']
}

const SKIN = { base: '#d69a6c', shade: '#b77a50', light: '#eebf94', deep: '#90553a', blush: '#e2735f' }
const HAIR = '#3f353b'
const HAIR_HI = '#6d6271'
const GREY = '#bdb6bf'
const KURTA = '#f6edd8'
const VEST = '#2f7f7a'
const VEST_SH = '#215e5a'
const VEST_LT = '#4a9e95'
const PAAN_RED = '#a8323e'

const TORSO = 'M -78,92 C -138,98 -170,172 -142,200 C -104,220 104,220 142,200 C 170,172 138,98 78,92 Z'

function body(ctx) {
  const c = clip(ctx, 'torso', TORSO)
  const jiggle = ctx.jaw ? line('M -150,128 Q -160,146 -154,166 M -162,140 Q -168,152 -164,162 M 150,128 Q 160,146 154,166 M 162,140 Q 168,152 164,162', INK, 3.4) : ''
  const buttons = [120, 145, 170, 195]
    .map((y, i) => {
      const gap = i > 0 && i < 3 ? fillP(`M -3,${y - 18} Q 6,${y - 11.5} -3,${y - 5} Q -10,${y - 11.5} -3,${y - 18} Z`, KURTA) : ''
      return gap + circle(1, y + 1.4, 5.4, INK) + circle(0, y, 4.4, '#e6c25a') + circle(-1.4, y - 1.4, 1.3, '#fff3c0')
    })
    .join('')
  return part(
    ctx,
    'body',
    inked(TORSO, VEST, 9) +
      `<g ${c}>` +
      ell(-30, 120, 120, 80, VEST_LT, 0, ' opacity="0.5"') +
      fillP('M 70,110 C 120,130 140,170 120,200 L 40,210 C 100,190 110,150 70,110 Z', VEST_SH) +
      line('M 0,100 L 0,210', VEST_SH, 3) +
      // belly strain creases around the buttons
      line('M -40,150 Q -20,146 -8,140 M 8,140 Q 22,146 40,150 M -46,172 Q -24,168 -8,164 M 8,164 Q 26,168 46,172', VEST_SH, 3) +
      // pocket with a pen
      fillP('M -92,128 L -52,124 L -50,134 L -90,138 Z', VEST_SH) +
      `<rect x="-80" y="112" width="5" height="18" rx="2" fill="#d94b3d" stroke="${INK}" stroke-width="1.6"/>` +
      `</g>` +
      buttons +
      // kurta collar peeking out of the vest's mandarin collar
      inked('M -36,92 Q 0,108 36,92 L 32,82 Q 0,96 -32,82 Z', KURTA, 6) +
      inked('M -44,96 Q 0,118 44,96 L 40,88 Q 0,108 -40,88 Z', VEST, 6) +
      jiggle
  )
}

function hair(ctx) {
  // thick oiled waves with a side parting; a big front wave falls to the left; grey temples
  const cap =
    'M -118,-30 C -128,-72 -118,-110 -94,-132 C -98,-150 -72,-168 -46,-160 C -32,-180 0,-184 16,-168 C 36,-182 76,-174 86,-152 C 110,-146 126,-118 118,-90 C 126,-70 124,-50 118,-30 C 112,-56 104,-76 90,-88 C 70,-100 40,-100 18,-108 C 6,-112 -4,-110 -10,-104 C -30,-112 -60,-108 -80,-96 C -100,-84 -112,-62 -118,-30 Z'
  const wave = 'M -10,-104 C -24,-146 -78,-150 -98,-112 C -90,-108 -86,-102 -84,-96 C -70,-122 -40,-128 -10,-104 Z'
  return part(
    ctx,
    'hair',
    inked(cap, HAIR, 8) +
      fillP('M 20,-110 C 50,-150 96,-140 112,-104 C 118,-80 118,-56 116,-40 C 110,-62 100,-80 88,-90 C 66,-102 40,-102 20,-110 Z', '#2e252b') +
      inked(wave, '#2e252b', 5) +
      line('M -92,-122 Q -64,-146 -30,-140 M -78,-108 Q -52,-130 -22,-122 M -60,-158 Q -30,-170 0,-164 M 24,-160 Q 56,-168 80,-150 M 36,-140 Q 70,-146 96,-124 M 92,-138 Q 112,-120 112,-96', HAIR_HI, 3.4) +
      line('M -106,-96 Q -112,-80 -112,-60', HAIR_HI, 3) +
      // grey temples
      fillP('M -118,-30 C -121,-54 -115,-72 -104,-82 C -103,-62 -106,-48 -111,-26 Z', GREY) +
      fillP('M 118,-30 C 121,-54 115,-72 104,-82 C 103,-62 106,-48 111,-26 Z', GREY) +
      line('M -10,-104 L -14,-94', INK, 3)
  )
}

function face(ctx) {
  const eat = ctx.jaw > 0
  const look = ctx.look
  const lid = eat ? 0 : 0.16
  const browY = eat ? -12 : 0
  const BROW = 'M 14,-66 C 18,-86 48,-94 72,-84 C 80,-80 84,-74 84,-66 C 72,-74 52,-76 36,-70 C 28,-67 20,-64 14,-66 Z'
  const eyes =
    eye(ctx, 'L', { cx: -40, cy: -34, rx: 18, ry: 21, pr: 8.5, look, lid, lidFill: SKIN.base, iris: '#6b4226', smile: eat ? 0 : 0.3 }) +
    eye(ctx, 'R', { cx: 40, cy: -34, rx: 18, ry: 21, pr: 8.5, look, lid, lidFill: SKIN.base, iris: '#6b4226', smile: eat ? 0 : 0.3 })
  const brows = part(
    ctx,
    'brows',
    part(ctx, 'browR', inked(BROW, HAIR, 6), ` transform="translate(0 ${browY}) rotate(${eat ? -6 : 3} 50 -76)"`) +
      part(ctx, 'browL', inked(mirror(BROW), HAIR, 6, { off: 'translate(-0.6 2.2)' }), ` transform="translate(0 ${browY}) rotate(${eat ? 6 : -3} -50 -76)"`)
  )
  const NOSE = 'M -10,-22 C -16,-4 -38,0 -36,18 C -34,34 -14,38 0,32 C 14,38 34,34 36,18 C 38,0 16,-4 10,-22 C 4,-27 -4,-27 -10,-22 Z'
  const nose = part(
    ctx,
    'nose',
    inked(NOSE, '#d98e64', 8) +
      fillP('M 34,10 C 38,26 24,38 4,34 C 20,33 30,24 34,10 Z', '#b56f4a') +
      ell(-14, 8, 9, 6, '#f0b98e', -20) +
      circle(-5, -8, 2.4, '#f6cfa8') +
      line('M -16,27 Q -11,32 -5,29 M 5,29 Q 11,32 16,27', INK, 2.6)
  )
  const MOUS =
    'M 0,33 C 14,26 38,26 54,35 C 64,41 68,50 62,57 C 54,52 47,58 39,54 C 31,60 21,55 13,58 C 8,56 3,56 0,57 C -3,56 -8,56 -13,58 C -21,55 -31,60 -39,54 C -47,58 -54,52 -62,57 C -68,50 -64,41 -54,35 C -38,26 -14,26 0,33 Z'
  const moustache = part(ctx, 'moustache', `<g transform="translate(0 ${eat ? -6 : 0})">` + inked(MOUS, HAIR, 7) + line('M 10,40 Q 30,36 50,42 M -10,40 Q -30,36 -50,42', HAIR_HI, 2.6) + `</g>`)
  const cheeks = part(
    ctx,
    'cheeks',
    ell(-72, eat ? 18 : 26, 20, 12, SKIN.blush, 0, ' opacity="0.55"') +
      ell(72, eat ? 18 : 26, 20, 12, SKIN.blush, 0, ' opacity="0.55"') +
      line(eat ? 'M -64,40 Q -76,62 -76,86 M 64,40 Q 76,62 76,86' : 'M -40,36 Q -58,50 -60,70 M 40,36 Q 58,50 60,70', SKIN.deep, 3)
  )
  const mouth = eat
    ? mouthOpen(ctx, { top: 62, w: 70, bottom: 146, corner: 66, gap: 4, tongue: '#d8424f' }, SKIN.deep)
    : mouthClosed(ctx, { y: 72, w: 42, smile: 0.85, style: 'grin', teethColor: '#f6dccb' }, PAAN_RED)
  // paan stain on the grin / tongue: a little red smudge at the lip corner
  const stain = eat ? '' : fillP('M 30,74 Q 36,80 33,86 Q 29,82 30,74 Z', PAAN_RED, ' opacity="0.75"')
  const chin = part(ctx, 'chin', line(eat ? 'M -28,174 Q 0,182 28,174' : 'M -34,118 Q 0,130 34,118', SKIN.deep, 3))
  return part(ctx, 'face', cheeks + chin + mouth + stain + moustache + nose + part(ctx, 'eyes', eyes) + brows)
}

function paan(x, y, rot) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(1.5)">` + inked('M -16,10 L 0,-18 L 16,10 Q 0,18 -16,10 Z', '#5fa34a', 6) + fillP('M 0,-18 L 16,10 Q 8,14 0,15 Z', '#3f7f35') + line('M 0,-14 L 0,12 M 0,-2 L -8,6 M 0,-2 L 8,6', '#a6d68a', 2) + line('M 0,-18 L 0,-28', '#6b3a1e', 3.4) + circle(0, -29, 3.4, '#6b3a1e') + `</g>`
}

export function draw(ctx) {
  const eat = ctx.jaw > 0
  const H = headD({ T: -140, W: 116, S: -30, JW: 106, JY: 66, C: 106, cw: 52, jaw: ctx.jaw, drop: 58 })
  const headG = part(ctx, 'head', ears(ctx, SKIN, 112, -12) + part(ctx, 'skull', head(ctx, H, SKIN, { litRx: 124, litRy: 160 })) + hair(ctx) + face(ctx), eat ? ' transform="rotate(-4 0 90)"' : '')
  const sL = { x: -84, y: 108 }
  const sR = { x: 84, y: 108 }
  let arms
  if (eat) {
    arms =
      arm(ctx, 'L', sL, { x: -136, y: 66 }, { color: KURTA, width: 18, bend: -0.6 }) +
      arm(ctx, 'R', sR, { x: 136, y: 66 }, { color: KURTA, width: 18, bend: 0.6 }) +
      hand(ctx, 'L', { x: -136, y: 66, rot: -20, skin: SKIN, cuff: KURTA }) +
      hand(ctx, 'R', { x: 136, y: 66, rot: 20, skin: SKIN, cuff: KURTA })
  } else {
    arms =
      arm(ctx, 'R', sR, { x: 74, y: 176 }, { color: KURTA, width: 18, bend: -0.9 }) +
      hand(ctx, 'R', { x: 70, y: 176, rot: -104, skin: SKIN, cuff: KURTA, flip: true }) +
      arm(ctx, 'L', sL, { x: -104, y: 138 }, { color: KURTA, width: 18, bend: 0.5 }) +
      part(ctx, 'paan', paan(-102, 104, -8)) +
      hand(ctx, 'L', { x: -104, y: 142, rot: 0, skin: SKIN, kind: 'fist' })
  }
  const file = eat ? fileCard(ctx, { label: 'JPG', color: '#e0664f' }) : ''
  return part(ctx, 'root', body(ctx) + headG + arms + file)
}
