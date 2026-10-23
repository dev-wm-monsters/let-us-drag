// 00 — Motu Uncle: the CURRENT in-app Uncle (same face parts, colours and outfit as
// src/renderer/common/uncle/UncleSvg.tsx — wild grey side tufts, comb-over, round glasses, bushy
// moustache, the mole with its one hair, argyle vest + bow tie), made much fatter: jowly double chin,
// puffed cheeks, a huge round belly with a straining button, short chubby arms, sausage fingers.
import { INK, P, arm, circle, clip, ell, fileCard, fillP, head, headD, inked, line, mirror, mouthClosed, mouthOpen, part } from '../lib.mjs'

export const meta = {
  num: '00',
  slug: 'motu-uncle',
  name: 'Motu Uncle',
  origin: 'Our own Uncle, after one too many files — same face, same mole, twice the belly',
  signature: 'The mole with its one proud hair (unchanged), plus a vest button hanging on by a thread over the belly.',
  catchphrase: 'Just one more file…',
  eats: 'Same gulp as today, but the whole body wobbles and the double chin swallows twice.',
  chews: 'Cheeks puff out like balloons; the belly bounces on every chew and the straining button creaks.',
  spits: 'Spits the result, pats the belly with both sausage-fingered hands and lets out a tiny burp.',
  bg: ['#e9eefb', '#cdd8f4']
}

// The Uncle's palette (UncleSvg.tsx `C`)
const C = {
  skin: '#f6c39b', skinShade: '#e49e76', skinLight: '#fde0c6', skinDeep: '#d1825f', nose: '#f3a57f', noseShade: '#de8160',
  blush: '#ef7765', hair: '#a49ca8', hairLight: '#d4cdd6', hairDark: '#6f6774', frame: '#3b261f', lens: '#cdeaf3',
  vest: '#e8a93c', vestShade: '#c98a24', vestLight: '#f4c66a', shirt: '#dfeaf6', shirtShade: '#b9cde2', bow: '#d9443a',
  mole: '#8a4a32', moleShade: '#5e2d1d', moleLight: '#d39a76'
}
const SKIN = { base: C.skin, shade: C.skinShade, light: C.skinLight, deep: C.skinDeep, blush: C.blush }

// The Uncle's own shapes (UncleSvg.tsx), tufts pushed out a little for the wider head
const TUFT_R = 'M 84,-100 Q 112,-122 136,-112 Q 120,-104 124,-96 Q 148,-102 160,-86 Q 140,-84 132,-76 Q 158,-70 162,-50 Q 142,-58 132,-52 Q 150,-38 146,-20 Q 132,-34 118,-30 L 96,-28 Z'
const TUFT_STRANDS_R = 'M 100,-92 Q 124,-98 140,-94 M 104,-72 Q 130,-74 148,-64 M 104,-52 Q 124,-50 140,-36'
const BROW_R = 'M 14,-62 C 16,-78 40,-90 62,-83 C 72,-80 80,-73 82,-64 C 76,-69 70,-68 66,-70 C 62,-64 54,-66 48,-64 C 40,-67 34,-60 26,-62 C 22,-58 18,-59 14,-62 Z'
const BROW_STRANDS_R = 'M 24,-70 Q 44,-80 64,-76 M 34,-66 Q 52,-72 70,-70'
const NOSE = 'M -9,-22 C -14,-6 -34,0 -32,18 C -30,35 -12,38 0,32 C 12,38 30,35 32,18 C 34,0 14,-6 9,-22 C 4,-26 -4,-26 -9,-22 Z'
const NOSE_SHADE = 'M 30,10 C 34,26 22,38 4,33 C 18,32 28,24 30,10 Z'
const MOUSTACHE_R = 'M 0,30 C 10,24 30,22 46,28 C 60,33 72,36 82,26 C 86,20 94,20 95,28 C 96,40 86,50 72,50 Q 72,61 61,62 Q 57,56 53,56 Q 51,67 41,66 Q 38,58 33,58 Q 30,69 20,68 Q 17,60 12,60 Q 9,70 0,69'
const MOUSTACHE = `${MOUSTACHE_R} ${mirror('L 0,69 Q 9,70 12,60 Q 17,60 20,68 Q 30,69 33,58 Q 38,58 41,66 Q 51,67 53,56 Q 57,56 61,62 Q 72,61 72,50 C 86,50 96,40 95,28 C 94,20 86,20 82,26 C 72,36 60,33 46,28 C 30,22 10,24 0,30').replace(/^L 0,69 /, '')} Z`
const MOUSTACHE_STRANDS = 'M 8,38 Q 28,32 50,40 M 12,50 Q 34,44 62,48 M 60,36 Q 74,40 86,32 M -8,38 Q -28,32 -50,40 M -12,50 Q -34,44 -62,48 M -60,36 Q -74,40 -86,32'
const MOUSTACHE_DARK = 'M 4,58 Q 22,52 40,56 M -4,58 Q -22,52 -40,56'
const RIM = {
  L: 'M -40,-61 A 31,31 0 1 0 -39.99,-61 Z M -40,-55.5 A 25.5,25.5 0 1 1 -40.01,-55.5 Z',
  R: 'M 40,-61 A 31,31 0 1 0 40.01,-61 Z M 40,-55.5 A 25.5,25.5 0 1 1 39.99,-55.5 Z'
}
const MOLE = { x: -70, y: 12, r: 10 }

const TORSO = 'M -84,112 C -166,118 -198,196 -164,222 C -112,242 112,242 164,222 C 198,196 166,118 84,112 Z'

function body(ctx, eat) {
  const c = clip(ctx, 'torso', TORSO)
  const button = (y, strain) =>
    (strain ? fillP(`M -3,${y - 20} Q 9,${y - 12} -3,${y - 4} Q -13,${y - 12} -3,${y - 20} Z`, C.shirt) : '') + circle(1, y + 1.4, 5, INK) + circle(0, y, 4, INK)
  return part(
    ctx,
    'body',
    inked(TORSO, C.vest, 9) +
      `<g ${c}>` +
      fillP('M -60,160 L -42,186 L -60,212 L -78,186 Z M 0,182 L 18,208 L 0,234 L -18,208 Z M 60,160 L 78,186 L 60,212 L 42,186 Z M -120,170 L -104,192 L -120,214 L -136,192 Z M 120,170 L 136,192 L 120,214 L 104,192 Z', C.vestLight) +
      line('M -170,150 L 120,250 M 170,150 L -120,250 M -170,200 L -60,250 M 170,200 L 60,250', C.vestShade, 2.5, ' stroke-dasharray="6 5"') +
      fillP('M 80,126 C 160,140 186,200 150,226 C 110,240 60,240 20,240 C 110,220 140,170 80,126 Z', C.vestShade, ' opacity="0.75"') +
      ell(-70, 150, 60, 26, C.vestLight, -14, ' opacity="0.55"') +
      line('M -40,190 Q -20,184 -8,176 M 8,176 Q 22,184 40,190', C.vestShade, 3) +
      `</g>` +
      inked('M -32,108 L 0,156 L 32,108 Z', C.shirt, 6) +
      inked('M -32,108 L -4,122 L -22,134 Z', C.shirt, 5) +
      inked('M 32,108 L 4,122 L 22,134 Z', C.shirt, 5) +
      inked('M -3,126 C -16,112 -34,114 -34,126 C -34,139 -16,140 -3,126 Z', C.bow, 6) +
      inked('M 3,126 C 16,112 34,114 34,126 C 34,139 16,140 3,126 Z', C.bow, 6) +
      inked('M -7,120 Q 0,116 7,120 L 7,132 Q 0,136 -7,132 Z', '#b8322b', 5) +
      circle(-20, 124, 2.6, '#fff') + circle(18, 122, 2.4, '#fff') +
      button(172, false) +
      button(198, true) +
      // the straining button: hanging on by a thread
      part(ctx, 'strainButton', eat ? `<g transform="translate(26 206) rotate(30)">${circle(1, 1.4, 5.4, INK)}${circle(0, 0, 4.4, '#7a5a3a')}</g>` + line('M 2,204 Q 14,212 22,206', INK, 1.6) + line('M 36,196 l 8,-6 M 40,206 l 10,0', INK, 2.6) : line('M -8,206 L -14,212 M 8,206 L 14,212', INK, 2))
  )
}

function fatHand(ctx, side, x, y, rot, open) {
  // short sausage fingers: palm + four fat capsules + thumb
  const f = side === 'L' ? -1 : 1
  const fingers = open
    ? [[-12, -20, -16, -38], [-3, -24, -4, -44], [7, -23, 8, -42], [15, -18, 20, -33]]
    : [[-12, -14, -12, -20], [-3, -16, -3, -22], [6, -16, 6, -22], [14, -12, 14, -18]]
  const fd = fingers.map(([a, b, c2, d]) => `M ${P(a, b)} L ${P(c2, d)}`).join(' ')
  const g =
    `<path d="${fd}" stroke="${INK}" stroke-width="16" stroke-linecap="round" transform="translate(1 1.5)"/>` +
    inked('M -20,-14 C -22,-28 18,-30 22,-14 C 26,4 14,14 0,14 C -14,14 -24,4 -20,-14 Z', C.skin, 7) +
    `<path d="${fd}" stroke="${C.skin}" stroke-width="10.5" stroke-linecap="round"/>` +
    line(open ? 'M -15,-34 l 2,-1 M -4,-40 l 2,-1 M 8,-38 l 2,-1' : '', C.skinLight, 2.4) +
    line('M -20,-2 C -32,-6 -36,6 -26,10', INK, 15) +
    line('M -20,-2 C -32,-6 -36,6 -26,10', C.skin, 9.5) +
    fillP('M 22,-14 C 26,4 14,14 0,14 C 14,6 20,-4 22,-14 Z', C.skinShade) +
    ell(0, 18, 18, 7, INK) + ell(0, 17, 16, 5, '#fff')
  return part(ctx, `hand${side}`, `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${f * 1.15} 1.15)">${g}</g>`)
}

function face(ctx) {
  const eat = ctx.jaw > 0
  const look = ctx.look
  const eye = (s, cx) => {
    const d = `M ${cx - 20},-30 A 20,22 0 1 0 ${cx + 20},-30 A 20,22 0 1 0 ${cx - 20},-30 Z`
    const cl = clip(ctx, `eye${s}`, d)
    const px = cx + look.x * 9
    const py = -29 + look.y * 10
    const lid = eat ? 0 : 0.18
    const edge = -52 + lid * 46
    return part(
      ctx,
      `eye${s}`,
      fillP(d, '#fffdf6') +
        `<g ${cl}>${part(ctx, `pupil${s}`, circle(px, py, 9, INK) + circle(px - 3, py - 3.5, 3, '#fff') + circle(px + 3, py + 3, 1.3, '#fff'))}${lid ? part(ctx, `lid${s}`, fillP(`M ${cx - 26},-58 L ${cx + 26},-58 L ${cx + 26},${edge} Q ${cx},${edge + 7} ${cx - 26},${edge} Z`, C.skin) + line(`M ${cx - 21},${edge - 1} Q ${cx},${edge + 7} ${cx + 21},${edge - 1}`, INK, 3.2)) : ''}</g>` +
        `<path d="${d}" fill="none" stroke="${INK}" stroke-width="2.4"/>` +
        line(s === 'L' ? 'M -56,-2 Q -40,6 -24,-2' : 'M 24,-1 Q 40,8 57,-1', C.skinDeep, 2.6) +
        circle(cx, -30, 28, C.lens, ' opacity="0.22"') +
        `<path d="${RIM[s]}" fill="${INK}" fill-rule="evenodd" transform="translate(1.2 1.6)"/><path d="${RIM[s]}" fill="${C.frame}" fill-rule="evenodd"/>` +
        line(s === 'L' ? 'M -58,-42 Q -54,-50 -46,-52' : 'M 22,-42 Q 26,-50 34,-52', '#fff', 3.6, ' opacity="0.85"')
    )
  }
  const eyes = part(ctx, 'eyes', line('M -72,-34 L -112,-28 M 72,-34 L 112,-28', C.frame, 5) + eye('L', -40) + eye('R', 40) + line('M -12,-38 Q 0,-48 12,-38', C.frame, 5.5))
  const bY = eat ? -10 : 0
  const brows = part(
    ctx,
    'brows',
    part(ctx, 'browR', inked(BROW_R, C.hair, 7) + line(BROW_STRANDS_R, C.hairLight, 2.6), ` transform="translate(0 ${bY}) rotate(${eat ? 6 : 0} 78 -66)"`) +
      part(ctx, 'browL', inked(mirror(BROW_R), C.hair, 7, { off: 'translate(-0.6 2.2)' }) + line(mirror(BROW_STRANDS_R), C.hairLight, 2.6), ` transform="translate(0 ${bY}) rotate(${eat ? -6 : 0} -78 -66)"`)
  )
  const nose = part(ctx, 'nose', inked(NOSE, C.nose, 8) + fillP(NOSE_SHADE, C.noseShade) + ell(-12, 6, 8, 5.5, '#ffe4d2', -20) + circle(-4, -8, 2.4, '#ffe4d2') + line('M -15,26 Q -10,31 -5,28 M 5,28 Q 10,31 15,26', INK, 2.6))
  const moustache = part(ctx, 'moustache', `<g transform="translate(0 ${eat ? -8 : -2})">${inked(MOUSTACHE, C.hair, 8)}${line(MOUSTACHE_STRANDS, C.hairLight, 3)}${line(MOUSTACHE_DARK, C.hairDark, 2.6)}</g>`)
  const MOLE_HAIR = `M ${MOLE.x - 6},${MOLE.y - 4} C ${MOLE.x - 12},${MOLE.y - 11} ${MOLE.x - 18},${MOLE.y - 6} ${MOLE.x - 23},${MOLE.y - 12} C ${MOLE.x - 27},${MOLE.y - 17} ${MOLE.x - 24},${MOLE.y - 22} ${MOLE.x - 19},${MOLE.y - 20}`
  const mole = part(
    ctx,
    'mole',
    ell(MOLE.x + 1, MOLE.y + 1.5, MOLE.r + 0.9, MOLE.r * 0.92 + 0.9, INK) +
      ell(MOLE.x, MOLE.y, MOLE.r, MOLE.r * 0.92, C.mole) +
      fillP(`M ${MOLE.x - 8},${MOLE.y + 2.5} Q ${MOLE.x},${MOLE.y + 11.5} ${MOLE.x + 8},${MOLE.y + 2.5} Q ${MOLE.x},${MOLE.y + 5} ${MOLE.x - 8},${MOLE.y + 2.5} Z`, C.moleShade) +
      ell(MOLE.x - 2.8, MOLE.y - 3, 2.6, 1.9, C.moleLight, -30) +
      part(ctx, 'moleHair', line(MOLE_HAIR, INK, 3.4))
  )
  const cheeks = part(
    ctx,
    'cheeks',
    ell(-80, eat ? 22 : 30, 26, 16, C.blush, 0, ' opacity="0.5"') +
      ell(80, eat ? 22 : 30, 26, 16, C.blush, 0, ' opacity="0.5"') +
      line(eat ? 'M -78,40 Q -92,70 -90,104 M 78,40 Q 92,70 90,104' : 'M -40,32 Q -64,50 -66,78 M 40,32 Q 64,50 66,78', C.skinDeep, 3)
  )
  const mouth = eat
    ? mouthOpen(ctx, { top: 56, w: 76, bottom: 164, corner: 60, gold: 3 }, C.skinDeep)
    : mouthClosed(ctx, { y: 70, w: 34, smile: 0.85, style: 'grin' }, C.skinDeep)
  const chins = part(ctx, 'chin', line(eat ? 'M -54,176 Q 0,196 54,176 M -36,190 Q 0,204 36,190' : 'M -50,112 Q 0,134 50,112 M -40,128 Q 0,146 40,128', C.skinDeep, 3.2))
  return part(ctx, 'face', cheeks + chins + mouth + moustache + nose + mole + eyes + brows)
}

export function draw(ctx) {
  const eat = ctx.jaw > 0
  const H = headD({ T: -128, W: 126, S: -22, JW: 122, JY: 86, C: 140, cw: 70, crown: 0.52, jaw: ctx.jaw, drop: 48 })
  const hair = part(ctx, 'hair', `<g transform="translate(12 0)">${inked(TUFT_R, C.hair, 7)}${line(TUFT_STRANDS_R, C.hairLight, 3)}</g><g transform="translate(-12 0)">${inked(mirror(TUFT_R), C.hair, 7, { off: 'translate(-0.6 2.2)' })}${line(mirror(TUFT_STRANDS_R), C.hairLight, 3)}</g>`)
  const EAR = 'M 116,-30 C 144,-48 166,-16 152,10 C 145,25 130,32 118,24 Z'
  const ears = part(ctx, 'earR', inked(EAR, C.skin, 8) + fillP('M 124,-16 C 142,-24 150,-2 138,10 C 132,6 128,0 124,-16 Z', C.skinShade)) + part(ctx, 'earL', inked(mirror(EAR), C.skin, 8, { off: 'translate(-0.6 2.2)' }))
  const combover = part(ctx, 'combover', line('M 6,-131 C 2,-162 36,-178 40,-154 C 43,-139 22,-136 25,-149 M -10,-131 C -16,-150 -32,-154 -40,-144 M -22,-128 C -27,-142 -24,-155 -12,-162', INK, 3.4))
  const skull = part(ctx, 'skull', head(ctx, H, SKIN, { litRx: 136, litRy: 170, litCy: -20, shineY: -100, hatch: 'M 104,-40 l 12,-10 M 108,-24 l 13,-11 M 110,-8 l 13,-11 M 110,8 l 13,-11 M 108,24 l 12,-10' }) + `<g ${clip(ctx, 'wr', H)}>${line('M -34,-100 Q -2,-112 30,-101 M -24,-89 Q 0,-97 22,-89', C.skinDeep, 3, ' opacity="0.6"')}</g>`)
  const headG = part(ctx, 'head', hair + ears + skull + combover + face(ctx), eat ? ' transform="rotate(-4 0 100)"' : '')
  const sL = { x: -112, y: 140 }
  const sR = { x: 112, y: 140 }
  let arms
  let behind = ''
  if (eat) {
    behind = arm(ctx, 'L', sL, { x: -158, y: 96 }, { color: C.shirt, width: 30, bend: -0.4 }) + arm(ctx, 'R', sR, { x: 158, y: 96 }, { color: C.shirt, width: 30, bend: 0.4 })
    arms = fatHand(ctx, 'L', -160, 88, -24, true) + fatHand(ctx, 'R', 160, 88, 24, true)
  } else {
    arms = arm(ctx, 'L', sL, { x: -104, y: 196 }, { color: C.shirt, width: 30, bend: 0.4 }) + arm(ctx, 'R', sR, { x: 104, y: 196 }, { color: C.shirt, width: 30, bend: -0.4 }) + fatHand(ctx, 'L', -100, 204, 160, false) + fatHand(ctx, 'R', 100, 204, -160, false)
  }
  const file = eat ? fileCard(ctx, { x: -160, y: -160, label: 'PNG', color: '#4f8fe0' }) : ''
  return part(ctx, 'root', `<g transform="translate(0 -14) scale(0.94)">` + body(ctx, eat) + behind + headG + arms + `</g>` + file)
}
