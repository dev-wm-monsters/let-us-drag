// 03 — Halwai Bhaiya: chubby sweet-shop owner, white sleeveless vest, red-checked towel on the
// shoulder, curly hair, stubble, a sweat drop from the hot kadhai. Signature: a giant jalebi.
import { INK, P, arm, circle, clip, ears, ell, eye, fileCard, fillP, hand, head, headD, inked, line, mirror, mouthClosed, mouthOpen, part } from '../lib.mjs'

export const meta = {
  num: '03',
  slug: 'halwai-bhaiya',
  name: 'Halwai Bhaiya',
  origin: 'India — the sweet-shop owner at the corner, towel on the shoulder since 1987',
  signature: 'A giant, glistening jalebi held up like a trophy (and the red-checked towel on his shoulder).',
  catchphrase: 'Garam garam!',
  eats: 'Drops the file into his mouth like batter into hot oil — “Garam garam!”.',
  chews: 'Chews in spirals; the progress ring is drawn as a jalebi coiling itself, sizzling.',
  spits: 'Wipes his brow with the towel and serves the result on a leaf plate.',
  bg: ['#fff0cf', '#ffd98f']
}

const SKIN = { base: '#c57f52', shade: '#a2643f', light: '#df9f72', deep: '#77401f', blush: '#e06c58' }
const HAIR = '#2f2a2e'
const HAIR_HI = '#5e5660'
const VEST = '#fbfaf4'
const VEST_SH = '#d2d8e0'
const TOWEL = '#d8433b'

const TORSO = 'M -84,92 C -146,100 -176,176 -146,204 C -106,224 106,224 146,204 C 176,176 146,100 84,92 Z'

function spiral(turns = 2.6, r0 = 3, r1 = 30) {
  const pts = []
  const N = 90
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * turns * Math.PI * 2
    const r = r0 + (r1 - r0) * (i / N) + Math.sin(t * 3.5) * 2.6 * (i / N)
    pts.push(P(Math.cos(t) * r, Math.sin(t) * r * 0.92))
  }
  return `M ${pts[0]} L ${pts.slice(1).join(' L ')}`
}

export function jalebi(x, y, s = 1) {
  const d = spiral()
  return (
    `<g transform="translate(${x} ${y}) scale(${s})">` +
    `<path d="${d}" fill="none" stroke="${INK}" stroke-width="17" stroke-linecap="round" stroke-linejoin="round" transform="translate(1.4 2)"/>` +
    `<path d="${d}" fill="none" stroke="#e8801a" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="#ffb547" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" transform="translate(-1.6 -1.8)"/>` +
    circle(-14, -18, 2.4, '#fff7d6') +
    circle(20, -8, 2, '#fff7d6') +
    circle(-4, 24, 1.8, '#fff7d6') +
    `</g>`
  )
}

function body(ctx) {
  const c = clip(ctx, 'torso', TORSO)
  const TOWEL_D = 'M 46,94 C 76,84 106,90 120,104 C 118,140 112,180 108,214 L 72,214 C 76,170 82,130 84,112 C 72,104 58,100 46,100 Z'
  const tc = clip(ctx, 'towel', TOWEL_D)
  const checks = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="40" y="${86 + i * 18}" width="90" height="7" fill="#fff" opacity="0.85"/>`).join('') + [0, 1, 2, 3, 4].map((i) => `<rect x="${52 + i * 16}" y="80" width="6" height="140" fill="#fff" opacity="0.6"/>`).join('')
  return part(
    ctx,
    'body',
    inked(TORSO, VEST, 9) +
      `<g ${c}>` +
      fillP('M 70,110 C 140,130 160,190 120,214 L 50,220 C 110,196 120,150 70,110 Z', VEST_SH) +
      // bare shoulders through the armholes
      inked('M 150,100 C 120,96 92,104 84,118 C 92,140 120,150 156,146 Z', SKIN.base, 6) +
      inked('M -150,100 C -120,96 -92,104 -84,118 C -92,140 -120,150 -156,146 Z', SKIN.base, 6) +
      fillP('M 150,104 C 130,110 116,128 118,146 L 156,146 Z', SKIN.shade) +
      // ribbed knit
      line('M -110,150 L -112,214 M -90,140 L -92,214 M -70,150 L -70,214 M -50,160 L -50,214 M 40,160 L 40,214 M 60,150 L 60,214', VEST_SH, 2, ' opacity="0.8"') +
      // scoop neck (skin) with chest hair
      inked('M -50,90 C -40,146 40,146 50,90 Z', SKIN.base, 5) +
      fillP('M 50,90 C 44,124 30,138 10,142 C 34,124 42,110 40,92 Z', SKIN.shade) +
      line('M -12,118 q 4,-6 8,0 q 4,-6 8,0 M -6,128 q 4,-6 8,0', INK, 2.2) +
      // belly button hint through the vest
      line('M -6,196 Q 0,202 6,196', VEST_SH, 3) +
      `</g>` +
      part(ctx, 'towel', inked(TOWEL_D, TOWEL, 7) + `<g ${tc}>${checks}${fillP('M 100,96 C 122,110 118,170 110,214 L 96,214 C 104,170 108,120 100,96 Z', '#a52a26', ' opacity="0.7"')}</g>` + line('M 76,206 l -4,12 M 86,207 l -2,12 M 96,207 l 0,12 M 106,206 l 2,12', INK, 2.4))
  )
}

function hair(ctx) {
  // short tight curls: a bumpy crown
  const crown =
    'M -112,-48 C -126,-70 -112,-96 -96,-102 C -102,-124 -80,-140 -62,-132 C -58,-154 -30,-160 -16,-146 C -6,-166 26,-166 32,-146 C 46,-160 74,-152 72,-132 C 92,-140 112,-120 102,-102 C 120,-96 128,-70 112,-48 C 104,-70 92,-88 74,-96 C 40,-110 -40,-110 -74,-96 C -92,-88 -104,-70 -112,-48 Z'
  const curls = 'M -86,-112 q 8,-8 14,0 M -50,-136 q 8,-8 14,0 M -6,-144 q 8,-8 14,0 M 40,-138 q 8,-8 14,0 M 78,-114 q 8,-8 14,0 M -64,-116 q 8,-8 14,0 M -26,-124 q 8,-8 14,0 M 18,-124 q 8,-8 14,0 M 56,-116 q 8,-8 14,0'
  return part(ctx, 'hair', inked(crown, HAIR, 8) + line(curls, HAIR_HI, 3))
}

function face(ctx) {
  const eat = ctx.jaw > 0
  const look = ctx.look
  const e = { rx: 17, ry: 19, pr: 8, look, lid: eat ? 0 : 0.1, lidFill: SKIN.base, iris: '#5a3519', smile: eat ? 0 : 0.42 }
  const eyes = eye(ctx, 'L', { cx: -40, cy: -40, ...e }) + eye(ctx, 'R', { cx: 40, cy: -40, ...e })
  const BROW = 'M 16,-72 C 22,-90 52,-96 74,-84 C 80,-80 82,-74 82,-70 C 70,-78 48,-78 32,-72 C 26,-70 20,-68 16,-72 Z'
  const bY = eat ? -12 : -2
  const brows = part(
    ctx,
    'brows',
    part(ctx, 'browR', inked(BROW, HAIR, 6), ` transform="translate(0 ${bY}) rotate(${eat ? 4 : 6} 50 -80)"`) +
      part(ctx, 'browL', inked(mirror(BROW), HAIR, 6, { off: 'translate(-0.6 2.2)' }), ` transform="translate(0 ${bY}) rotate(${eat ? -4 : -6} -50 -80)"`)
  )
  const NOSE = 'M -9,-24 C -14,-8 -32,-2 -31,12 C -30,26 -14,30 0,25 C 14,30 30,26 31,12 C 32,-2 14,-8 9,-24 C 4,-28 -4,-28 -9,-24 Z'
  const nose = part(ctx, 'nose', inked(NOSE, '#cf8558', 7) + fillP('M 29,6 C 32,20 22,30 4,27 C 18,25 26,18 29,6 Z', '#a5603c') + ell(-12, 4, 8, 5, '#e8aa7c', -20) + line('M -14,21 Q -9,26 -4,23 M 4,23 Q 9,26 14,21', INK, 2.6))
  const cheeks = part(
    ctx,
    'cheeks',
    ell(-74, eat ? 10 : 16, 22, 14, SKIN.blush, 0, ' opacity="0.55"') +
      ell(74, eat ? 10 : 16, 22, 14, SKIN.blush, 0, ' opacity="0.55"') +
      line(eat ? 'M -50,26 Q -66,50 -68,80 M 50,26 Q 66,50 68,80' : 'M -36,28 Q -60,40 -64,62 M 36,28 Q 60,40 64,62', SKIN.deep, 3)
  )
  // stubble dots along the jaw
  const st = []
  for (let i = 0; i < 26; i++) {
    const a = Math.PI * (0.12 + (0.76 * i) / 25)
    const ry = eat ? 128 : 92
    st.push(circle(Math.cos(a) * 84 * (i % 2 ? 0.93 : 1), 28 + Math.sin(a) * ry * (i % 2 ? 0.9 : 1), 1.7, SKIN.deep))
  }
  const stubble = part(ctx, 'stubble', `<g opacity="0.55">${st.join('')}</g>`)
  const mouth = eat
    ? mouthOpen(ctx, { top: 46, w: 74, bottom: 140, corner: 50 }, SKIN.deep)
    : mouthClosed(ctx, { y: 52, w: 48, smile: 0.95, style: 'grin' }, SKIN.deep)
  const sweat = part(ctx, 'sweat', `<g transform="translate(${eat ? -86 : 80} ${eat ? -96 : -104})">` + inked('M 0,-10 C 5,-3 8,1 8,6 A 8,8 0 1 1 -8,6 C -8,1 -5,-3 0,-10 Z', '#8fd3f4', 5) + ell(-2.4, 5, 2.2, 3.4, '#fff') + `</g>`)
  const chin = part(ctx, 'chin', line(eat ? 'M -36,178 Q 0,190 36,178' : 'M -40,118 Q 0,134 40,118 M -26,132 Q 0,142 26,132', SKIN.deep, 3))
  return part(ctx, 'face', stubble + cheeks + chin + mouth + nose + part(ctx, 'eyes', eyes) + brows + sweat)
}

export function draw(ctx) {
  const eat = ctx.jaw > 0
  const H = headD({ T: -132, W: 120, S: -30, JW: 110, JY: 62, C: 108, cw: 56, jaw: ctx.jaw, drop: 62 })
  const headG = part(ctx, 'head', ears(ctx, SKIN, 116, -18) + part(ctx, 'skull', head(ctx, H, SKIN, { litRx: 128, litRy: 160, shineY: -98 })) + hair(ctx) + face(ctx), eat ? ' transform="rotate(-4 0 90)"' : '')
  const sL = { x: -96, y: 112 }
  const sR = { x: 96, y: 112 }
  let arms
  let behind = ''
  if (eat) {
    behind = arm(ctx, 'L', sL, { x: -140, y: 50 }, { color: SKIN.base, width: 24, bend: -0.5 }) + arm(ctx, 'R', sR, { x: 140, y: 60 }, { color: SKIN.base, width: 24, bend: 0.5 })
    arms = part(ctx, 'jalebi', jalebi(-150, 4, 1.1)) + hand(ctx, 'L', { x: -142, y: 46, rot: 0, skin: SKIN, kind: 'fist' }) + hand(ctx, 'R', { x: 140, y: 60, rot: 20, skin: SKIN, cuff: SKIN.base })
  } else {
    arms =
      arm(ctx, 'R', sR, { x: 70, y: 176 }, { color: SKIN.base, width: 24, bend: -0.8 }) +
      hand(ctx, 'R', { x: 66, y: 178, rot: -100, skin: SKIN, cuff: SKIN.base, flip: true }) +
      arm(ctx, 'L', sL, { x: -128, y: 62 }, { color: SKIN.base, width: 24, bend: 0.7 }) +
      part(ctx, 'jalebi', jalebi(-130, 20, 1.15)) +
      hand(ctx, 'L', { x: -126, y: 62, rot: 10, skin: SKIN, kind: 'fist' })
  }
  const file = eat ? fileCard(ctx, { label: 'GIF', color: '#8a5bd6' }) : ''
  return part(ctx, 'root', body(ctx) + behind + headG + arms + file)
}
