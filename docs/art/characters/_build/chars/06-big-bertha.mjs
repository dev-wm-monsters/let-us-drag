// 06 — Big Bertha the Lunch Lady: American school-cafeteria legend. Big updo in a hairnet, berry
// lipstick, mint uniform, white apron with a name tag. Signature: the ladle (with a dollop) + the tray.
import { INK, P, arm, circle, clip, ears, ell, eye, fileCard, fillP, hand, head, headD, inked, line, mirror, mouthOpen, part } from '../lib.mjs'

export const meta = {
  num: '06',
  slug: 'big-bertha',
  name: 'Big Bertha the Lunch Lady',
  origin: 'USA — the school cafeteria legend with a heart of gold',
  signature: 'Her ladle (always with a dollop of mash) and the compartment lunch tray; the hairnet over a magnificent updo.',
  catchphrase: 'Next! Don’t hold up the line, sugar.',
  eats: 'Scoops the file with her ladle — “Next!” — and slurps it straight off the ladle.',
  chews: 'Chews like she is taste-testing the daily special, humming; the hairnet bounces.',
  spits: 'Slops the result onto a lunch tray, one neat compartment per file: “Enjoy, sugar.”',
  bg: ['#e7f0fb', '#c9dcf5']
}

const SKIN = { base: '#a66a4a', shade: '#85502f', light: '#c58c68', deep: '#5c321e', blush: '#cf5e52' }
const HAIR = '#3a2824'
const HAIR_HI = '#6a4c44'
const UNIFORM = '#6cc3b5'
const UNIFORM_SH = '#4a9a8e'
const APRON = '#fdfcf7'
const APRON_SH = '#d7dbe2'
const LIP = '#b8344f'

const TORSO = 'M -84,94 C -146,104 -172,176 -146,204 C -106,224 106,224 146,204 C 172,176 146,104 84,94 Z'

function body(ctx) {
  const c = clip(ctx, 'torso', TORSO)
  const BIB = 'M -58,112 L 58,112 L 64,150 C 90,160 110,190 112,220 L -112,220 C -110,190 -90,160 -64,150 Z'
  const bc = clip(ctx, 'bib', BIB)
  return part(
    ctx,
    'body',
    inked(TORSO, UNIFORM, 9) +
      `<g ${c}>` +
      fillP('M 74,108 C 140,124 160,186 124,216 L 60,220 C 120,196 124,150 74,108 Z', UNIFORM_SH) +
      inked(BIB, APRON, 5) +
      `<g ${bc}>${fillP('M 40,112 L 58,112 L 64,150 C 90,160 110,190 112,220 L 70,220 C 80,180 60,150 40,112 Z', APRON_SH)}</g>` +
      // pocket + gravy splash
      inked('M -40,176 L 0,176 L -2,206 L -38,206 Z', APRON, 3) +
      fillP('M 30,170 C 34,162 44,166 42,172 C 50,170 52,180 44,182 C 46,190 36,192 34,186 C 26,190 22,180 30,170 Z', '#b07a3c', ' opacity="0.8"') +
      `</g>` +
      // apron straps
      line('M -58,112 L -70,96 M 58,112 L 70,96', INK, 7) +
      line('M -58,112 L -70,96 M 58,112 L 70,96', APRON, 4) +
      // collar
      inked('M -40,92 L -6,110 L -30,122 L -54,100 Z', '#fff', 4) +
      inked('M 40,92 L 6,110 L 30,122 L 54,100 Z', '#fff', 4) +
      // name tag
      inked('M -48,126 L -4,126 L -4,146 L -48,146 Z', '#ffe9a8', 4) +
      `<text x="-26" y="140.5" font-family="Inter, DejaVu Sans, Arial, sans-serif" font-weight="900" font-size="10" fill="${INK}" text-anchor="middle">BERTHA</text>` +
      inked('M 14,132 C 10,124 20,120 24,128 C 28,120 38,124 34,132 L 24,144 Z', '#ef5a6f', 3)
  )
}

function hair(ctx, behind) {
  const PUFF = 'M -116,-30 C -146,-80 -134,-152 -76,-176 C -36,-200 36,-200 76,-176 C 134,-152 146,-80 116,-30 C 108,-70 90,-98 60,-108 C 20,-118 -20,-118 -60,-108 C -90,-98 -108,-70 -116,-30 Z'
  if (behind) return ''
  const c = clip(ctx, 'hair', PUFF)
  const net = []
  for (let i = -14; i <= 14; i++) {
    net.push(`M ${i * 18 - 120},-210 L ${i * 18 + 60},-20`)
    net.push(`M ${i * 18 + 120},-210 L ${i * 18 - 60},-20`)
  }
  return part(
    ctx,
    'hair',
    inked(PUFF, HAIR, 8) +
      `<g ${c}>` +
      fillP('M 40,-190 C 110,-170 140,-110 120,-30 C 110,-80 100,-110 70,-130 Z', '#2a1c19') +
      line('M -96,-120 Q -70,-170 -10,-176 M -80,-140 Q -40,-180 30,-170 M 20,-150 Q 70,-150 100,-110 M -110,-80 Q -110,-110 -90,-130', HAIR_HI, 3.4) +
      part(ctx, 'hairnet', line(net.join(' '), '#efe9f3', 1.5, ' opacity="0.55"')) +
      `</g>` +
      // the hairnet's elastic edge across the forehead
      line('M -114,-44 C -104,-92 -56,-112 0,-114 C 56,-112 104,-92 114,-44', INK, 6) +
      line('M -114,-44 C -104,-92 -56,-112 0,-114 C 56,-112 104,-92 114,-44', '#f2eef6', 3)
  )
}

function face(ctx) {
  const eat = ctx.jaw > 0
  const look = ctx.look
  const e = { rx: 18, ry: 21, pr: 8.5, look, lid: eat ? 0 : 0.24, lidFill: '#8e6ab0', iris: '#4a2c1c', smile: eat ? 0 : 0.3 }
  const lashes = (cx, s) => line(`M ${cx + s * 16},-50 l ${s * 9},-8 M ${cx + s * 19},-42 l ${s * 11},-4 M ${cx + s * 8},-56 l ${s * 5},-9`, INK, 3)
  const eyes = eye(ctx, 'L', { cx: -40, cy: -34, ...e }) + eye(ctx, 'R', { cx: 40, cy: -34, ...e }) + lashes(-40, -1) + lashes(40, 1)
  const BROW = 'M 16,-70 C 26,-86 58,-90 78,-74 C 62,-80 42,-80 28,-68 C 24,-66 18,-66 16,-70 Z'
  const bY = eat ? -12 : -2
  const brows = part(
    ctx,
    'brows',
    part(ctx, 'browR', inked(BROW, HAIR, 5), ` transform="translate(0 ${bY}) rotate(${eat ? 4 : 6} 46 -76)"`) +
      part(ctx, 'browL', inked(mirror(BROW), HAIR, 5, { off: 'translate(-0.6 2.2)' }), ` transform="translate(0 ${bY}) rotate(${eat ? -4 : -6} -46 -76)"`)
  )
  // broad button nose
  const NOSE = 'M -8,-16 C -12,-2 -30,4 -29,16 C -28,28 -12,30 0,26 C 12,30 28,28 29,16 C 30,4 12,-2 8,-16 C 4,-20 -4,-20 -8,-16 Z'
  const nose = part(ctx, 'nose', inked(NOSE, '#ae6f4e', 7) + fillP('M 27,10 C 30,22 20,30 4,28 C 16,26 24,20 27,10 Z', '#7c4528') + ell(-11, 8, 7, 4.6, '#cd9472', -20) + line('M -14,22 Q -9,27 -4,24 M 4,24 Q 9,27 14,22', INK, 2.6))
  const cheeks = part(ctx, 'cheeks', ell(-74, eat ? 12 : 20, 22, 13, SKIN.blush, 0, ' opacity="0.55"') + ell(74, eat ? 12 : 20, 22, 13, SKIN.blush, 0, ' opacity="0.55"') + line(eat ? 'M -52,34 Q -66,60 -66,90 M 52,34 Q 66,60 66,90' : 'M -38,34 Q -56,46 -58,66 M 38,34 Q 56,46 58,66', SKIN.deep, 3))
  const mouth = eat
    ? mouthOpen(ctx, { top: 54, w: 70, bottom: 146, corner: 58 }, LIP) + part(ctx, 'lipsTop', line('M -70,58 Q 0,40 70,58', LIP, 6))
    : part(
        ctx,
        'mouth',
        part(ctx, 'lips', inked('M -38,58 Q -22,48 -9,53 Q 0,49 9,53 Q 22,48 38,58 Q 0,66 -38,58 Z', LIP, 4) + inked('M -38,58 Q 0,66 38,58 Q 24,80 0,80 Q -24,80 -38,58 Z', '#cc4560', 4) + ell(-8, 70, 9, 3.4, '#ee8a9c', -6)) +
          part(ctx, 'mouthLine', line('M -38,58 Q 0,66 38,58', INK, 3.4)) +
          line('M -46,52 Q -42,58 -44,64 M 46,52 Q 42,58 44,64', INK, 3)
      )
  const chin = part(ctx, 'chin', line(eat ? 'M -30,172 Q 0,182 30,172' : 'M -32,110 Q 0,122 32,110', SKIN.deep, 3))
  const studs = circle(-114, 22, 6, INK) + circle(-115, 21, 4.6, '#fffaf0') + circle(114, 22, 6, INK) + circle(113, 21, 4.6, '#fffaf0')
  return part(ctx, 'face', studs + cheeks + chin + mouth + nose + part(ctx, 'eyes', eyes) + brows)
}

function ladle(ctx, x, y, rot) {
  // upright: the bowl on top with its dollop, the handle running down into the fist at (0, 96)
  const g =
    inked('M 14,8 C 20,40 18,70 4,100 L -6,98 C 8,70 10,40 4,10 Z', '#aeb8c2', 5) +
    line('M 12,20 C 14,46 12,66 4,88', '#e3e9ee', 2.4) +
    inked('M -30,-4 Q -30,26 0,26 Q 30,26 30,-4 Z', '#c4cdd5', 6) +
    fillP('M 12,-4 L 30,-4 Q 30,18 10,24 Q 22,10 12,-4 Z', '#8d98a3') +
    // dollop of mash with a drip
    inked('M -28,-4 C -32,-22 -12,-30 -4,-22 C 4,-38 26,-30 24,-8 C 30,-4 28,0 22,0 L -22,0 C -30,0 -32,-2 -28,-4 Z', '#fbefcf', 5) +
    fillP('M 2,-22 C 8,-30 18,-26 16,-16 C 12,-20 6,-20 2,-22 Z', '#f2d68e') +
    inked('M -20,2 C -20,12 -16,18 -13,24 C -10,18 -11,10 -11,2 Z', '#fbefcf', 3)
  return part(ctx, 'ladle', `<g transform="translate(${x} ${y}) rotate(${rot})">${g}</g>`)
}

function tray(ctx, x, y, rot) {
  const g =
    inked('M -66,-30 L 66,-30 Q 74,-30 74,-22 L 74,26 Q 74,34 66,34 L -66,34 Q -74,34 -74,26 L -74,-22 Q -74,-30 -66,-30 Z', '#b9c9d6', 7) +
    fillP('M -64,-22 L -6,-22 L -6,26 L -64,26 Z', '#a3b5c4') +
    fillP('M 2,-22 L 64,-22 L 64,0 L 2,0 Z', '#a3b5c4') +
    fillP('M 2,8 L 64,8 L 64,26 L 2,26 Z', '#a3b5c4') +
    // peas, a square of pizza, jelly
    [[-50, -6], [-40, 4], [-30, -8], [-22, 8], [-46, 14], [-34, 16], [-18, -4]].map(([a, b]) => circle(a, b, 4.6, '#7fbf4a') + circle(a - 1.4, b - 1.4, 1.4, '#c6ec9a')).join('') +
    inked('M 10,-18 L 40,-18 L 40,-4 L 10,-4 Z', '#f4c45a', 3) +
    circle(18, -12, 3, '#d9473a') +
    circle(31, -10, 3, '#d9473a') +
    inked('M 44,12 L 58,12 L 56,24 L 46,24 Z', '#e8546a', 3)
  return part(ctx, 'tray', `<g transform="translate(${x} ${y}) rotate(${rot})">${g}</g>`)
}

export function draw(ctx) {
  const eat = ctx.jaw > 0
  const H = headD({ T: -128, W: 114, S: -34, JW: 104, JY: 62, C: 104, cw: 52, jaw: ctx.jaw, drop: 60 })
  const headG = part(ctx, 'head', ears(ctx, SKIN, 110, -12) + part(ctx, 'skull', head(ctx, H, SKIN, { litRx: 124, litRy: 160, shineY: -96, hatch: false })) + hair(ctx) + face(ctx), eat ? ' transform="rotate(-4 0 90)"' : '')
  const sL = { x: -96, y: 112 }
  const sR = { x: 96, y: 112 }
  const sleeve = (s) => inked(`M ${P(s.x - 24, s.y - 14)} Q ${P(s.x, s.y - 30)} ${P(s.x + 24, s.y - 14)} L ${P(s.x + 22, s.y + 24)} Q ${P(s.x, s.y + 32)} ${P(s.x - 22, s.y + 24)} Z`, UNIFORM, 6)
  let arms
  let behind = ''
  if (eat) {
    behind = arm(ctx, 'L', sL, { x: -144, y: 56 }, { color: SKIN.base, width: 22, bend: -0.5 }) + arm(ctx, 'R', sR, { x: 140, y: 66 }, { color: SKIN.base, width: 22, bend: 0.5 }) + part(ctx, 'sleeves', sleeve(sL) + sleeve(sR))
    arms = hand(ctx, 'L', { x: -144, y: 56, rot: -20, skin: SKIN, cuff: SKIN.base }) + ladle(ctx, 152, -36, 8) + hand(ctx, 'R', { x: 140, y: 66, rot: 0, skin: SKIN, kind: 'fist' })
  } else {
    arms =
      tray(ctx, -110, 180, -6) +
      arm(ctx, 'L', sL, { x: -116, y: 168 }, { color: SKIN.base, width: 22, bend: 0.3 }) +
      part(ctx, 'sleeveL', sleeve(sL)) +
      hand(ctx, 'L', { x: -116, y: 172, rot: 0, skin: SKIN, kind: 'fist' }) +
      arm(ctx, 'R', sR, { x: 140, y: 84 }, { color: SKIN.base, width: 22, bend: 0.5 }) +
      part(ctx, 'sleeveR', sleeve(sR)) +
      ladle(ctx, 150, -18, 6) +
      hand(ctx, 'R', { x: 140, y: 84, rot: 0, skin: SKIN, kind: 'fist' })
  }
  const file = eat ? fileCard(ctx, { label: 'CSV', color: '#2f8a52' }) : ''
  return part(ctx, 'root', body(ctx) + behind + headG + arms + file)
}
