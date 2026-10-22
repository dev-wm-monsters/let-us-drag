// 09 — Captain Chomp: a jolly pirate captain drawn as a stocky 3/4 figure so the peg leg shows.
// Tricorn, eyepatch, bushy ginger beard, gold hoop, navy coat with a red sash, striped trousers,
// one boot + one peg leg. Signature: Polly the parrot, who squawks the target format.
import { INK, arm, circle, clip, ell, eye, fileCard, fillP, hand, head, headD, inked, line, mirror, mouthOpen, part } from '../lib.mjs'

export const meta = {
  num: '09',
  slug: 'captain-chomp',
  name: 'Captain Chomp',
  origin: 'The Seven Seas — a jolly (and slightly lost) pirate captain',
  signature: 'Polly the parrot on his shoulder squawks the format name (“PNG! PNG!”); a peg leg that taps while he waits.',
  catchphrase: 'Arr, feed me, matey!',
  eats: 'Bellows “Arr!”, catches the file like a cannonball and swallows it whole while Polly squawks the format.',
  chews: 'Chews like he is tasting sea salt, peg leg tapping in rhythm; Polly counts “25! 50! 75!”.',
  spits: 'Spits the result into a little treasure chest that pops open with a sparkle: “Treasure!”',
  bg: ['#e2eef8', '#bfd8ee']
}

const SKIN = { base: '#e9b086', shade: '#c98a60', light: '#f8cba6', deep: '#9c5d3a', blush: '#e86f5e' }
const BEARD = '#d4692a'
const BEARD_DK = '#a3481a'
const BEARD_LT = '#f0924c'
const COAT = '#2b3f73'
const COAT_SH = '#1d2c55'
const GOLD = '#f2bd47'
const HAT = '#2a2226'

const TORSO = 'M -64,52 C -112,60 -128,112 -118,168 L 118,168 C 128,112 112,60 64,52 Z'

function lowerBody(ctx) {
  const PANTS = 'M -108,160 L 108,160 L 100,204 L 30,204 L 18,186 L 0,186 L -18,186 L -30,204 L -100,204 Z'
  const pc = clip(ctx, 'pants', PANTS)
  const stripes = [-96, -72, -48, -24, 0, 24, 48, 72, 96].map((x) => `<rect x="${x - 6}" y="150" width="12" height="60" fill="#d9473a"/>`).join('')
  return part(
    ctx,
    'legs',
    // peg leg (his left, viewer's right)
    inked('M 50,200 L 84,200 L 72,236 L 60,236 Z', '#b77a42', 6) +
      line('M 54,212 L 80,212 M 58,224 L 76,224', '#8a5528', 3) +
      fillP('M 70,200 L 84,200 L 72,236 L 66,236 Z', '#8a5528', ' opacity="0.6"') +
      // boot (his right, viewer's left)
      inked('M -96,198 L -40,198 L -38,214 C -20,214 -6,220 -10,236 L -98,236 Z', '#5a3a26', 6) +
      inked('M -100,192 L -36,192 L -36,206 L -100,206 Z', '#7a5236', 4) +
      inked(PANTS, '#f6efe0', 6) +
      `<g ${pc}>${stripes}</g>`
  )
}

function body(ctx) {
  const c = clip(ctx, 'torso', TORSO)
  return part(
    ctx,
    'body',
    inked(TORSO, COAT, 9) +
      `<g ${c}>` +
      fillP('M 60,64 C 110,80 124,130 118,168 L 70,168 C 100,140 96,100 60,64 Z', COAT_SH) +
      // shirt opening + sash
      inked('M -34,52 L 34,52 L 26,168 L -26,168 Z', '#fbf6ea', 5) +
      line('M -12,70 Q 0,76 12,70 M -10,90 Q 0,96 10,90', '#d9cdb8', 2.4) +
      inked('M -130,128 L 130,128 L 130,156 L -130,156 Z', '#c8352f', 5) +
      line('M -130,140 L 130,140', '#a3241f', 2.4) +
      inked('M -14,126 L 14,126 L 14,158 L -14,158 Z', GOLD, 4) +
      fillP('M -7,133 L 7,133 L 7,151 L -7,151 Z', '#c8352f') +
      `</g>` +
      // gold-trimmed lapels + buttons
      inked('M -34,52 L -48,120 L -58,120 L -60,58 Z', COAT, 4) +
      inked('M 34,52 L 48,120 L 58,120 L 60,58 Z', COAT, 4) +
      line('M -34,52 L -48,120 M 34,52 L 48,120', GOLD, 3.4) +
      [70, 92, 114].map((y) => circle(-52, y, 4.4, INK) + circle(-52.6, y - 0.6, 3.4, GOLD) + circle(52, y, 4.4, INK) + circle(51.4, y - 0.6, 3.4, GOLD)).join('')
  )
}

function hat(ctx) {
  const CROWN = 'M -84,-140 C -86,-196 86,-196 84,-140 Z'
  const BRIM = 'M -156,-112 C -130,-150 -80,-170 0,-170 C 80,-170 130,-150 156,-112 C 124,-126 84,-130 44,-122 L 0,-100 L -44,-122 C -84,-130 -124,-126 -156,-112 Z'
  const skull =
    line('M -14,-140 L 14,-122 M 14,-140 L -14,-122', '#fbf6ea', 4.4) +
    inked('M -11,-146 C -11,-160 11,-160 11,-146 C 11,-140 8,-138 6,-136 L -6,-136 C -8,-138 -11,-140 -11,-146 Z', '#fbf6ea', 3) +
    circle(-4.5, -147, 3, HAT) +
    circle(4.5, -147, 3, HAT) +
    line('M -3,-137 L -3,-140 M 0,-137 L 0,-140 M 3,-137 L 3,-140', HAT, 1.4)
  return part(ctx, 'hat', inked(CROWN, HAT, 8) + fillP('M 40,-186 C 74,-176 86,-160 84,-140 L 56,-140 C 60,-160 54,-174 40,-186 Z', '#17121a') + inked(BRIM, HAT, 8) + line('M -150,-114 C -124,-146 -80,-164 0,-164 C 80,-164 124,-146 150,-114', GOLD, 4) + line('M -150,-114 C -124,-126 -84,-128 -44,-120 L 0,-100 L 44,-120 C 84,-128 124,-126 150,-114', GOLD, 3) + skull)
}

function beard(ctx, eat) {
  const J = eat ? 56 : 0
  const d = `M -98,-50 C -108,0 -100,${40 + J} -70,${80 + J} C -50,${104 + J} -24,${116 + J} 0,${118 + J} C 24,${116 + J} 50,${104 + J} 70,${80 + J} C 100,${40 + J} 108,0 98,-50 C 90,-20 70,-6 40,-8 L -40,-8 C -70,-6 -90,-20 -98,-50 Z`
  const tufts = `M -90,${10 + J * 0.4} q -8,10 -2,20 M -76,${54 + J} q -6,10 2,18 M 76,${54 + J} q 6,10 -2,18 M 90,${10 + J * 0.4} q 8,10 2,20 M -30,${100 + J} q 0,10 8,14 M 30,${100 + J} q 0,10 -8,14`
  return part(ctx, 'beard', inked(d, BEARD, 8) + fillP(`M 60,-8 C 90,0 104,30 92,${60 + J} C 82,${84 + J} 60,${100 + J} 40,${110 + J} C 64,${80 + J} 74,30 60,-8 Z`, BEARD_DK) + line(tufts, BEARD_DK, 3) + line(`M -70,${20 + J * 0.5} Q -60,${50 + J} -40,${80 + J} M -50,${10 + J * 0.4} Q -44,${30 + J * 0.6} -30,${60 + J}`, BEARD_LT, 3))
}

function face(ctx) {
  const eat = ctx.jaw > 0
  const look = ctx.look
  const eyes = eye(ctx, 'R', { cx: 38, cy: -64, rx: 18, ry: 21, pr: 9, look, lid: eat ? 0 : 0.22, lidFill: SKIN.base, iris: '#3c6d9a', smile: eat ? 0 : 0.3 })
  // eyepatch over his right eye (viewer's left) with its strap
  const patch = part(ctx, 'eyepatch', line('M -100,-56 L -56,-72 M -24,-88 L 70,-124', INK, 4) + inked('M -60,-80 C -60,-92 -20,-94 -18,-78 C -16,-58 -24,-46 -40,-46 C -56,-46 -60,-62 -60,-80 Z', '#231d20', 5) + line('M -50,-80 Q -40,-86 -28,-82', '#4c4248', 2.6))
  const BROW = 'M 14,-96 C 22,-112 52,-118 76,-106 C 82,-102 84,-96 84,-92 C 70,-100 48,-100 32,-94 C 24,-92 18,-90 14,-96 Z'
  const bY = eat ? -12 : 0
  const brows = part(
    ctx,
    'brows',
    part(ctx, 'browR', inked(BROW, BEARD, 6), ` transform="translate(0 ${bY}) rotate(${eat ? 4 : -2} 50 -104)"`) +
      part(ctx, 'browL', inked(mirror(BROW), BEARD, 6, { off: 'translate(-0.6 2.2)' }), ` transform="translate(0 ${bY + 4}) rotate(${eat ? -4 : -6} -50 -104)"`)
  )
  const NOSE = 'M -9,-56 C -14,-40 -32,-34 -30,-20 C -28,-6 -12,-2 0,-8 C 12,-2 28,-6 30,-20 C 32,-34 14,-40 9,-56 C 4,-60 -4,-60 -9,-56 Z'
  const nose = part(ctx, 'nose', inked(NOSE, '#ee9b7a', 7) + fillP('M 28,-26 C 30,-12 20,-4 4,-6 C 18,-8 26,-16 28,-26 Z', '#c97556') + ell(-12, -28, 8, 5, '#ffd0bb', -20) + line('M -14,-10 Q -9,-5 -4,-8 M 4,-8 Q 9,-5 14,-10', INK, 2.6))
  const MOUS = 'M 0,-6 C 14,-14 40,-14 60,-4 C 72,2 78,12 72,18 C 60,12 48,16 38,10 C 26,16 12,10 0,12 C -12,10 -26,16 -38,10 C -48,16 -60,12 -72,18 C -78,12 -72,2 -60,-4 C -40,-14 -14,-14 0,-6 Z'
  const moustache = part(ctx, 'moustache', `<g transform="translate(0 ${eat ? -6 : 0})">${inked(MOUS, BEARD, 6)}${line('M 10,0 Q 30,-4 50,4 M -10,0 Q -30,-4 -50,4', BEARD_LT, 2.6)}</g>`)
  const cheeks = part(ctx, 'cheeks', ell(70, -30, 16, 10, SKIN.blush, 0, ' opacity="0.55"') + ell(-70, -30, 16, 10, SKIN.blush, 0, ' opacity="0.55"'))
  const mouth = eat
    ? mouthOpen(ctx, { top: 18, w: 66, bottom: 104, corner: 22, gold: 1 }, null)
    : part(ctx, 'mouth', inked('M -36,22 Q 0,30 36,22 Q 30,44 0,46 Q -30,44 -36,22 Z', '#5a1119', 4) + fillP('M -30,24 Q 0,31 30,24 L 28,30 Q 0,36 -28,30 Z', '#fffaf0') + fillP('M -6,26 L 6,26 L 6,32 L -6,33 Z', GOLD) + ell(0, 40, 12, 4, '#f0707e'))
  return part(ctx, 'face', cheeks + beard(ctx, eat) + mouth + moustache + nose + part(ctx, 'eyes', eyes + patch) + brows)
}

function ear(ctx) {
  // only his left ear shows (the right is hidden by beard + hat); gold hoop earring
  const E = 'M 96,-88 C 122,-104 142,-74 130,-50 C 124,-36 110,-30 98,-38 Z'
  return part(ctx, 'earR', inked(E, SKIN.base, 7) + fillP('M 104,-76 C 120,-82 126,-62 116,-52 C 110,-58 106,-66 104,-76 Z', SKIN.shade) + `<circle cx="118" cy="-26" r="11" fill="none" stroke="${INK}" stroke-width="7"/><circle cx="118" cy="-26" r="11" fill="none" stroke="${GOLD}" stroke-width="3.6"/>`) + part(ctx, 'earL', inked(mirror(E), SKIN.base, 7))
}

function parrot(ctx, x, y, eat) {
  const beak = eat
    ? inked('M 22,-58 C 38,-62 46,-50 40,-40 C 36,-46 30,-48 24,-46 Z', '#f2c14a', 4) + inked('M 24,-38 C 34,-38 40,-34 38,-26 C 32,-28 26,-30 22,-34 Z', '#d9a333', 4) + fillP('M 24,-46 L 36,-42 L 24,-36 Z', '#5a1119')
    : inked('M 22,-54 C 38,-58 44,-44 36,-34 C 34,-40 28,-42 22,-42 Z', '#f2c14a', 4)
  const g =
    // tail
    inked('M -10,-6 L -30,44 L -18,46 L 2,-2 Z', '#2f6fd1', 5) +
    fillP('M -12,8 L -26,40 L -20,41 L -6,6 Z', '#e2453a') +
    // body + head
    inked('M -16,0 C -28,-22 -22,-52 -2,-62 C 18,-70 34,-58 32,-40 C 30,-22 22,-8 10,0 Z', '#3fae4a', 6) +
    fillP('M -2,-62 C 18,-70 34,-58 32,-42 C 22,-46 6,-50 -6,-56 Z', '#e2453a') +
    fillP('M 20,-14 C 26,-24 30,-34 30,-42 L 24,-40 C 22,-30 18,-20 10,-8 Z', '#2b8a38') +
    // wing
    inked('M -18,-40 C -8,-44 8,-32 10,-12 C 2,-4 -14,-8 -20,-18 Z', '#2f6fd1', 4) +
    fillP('M -16,-34 C -8,-36 2,-28 4,-18 C -4,-18 -12,-22 -16,-34 Z', '#f2c14a') +
    // eye
    circle(14, -50, 7, INK) +
    circle(13.4, -50.6, 5.6, '#fff') +
    circle(eat ? 15.6 : 12.4, -50.4, 2.8, INK) +
    beak +
    // feet on the shoulder
    line('M -6,0 l -4,6 M 0,0 l 0,7 M 6,-1 l 4,6', '#8a8186', 3.4)
  const bubble = eat
    ? `<g transform="translate(${x + 54} ${y - 92})">${inked('M -30,-18 L 30,-18 Q 38,-18 38,-10 L 38,10 Q 38,18 30,18 L -2,18 L -16,30 L -14,18 L -30,18 Q -38,18 -38,10 L -38,-10 Q -38,-18 -30,-18 Z', '#ffffff', 5)}<text x="0" y="7" font-family="Inter, DejaVu Sans, Arial, sans-serif" font-weight="900" font-size="19" fill="#d9473a" text-anchor="middle">PNG!</text></g>`
    : ''
  return part(ctx, 'parrot', `<g transform="translate(${x} ${y})">${g}</g>${bubble}`)
}

export function draw(ctx) {
  const eat = ctx.jaw > 0
  const H = headD({ T: -150, W: 100, S: -66, JW: 90, JY: 16, C: 58, cw: 40, jaw: ctx.jaw, drop: 56 })
  const headG = part(ctx, 'head', ear(ctx) + part(ctx, 'skull', head(ctx, H, SKIN, { litRx: 108, litRy: 150, litCy: -60, shineY: -120, hatch: false })) + face(ctx) + hat(ctx), eat ? ' transform="rotate(-4 0 40)"' : '')
  const sL = { x: -84, y: 74 }
  const sR = { x: 84, y: 74 }
  let arms
  let behind = ''
  if (eat) {
    behind = arm(ctx, 'L', sL, { x: -142, y: 20 }, { color: COAT, width: 20, bend: -0.6 }) + arm(ctx, 'R', sR, { x: 146, y: 70 }, { color: COAT, width: 20, bend: 0.4 })
    arms = hand(ctx, 'L', { x: -142, y: 20, rot: -24, skin: SKIN, cuff: GOLD }) + hand(ctx, 'R', { x: 148, y: 68, rot: 30, skin: SKIN, cuff: GOLD })
  } else {
    // fists on hips, the proud captain pose
    arms =
      arm(ctx, 'L', sL, { x: -112, y: 140 }, { color: COAT, width: 20, bend: 0.9 }) +
      arm(ctx, 'R', sR, { x: 112, y: 140 }, { color: COAT, width: 20, bend: -0.9 }) +
      hand(ctx, 'L', { x: -110, y: 146, rot: 70, skin: SKIN, kind: 'fist' }) +
      hand(ctx, 'R', { x: 110, y: 146, rot: -70, skin: SKIN, kind: 'fist', flip: true })
  }
  const file = eat ? fileCard(ctx, { x: -156, y: -150, label: 'PNG', color: '#4f8fe0' }) : ''
  return part(ctx, 'root', `<g transform="translate(0 -12) scale(0.92)">` + lowerBody(ctx) + body(ctx) + behind + headG + arms + parrot(ctx, 112, 62, eat) + `</g>` + file)
}
