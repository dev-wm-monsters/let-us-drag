// 07 — Sumo-san: a gentle giant of a Japanese sumo wrestler. Oiled black hair in a neat topknot,
// calm happy eyes, big round belly, navy mawashi with hanging sagari cords. Signature: the stomp
// (shiko) — the topknot boings and dust puffs fly when he chews.
import { INK, arm, clip, ears, ell, eye, fileCard, fillP, hand, happyEye, head, headD, inked, line, mirror, mouthClosed, mouthOpen, part } from '../lib.mjs'

export const meta = {
  num: '07',
  slug: 'sumo-san',
  name: 'Sumo-san',
  origin: 'Japan — a gentle, very polite giant of the dohyō',
  signature: 'His neat oiled topknot that boings on every stomp, and the navy mawashi with its hanging cords.',
  catchphrase: 'Itadakimasu!',
  eats: 'Bows a tiny bow, says “Itadakimasu!”, then claps both hands and swallows the file in one go.',
  chews: 'Chews with a slow shiko stomp — left, right — the window shakes a little and dust puffs fly.',
  spits: 'Presents the result with both hands and a nod: “Gochisōsama deshita.”',
  bg: ['#fdeee6', '#f7d2bf']
}

const SKIN = { base: '#f2c49c', shade: '#d89f76', light: '#fde0c4', deep: '#b07049', blush: '#ef7f6d' }
const HAIR = '#262228'
const HAIR_HI = '#5a5462'
const MAWASHI = '#2c4277'
const MAWASHI_SH = '#1d2d55'

const TORSO = 'M -84,88 C -160,96 -190,176 -160,206 C -116,230 116,230 160,206 C 190,176 160,96 84,88 Z'

function body(ctx, eat) {
  const c = clip(ctx, 'torso', TORSO)
  const cords = [-60, -36, -12, 12, 36, 60].map((x, i) => inked(`M ${x - 4},196 L ${x + 4},196 L ${x + 5 + (i % 2)},240 L ${x - 5},240 Z`, MAWASHI, 3)).join('')
  const dust = eat
    ? part(ctx, 'stompDust', ['M -190,204 C -200,190 -184,176 -172,186 C -168,172 -146,174 -148,190 C -138,192 -140,208 -152,208 Z', 'M 190,204 C 200,190 184,176 172,186 C 168,172 146,174 148,190 C 138,192 140,208 152,208 Z'].map((d) => inked(d, '#f4e6cf', 5)).join('') + line('M -196,170 l -8,-10 M -176,160 l -2,-12 M 196,170 l 8,-10 M 176,160 l 2,-12', INK, 3))
    : ''
  return part(
    ctx,
    'body',
    inked(TORSO, SKIN.base, 9) +
      `<g ${c}>` +
      fillP('M 80,100 C 170,120 190,190 150,224 L 60,224 C 140,196 150,140 80,100 Z', SKIN.shade) +
      ell(-60, 120, 60, 26, SKIN.light, -10, ' opacity="0.6"') +
      // chest + belly contours
      line('M -70,132 Q -40,148 -8,134 M 8,134 Q 40,148 70,132', SKIN.deep, 3) +
      line('M -6,168 Q 0,176 6,168', SKIN.deep, 3.2) +
      line('M -120,150 Q -110,180 -118,200 M 120,150 Q 110,180 118,200', SKIN.deep, 2.6, ' opacity="0.6"') +
      // the mawashi
      inked('M -200,188 Q 0,176 200,188 L 200,250 L -200,250 Z', MAWASHI, 6) +
      fillP('M -200,200 Q 0,188 200,200 L 200,206 Q 0,194 -200,206 Z', MAWASHI_SH) +
      `</g>` +
      inked('M -16,186 L 16,186 L 22,226 L -22,226 Z', MAWASHI_SH, 5) +
      cords +
      dust
  )
}

function topknot(ctx, eat) {
  const knot = eat ? 'rotate(-14 0 -150) translate(0 -4)' : 'rotate(0 0 -150)'
  return part(
      ctx,
      'topknot',
      `<g transform="${knot}">` +
        inked('M -16,-146 C -20,-170 -10,-186 8,-186 C 26,-186 32,-166 22,-150 C 34,-160 44,-150 34,-140 C 20,-132 -8,-132 -16,-146 Z', HAIR, 6) +
        line('M -6,-172 Q 6,-180 18,-172', HAIR_HI, 3) +
        inked('M -16,-150 L 18,-150 L 16,-140 L -14,-140 Z', '#f6f2ea', 3) +
        `</g>` +
        (eat ? line('M -30,-188 q -6,-8 0,-14 M 34,-190 q 6,-8 0,-14', INK, 3) : '')
  )
}

function hair(ctx) {
  // slicked hair combed up and back into the topknot
  const CAP = 'M -112,-48 C -122,-106 -80,-144 0,-146 C 80,-144 122,-106 112,-48 C 104,-80 84,-100 56,-104 C 30,-108 -30,-108 -56,-104 C -84,-100 -104,-80 -112,-48 Z'
  return part(ctx, 'hair', inked(CAP, HAIR, 8) + line('M -80,-112 Q -50,-138 -10,-140 M 80,-112 Q 50,-138 10,-140 M -98,-80 Q -70,-118 -30,-128 M 98,-80 Q 70,-118 30,-128', HAIR_HI, 3) + fillP('M 40,-140 C 90,-130 118,-100 112,-48 C 104,-80 90,-96 70,-104 Z', '#17141a'))
}

function face(ctx) {
  const eat = ctx.jaw > 0
  const look = ctx.look
  const eyes = eat
    ? eye(ctx, 'L', { cx: -40, cy: -40, rx: 16, ry: 19, pr: 8, look, lid: 0, lidFill: SKIN.base, iris: '#3b2618' }) + eye(ctx, 'R', { cx: 40, cy: -40, rx: 16, ry: 19, pr: 8, look, lid: 0, lidFill: SKIN.base, iris: '#3b2618' })
    : happyEye(ctx, 'L', -40, -36, 17) + happyEye(ctx, 'R', 40, -36, 17)
  const BROW = 'M 14,-72 C 20,-88 52,-94 76,-82 C 82,-78 84,-72 84,-68 C 70,-76 48,-76 32,-70 C 24,-68 18,-66 14,-72 Z'
  const bY = eat ? -12 : -4
  const brows = part(
    ctx,
    'brows',
    part(ctx, 'browR', inked(BROW, HAIR, 6), ` transform="translate(0 ${bY}) rotate(${eat ? 4 : 8} 50 -80)"`) +
      part(ctx, 'browL', inked(mirror(BROW), HAIR, 6, { off: 'translate(-0.6 2.2)' }), ` transform="translate(0 ${bY}) rotate(${eat ? -4 : -8} -50 -80)"`)
  )
  const NOSE = 'M -7,-18 C -11,-4 -26,2 -25,14 C -24,24 -10,26 0,22 C 10,26 24,24 25,14 C 26,2 11,-4 7,-18 C 3,-21 -3,-21 -7,-18 Z'
  const nose = part(ctx, 'nose', inked(NOSE, '#f3b28c', 6) + fillP('M 23,8 C 26,18 18,26 4,24 C 14,22 20,16 23,8 Z', '#d48c66') + ell(-10, 6, 6, 4, '#ffdcc4', -20) + line('M -12,19 Q -8,23 -3,21 M 3,21 Q 8,23 12,19', INK, 2.4))
  const cheeks = part(ctx, 'cheeks', ell(-74, eat ? 4 : 10, 24, 15, SKIN.blush, 0, ' opacity="0.6"') + ell(74, eat ? 4 : 10, 24, 15, SKIN.blush, 0, ' opacity="0.6"') + line(eat ? 'M -48,28 Q -64,56 -66,88 M 48,28 Q 64,56 66,88' : 'M -36,26 Q -54,36 -56,54 M 36,26 Q 54,36 56,54', SKIN.deep, 3))
  const mouth = eat ? mouthOpen(ctx, { top: 44, w: 72, bottom: 140, corner: 48 }, SKIN.deep) : mouthClosed(ctx, { y: 48, w: 26, smile: 0.9 }, SKIN.deep)
  const chin = part(ctx, 'chin', line(eat ? 'M -40,170 Q 0,182 40,170' : 'M -46,104 Q 0,120 46,104', SKIN.deep, 3))
  return part(ctx, 'face', cheeks + chin + mouth + nose + part(ctx, 'eyes', eyes) + brows)
}

export function draw(ctx) {
  const eat = ctx.jaw > 0
  const H = headD({ T: -136, W: 118, S: -30, JW: 114, JY: 56, C: 100, cw: 60, jaw: ctx.jaw, drop: 62 })
  const headG = part(ctx, 'head', topknot(ctx, eat) + ears(ctx, SKIN, 114, -14, 0.95) + part(ctx, 'skull', head(ctx, H, SKIN, { litRx: 128, litRy: 160, shineY: -100, hatch: false })) + hair(ctx) + face(ctx), eat ? ' transform="rotate(-3 0 90)"' : '')
  const sL = { x: -110, y: 110 }
  const sR = { x: 110, y: 110 }
  let arms
  let behind = ''
  if (eat) {
    behind = arm(ctx, 'L', sL, { x: -160, y: 50 }, { color: SKIN.base, width: 40, bend: -0.4 }) + arm(ctx, 'R', sR, { x: 160, y: 50 }, { color: SKIN.base, width: 40, bend: 0.4 })
    arms = hand(ctx, 'L', { x: -160, y: 46, rot: -24, skin: SKIN, cuff: SKIN.base, s: 1.9 }) + hand(ctx, 'R', { x: 160, y: 46, rot: 24, skin: SKIN, cuff: SKIN.base, s: 1.9 })
  } else {
    arms =
      arm(ctx, 'L', sL, { x: -96, y: 174 }, { color: SKIN.base, width: 40, bend: 0.5 }) +
      hand(ctx, 'L', { x: -92, y: 180, rot: -80, skin: SKIN, cuff: SKIN.base, s: 1.9, flip: false }) +
      arm(ctx, 'R', sR, { x: 96, y: 174 }, { color: SKIN.base, width: 40, bend: -0.5 }) +
      hand(ctx, 'R', { x: 92, y: 180, rot: 80, skin: SKIN, cuff: SKIN.base, s: 1.9, flip: true })
  }
  const file = eat ? fileCard(ctx, { label: 'WAV', color: '#c2486e' }) : ''
  return part(ctx, 'root', body(ctx, eat) + behind + headG + arms + file)
}
