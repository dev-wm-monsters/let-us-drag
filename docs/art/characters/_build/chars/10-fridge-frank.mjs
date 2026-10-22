// 10 — Fridge Frank: a grumpy 1950s fridge. Freezer door = forehead with ice-cube eyes and chrome
// trim for eyebrows, chrome handle for a moustache, the main door = his mouth (it swings open to eat,
// icicle teeth, frosty breath). Fridge magnets = the format buttons. Rubber-hose arms, white gloves.
import { INK, P, arm, circle, clip, ell, fileCard, fillP, hand, inked, line, part } from '../lib.mjs'

export const meta = {
  num: '10',
  slug: 'fridge-frank',
  name: 'Fridge Frank',
  origin: 'Nowhere and everywhere — a grumpy retro fridge from a 1950s kitchen',
  signature: 'Fridge magnets are his format buttons (PNG, JPG, PDF, MP3, WEBP); ice-cube eyes; a chrome “FRANK” badge.',
  catchphrase: 'Close the door, you’re letting the cold out!',
  eats: 'Grumbles, swings his door wide open (icicle teeth, frosty breath) and the file slides onto a shelf.',
  chews: 'Hums like an old compressor — “mmmrrrrr” — while frost creeps up the progress ring.',
  spits: 'Pops the result out chilled with a little cloud of frost and slams the door: “Next time knock.”',
  bg: ['#fdf1e2', '#f8d9b4']
}

const MINT = '#a6dccb'
const MINT_SH = '#7cbfaa'
const MINT_LT = '#d3f1e6'
const CHROME = '#dfe6ec'
const CHROME_SH = '#9aa7b3'
const GLOVE = { base: '#ffffff', shade: '#dfe3ea', light: '#ffffff', deep: '#aab2bf' }

const BODY = 'M -118,-118 C -118,-176 -96,-192 0,-192 C 96,-192 118,-176 118,-118 L 118,178 Q 118,194 102,194 L -102,194 Q -118,194 -118,178 Z'
const FREEZER = 'M -104,-118 C -104,-164 -86,-178 0,-178 C 86,-178 104,-164 104,-118 L 104,-34 Q 0,-46 -104,-34 Z'
const DOOR = 'M -104,-22 Q 0,-34 104,-22 L 104,174 Q 104,182 96,182 L -96,182 Q -104,182 -104,174 Z'

const rr = (x, y, w, h, r) => `M ${P(x + r, y)} L ${P(x + w - r, y)} Q ${P(x + w, y)} ${P(x + w, y + r)} L ${P(x + w, y + h - r)} Q ${P(x + w, y + h)} ${P(x + w - r, y + h)} L ${P(x + r, y + h)} Q ${P(x, y + h)} ${P(x, y + h - r)} L ${P(x, y + r)} Q ${P(x, y)} ${P(x + r, y)} Z`

function iceEye(ctx, side, cx, cy, look, lid, rot) {
  const d = rr(cx - 25, cy - 23, 50, 46, 10)
  const c = clip(ctx, `eye${side}`, d)
  const px = cx + look.x * 12
  const py = cy + look.y * 10
  const lidD = `M ${P(cx - 30, cy - 30)} L ${P(cx + 30, cy - 30)} L ${P(cx + 30, cy - 23 + lid * 46)} L ${P(cx - 30, cy - 23 + lid * 46 + (side === 'L' ? 6 : -6) * lid)} Z`
  return part(
    ctx,
    `eye${side}`,
    `<g transform="rotate(${rot} ${cx} ${cy})">` +
      inked(d, '#e3f6ff', 6) +
      `<g ${c}>` +
      fillP(`M ${P(cx - 25, cy - 23)} L ${P(cx + 12, cy - 23)} L ${P(cx - 25, cy + 10)} Z`, '#ffffff', ' opacity="0.9"') +
      fillP(`M ${P(cx + 25, cy + 23)} L ${P(cx + 25, cy - 4)} L ${P(cx + 2, cy + 23)} Z`, '#b9e2f5') +
      part(ctx, `pupil${side}`, circle(px, py, 10, INK) + circle(px - 3.5, py - 3.5, 3.4, '#fff')) +
      (lid > 0.02 ? part(ctx, `lid${side}`, fillP(lidD, MINT) + line(`M ${P(cx - 30, cy - 23 + lid * 46 + (side === 'L' ? 6 : -6) * lid)} L ${P(cx + 30, cy - 23 + lid * 46)}`, INK, 3.4)) : '') +
      `</g>` +
      `<path d="${d}" fill="none" stroke="${INK}" stroke-width="2.4"/>` +
      line(`M ${P(cx - 18, cy - 14)} L ${P(cx - 8, cy - 18)}`, '#fff', 3) +
      `</g>`
  )
}

function magnet(kind, x, y, label, color, rot = 0) {
  const shapes = {
    circle: 'M -17,0 A 17,17 0 1 0 17,0 A 17,17 0 1 0 -17,0 Z',
    rect: rr(-22, -14, 44, 28, 6),
    heart: 'M 0,16 C -26,0 -22,-20 -8,-18 C -2,-17 0,-12 0,-10 C 0,-12 2,-17 8,-18 C 22,-20 26,0 0,16 Z',
    star: 'M 0,-20 L 6,-7 L 20,-6 L 9,3 L 13,17 L 0,9 L -13,17 L -9,3 L -20,-6 L -6,-7 Z',
    flower: 'M 0,-18 C 8,-18 10,-8 6,-6 C 14,-10 20,-2 14,4 C 20,10 12,18 6,12 C 6,20 -6,20 -6,12 C -12,18 -20,10 -14,4 C -20,-2 -14,-10 -6,-6 C -10,-8 -8,-18 0,-18 Z'
  }
  return `<g transform="translate(${x} ${y}) rotate(${rot})">${inked(shapes[kind], color, 5)}<text x="0" y="${kind === 'heart' ? 3 : 4}" font-family="Inter, DejaVu Sans, Arial, sans-serif" font-weight="900" font-size="${label.length > 3 ? 8.5 : 10}" fill="#fff" text-anchor="middle">${label}</text></g>`
}

function magnets(ctx, eat) {
  const list = [
    ['circle', -62, 24, 'PNG', '#e0564a', -8],
    ['rect', 46, 6, 'JPG', '#e9a23b', 6],
    ['heart', -40, 104, 'PDF', '#3c6fd1', 4],
    ['star', 60, 86, 'MP3', '#2f9a63', -10],
    ['flower', 4, 150, 'WEBP', '#8a5bd6', 0]
  ]
  if (eat) {
    // the door is swung open: the magnets ride along on its outside edge
    return part(ctx, 'magnets', magnet('circle', 150, -10, 'PNG', '#e0564a', 18) + magnet('rect', 158, 52, 'JPG', '#e9a23b', 12) + magnet('heart', 166, 110, 'PDF', '#3c6fd1', 8))
  }
  return part(ctx, 'magnets', list.map((m) => magnet(...m)).join(''))
}

function interior(ctx) {
  // what you see when the "jaw" (main door) swings open: lit, frosty shelves; icicle teeth on top
  const CAV = 'M -104,-22 Q 0,-34 104,-22 L 104,174 Q 104,182 96,182 L -96,182 Q -104,182 -104,174 Z'
  const c = clip(ctx, 'mouth', CAV)
  const icicles = []
  for (let i = 0; i < 9; i++) {
    const x = -96 + i * 24
    const h = 16 + ((i * 7) % 3) * 8
    icicles.push(`M ${x},-30 L ${x + 20},-30 L ${x + 11},${-30 + h + 10} Z`)
  }
  return part(
    ctx,
    'mouth',
    part(ctx, 'mouthFill', inked(CAV, '#cdeefb', 6)) +
      `<g ${c}>` +
      part(ctx, 'throat', fillP('M -80,0 L 80,0 L 70,170 L -70,170 Z', '#a9dcf0') + ell(0, -6, 90, 30, '#fffbe0', 0, ' opacity="0.8"')) +
      // shelves + contents
      line('M -104,70 L 104,70 M -104,132 L 104,132', '#ffffff', 5) +
      line('M -104,74 L 104,74 M -104,136 L 104,136', '#7fbfd8', 2) +
      inked('M -70,30 L -70,20 Q -70,12 -64,10 L -64,0 L -54,0 L -54,10 Q -48,12 -48,20 L -48,66 L -70,66 Z', '#ffffff', 4) +
      fillP('M -70,36 L -48,36 L -48,48 L -70,48 Z', '#3c6fd1') +
      inked('M 30,66 L 80,66 L 80,44 L 30,58 Z', '#f4cc4f', 4) +
      circle(52, 60, 3, '#d9ab2a') +
      circle(68, 56, 2.4, '#d9ab2a') +
      inked('M -30,128 L -24,104 L 24,104 L 30,128 Z', '#7fcf6a', 4) + line('M -18,110 L 18,110', '#c6f0b4', 3) +
      part(ctx, 'tongue', inked('M -86,182 C -86,150 -40,144 0,152 C 40,144 86,150 86,182 Z', '#f0707e', 5) + line('M 0,156 Q 2,166 0,176', '#c94557', 3)) +
      part(ctx, 'upperTeeth', inked(icicles.join(' '), '#f4fcff', 3)) +
      `</g>`
  )
}

function door(ctx) {
  // the swung-open door seen from the inside (right side), with door shelves of little bottles
  const D = 'M 104,-22 L 176,-44 L 176,206 L 104,182 Z'
  return part(
    ctx,
    'jaw',
    inked(D, MINT_LT, 7) +
      fillP('M 112,-14 L 168,-32 L 168,196 L 112,176 Z', '#eef9f5') +
      line('M 112,50 L 168,40 M 112,120 L 168,116', MINT_SH, 5) +
      [[124, 34], [140, 30], [156, 26]].map(([x, y]) => inked(`M ${x - 5},${y} L ${x - 5},${y - 14} L ${x - 2},${y - 20} L ${x + 2},${y - 20} L ${x + 5},${y - 14} L ${x + 5},${y} Z`, ['#7fbf4a', '#e0564a', '#f2c14a'][(x / 16) % 3 | 0], 3)).join('') +
      [[130, 106], [152, 102]].map(([x, y]) => inked(`M ${x - 7},${y} L ${x - 7},${y - 18} L ${x + 7},${y - 18} L ${x + 7},${y} Z`, '#fff', 3)).join('')
  )
}

export function draw(ctx) {
  const eat = ctx.jaw > 0
  const look = ctx.look
  const bc = clip(ctx, 'body', BODY)
  const shell =
    inked(BODY, MINT, 10) +
    `<g ${bc}>` +
    fillP('M 70,-190 C 112,-176 120,-150 120,-118 L 120,196 L 90,196 L 90,-120 C 90,-150 84,-172 70,-190 Z', MINT_SH) +
    ell(-70, -150, 30, 12, MINT_LT, -24) +
    `</g>`
  const freezer =
    inked(FREEZER, MINT, 5) +
    fillP('M -96,-120 C -96,-154 -84,-166 -40,-170 C -70,-160 -84,-146 -86,-120 Z', MINT_LT) +
    // chrome badge
    inked(rr(-34, -170, 68, 20, 9), CHROME, 4) +
    `<text x="0" y="-155.5" font-family="Inter, DejaVu Sans, Arial, sans-serif" font-style="italic" font-weight="900" font-size="13" fill="${CHROME_SH}" text-anchor="middle">FRANK</text>`
  const brows = part(
    ctx,
    'brows',
    part(ctx, 'browL', inked(rr(-76, -144, 60, 13, 6), CHROME, 5) + line('M -70,-140 L -26,-140', '#fff', 2.4), ` transform="rotate(${eat ? -8 : 14} -46 -138) translate(0 ${eat ? -12 : 2})"`) +
      part(ctx, 'browR', inked(rr(16, -144, 60, 13, 6), CHROME, 5) + line('M 22,-140 L 66,-140', '#fff', 2.4), ` transform="rotate(${eat ? 8 : -10} 46 -138) translate(0 ${eat ? -12 : 6})"`)
  )
  const eyes = part(ctx, 'eyes', iceEye(ctx, 'L', -46, -98, look, eat ? 0 : 0.34, eat ? -4 : -6) + iceEye(ctx, 'R', 46, -98, look, eat ? 0 : 0.42, eat ? 4 : 6))
  // chrome handle = the grumpy moustache, right above the door seam
  const handle = part(ctx, 'moustache', `<g transform="translate(0 ${eat ? -6 : 0})">` + inked('M -54,-52 C -40,-66 -14,-62 0,-56 C 14,-62 40,-66 54,-52 C 46,-48 30,-50 16,-46 L 0,-44 L -16,-46 C -30,-50 -46,-48 -54,-52 Z', CHROME, 5) + line('M -40,-58 Q -22,-62 -8,-56', '#fff', 2.6) + fillP('M 14,-50 C 30,-54 44,-54 52,-52 C 44,-48 30,-48 14,-46 Z', CHROME_SH) + `</g>`)
  let mouth
  if (eat) {
    mouth = interior(ctx) + door(ctx)
  } else {
    // closed: the door gasket seam is a grumpy frown
    mouth = part(ctx, 'mouth', part(ctx, 'jaw', inked(DOOR, MINT, 5) + fillP('M 70,-26 Q 104,-22 104,-22 L 104,174 Q 104,182 96,182 L 80,182 Z', MINT_SH, ' opacity="0.6"')) + part(ctx, 'mouthLine', line('M -104,-28 Q 0,-42 104,-28', INK, 6) + line('M -100,-33 Q -96,-24 -104,-18 M 100,-33 Q 96,-24 104,-18', INK, 3.4)))
  }
  const sideHandle = eat ? '' : part(ctx, 'handle', inked('M 86,10 L 96,10 L 96,60 L 86,60 Z', CHROME, 4))
  const feet = part(ctx, 'feet', inked('M -96,192 L -70,192 L -74,214 L -92,214 Z', CHROME_SH, 5) + inked('M 96,192 L 70,192 L 74,214 L 92,214 Z', CHROME_SH, 5))
  const frost = eat
    ? part(ctx, 'frost', `<g opacity="0.95">${inked('M -150,40 C -170,30 -164,6 -146,10 C -140,-6 -116,-2 -118,14 C -108,16 -110,34 -124,36 C -130,46 -146,48 -150,40 Z', '#f2fbff', 4)}${inked('M -150,110 C -168,104 -162,84 -146,88 C -140,76 -122,80 -124,92 C -114,96 -118,112 -130,112 Z', '#f2fbff', 4)}</g>` + line('M -170,70 l -10,0 M -164,56 l -8,-6 M -164,84 l -8,6', '#8fd3f4', 3))
    : part(ctx, 'grumble', line('M 120,-196 q 6,-6 12,0 q 6,6 12,0 q 6,-6 12,0', INK, 3))
  const sL = { x: -116, y: 30 }
  const sR = { x: 116, y: 30 }
  let arms
  if (eat) {
    arms = arm(ctx, 'L', sL, { x: -166, y: -46 }, { color: CHROME_SH, width: 10, ink: 7, bend: -0.6 }) + hand(ctx, 'L', { x: -166, y: -46, rot: -20, skin: GLOVE, cuff: '#fff' }) + arm(ctx, 'R', { x: 104, y: -30 }, { x: 178, y: -96 }, { color: CHROME_SH, width: 10, ink: 7, bend: 0.5 }) + hand(ctx, 'R', { x: 180, y: -98, rot: 30, skin: GLOVE, cuff: '#fff' })
  } else {
    // fists on hips, grumpy
    arms =
      arm(ctx, 'L', sL, { x: -150, y: 100 }, { color: CHROME_SH, width: 10, ink: 7, bend: 0.9 }) +
      arm(ctx, 'R', sR, { x: 150, y: 100 }, { color: CHROME_SH, width: 10, ink: 7, bend: -0.9 }) +
      hand(ctx, 'L', { x: -148, y: 106, rot: 70, skin: GLOVE, kind: 'fist' }) +
      hand(ctx, 'R', { x: 148, y: 106, rot: -70, skin: GLOVE, kind: 'fist', flip: true })
  }
  const file = eat ? fileCard(ctx, { x: -150, y: -158, label: 'HEIC', color: '#4f8fe0' }) : ''
  const headG = part(ctx, 'head', part(ctx, 'freezer', freezer) + part(ctx, 'face', handle + eyes + brows), eat ? ' transform="rotate(-3 0 -30)"' : '')
  return part(ctx, 'root', feet + part(ctx, 'body', shell) + mouth + sideHandle + magnets(ctx, eat) + headG + arms + frost + file)
}
