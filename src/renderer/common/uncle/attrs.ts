// Pose → SVG attribute values for every animated part (pure).
// Used for the initial React render (and static/SSR renders) and by the rAF loop, so both always agree.
import { armPath, headPath, JAW_DROP, lidLinePath, lidPath, mouthPath, mouthShape } from './paths'
import { DEPTH, EYE_L, EYE_R, type Pose, SHOULDER_L, SHOULDER_R } from './pose'

export type Attrs = Record<string, string>

const n = (x: number): string => (Math.round(x * 100) / 100).toString()
const tr = (x: number, y: number): string => `translate(${n(x)} ${n(y)})`
const layer = (p: Pose, d: { x: number; y: number }): string => tr(p.lx * d.x, p.ly * d.y)

/** Chewing cheek pouches: grow out of the jowls (scale 0 = hidden). */
function pouch(side: -1 | 1, puff: number, J: number): string {
  const s = Math.max(0, Math.min(1.3, puff))
  return `translate(${n(side * (90 + s * 8))} ${n(58 + J * 0.5)}) scale(${n(s)})`
}

export const EYE_RX = 20
export const EYE_RY = 22

export const PART_KEYS = [
  'root',
  'body',
  'head',
  'headInk',
  'headFill',
  'headClip',
  'shade',
  'pouchInkL',
  'pouchInkR',
  'pouchL',
  'pouchR',
  'ears',
  'hair',
  'combover',
  'shine',
  'wrinkles',
  'brows',
  'browL',
  'browR',
  'eyes',
  'pupilL',
  'pupilR',
  'lidL',
  'lidR',
  'lidLineL',
  'lidLineR',
  'scleraL',
  'scleraR',
  'happyL',
  'happyR',
  'nose',
  'cheeks',
  'blushL',
  'blushR',
  'mole',
  'moleHair',
  'moustache',
  'mouth',
  'mouthFill',
  'mouthClip',
  'mouthLine',
  'throat',
  'uvula',
  'tongue',
  'lowerTeeth',
  'upperTeeth',
  'lip',
  'chin',
  'armLInk',
  'armLSleeve',
  'armRInk',
  'armRSleeve',
  'handL',
  'handR',
  'sweat',
  'drop1',
  'drop2'
] as const

export type PartKey = (typeof PART_KEYS)[number]

export function poseAttrs(p: Pose): Record<PartKey, Attrs> {
  const J = p.jaw * JAW_DROP
  const puff = Math.min(1.3, p.cheek)
  const head = headPath(p.jaw, puff)
  const m = mouthShape(p.jaw, p.smile)
  const mouth = mouthPath(p.jaw, p.smile)
  const bodyDy = p.bodyY + J * 0.78 + p.headY * 0.25
  const browAngle = -p.knit * 16 + p.brow * 5
  const browY = -p.brow * 9 + p.knit * 5
  const sclera = n(1 - p.happy)
  const happy = n(p.happy)
  const mouthLayer = layer(p, DEPTH.mouth)
  const lipY = m.bottom
  const sweatPhase = (p.t * 0.8) % 1
  const sL = { x: SHOULDER_L.x, y: SHOULDER_L.y + bodyDy }
  const sR = { x: SHOULDER_R.x, y: SHOULDER_R.y + bodyDy }
  const armL = armPath(sL, { x: p.handL.x, y: p.handL.y }, 0.6)
  const armR = armPath(sR, { x: p.handR.x, y: p.handR.y }, -0.6)
  return {
    root: {
      transform: `rotate(${n(p.rootRot)}) scale(${n(p.rootScale)})`,
      opacity: n(p.rootOpacity)
    },
    body: { transform: tr(0, bodyDy) },
    head: {
      transform: `${tr(p.headX, p.headY)} rotate(${n(p.headRot)} 0 110) translate(0 132) scale(${n(p.sx)} ${n(p.sy)}) translate(0 -132)`
    },
    headInk: { d: head },
    headFill: { d: head },
    headClip: { d: head },
    shade: { cy: n(-28 + J * 0.45), ry: n(146 + J * 0.85), rx: n(118 + puff * 10) },
    pouchInkL: { transform: pouch(-1, puff, J) },
    pouchInkR: { transform: pouch(1, puff, J) },
    pouchL: { transform: pouch(-1, puff, J) },
    pouchR: { transform: pouch(1, puff, J) },
    ears: { transform: layer(p, DEPTH.ears) },
    hair: { transform: layer(p, DEPTH.hair) },
    combover: { transform: `rotate(${n(p.hairRot)} 6 -128)` },
    shine: { transform: layer(p, DEPTH.shine) },
    wrinkles: {
      transform: `${layer(p, DEPTH.wrinkles)} translate(0 ${n(-Math.max(0, p.brow) * 4)})`,
      opacity: n(0.25 + Math.max(0, p.brow) * 0.6)
    },
    brows: { transform: `${layer(p, DEPTH.brows)} translate(0 ${n(browY)})` },
    browL: { transform: `rotate(${n(-browAngle)} -78 -66)` },
    browR: { transform: `rotate(${n(browAngle)} 78 -66)` },
    eyes: { transform: layer(p, DEPTH.eyes) },
    pupilL: { transform: tr(p.pupilL.x, p.pupilL.y) },
    pupilR: { transform: tr(p.pupilR.x, p.pupilR.y) },
    lidL: { d: lidPath(EYE_L.x, EYE_L.y, EYE_RX, EYE_RY, p.lid) },
    lidR: { d: lidPath(EYE_R.x, EYE_R.y, EYE_RX, EYE_RY, p.lid) },
    lidLineL: { d: lidLinePath(EYE_L.x, EYE_L.y, EYE_RX, EYE_RY, p.lid), opacity: n(p.lid > 0.04 ? 1 : 0) },
    lidLineR: { d: lidLinePath(EYE_R.x, EYE_R.y, EYE_RX, EYE_RY, p.lid), opacity: n(p.lid > 0.04 ? 1 : 0) },
    scleraL: { opacity: sclera },
    scleraR: { opacity: sclera },
    happyL: { opacity: happy },
    happyR: { opacity: happy },
    nose: { transform: layer(p, DEPTH.nose) },
    cheeks: { transform: layer(p, DEPTH.cheeks) },
    blushL: {
      transform: `translate(-66 24) scale(${n(1 + puff * 0.3)})`,
      opacity: n(0.25 + p.blush * 0.5)
    },
    blushR: {
      transform: `translate(66 24) scale(${n(1 + puff * 0.3)})`,
      opacity: n(0.25 + p.blush * 0.5)
    },
    mole: { transform: layer(p, DEPTH.mole) },
    moleHair: { transform: `rotate(${n(p.moleHairRot)} -44 11)` },
    moustache: {
      transform: `${layer(p, DEPTH.moustache)} translate(0 ${n(-p.jaw * 6 - Math.max(0, p.smile) * 2)})`
    },
    mouth: { transform: mouthLayer },
    mouthFill: { d: mouth },
    mouthClip: { d: mouth },
    mouthLine: { d: mouth },
    throat: {
      cy: n(m.top + (m.bottom - m.top) * 0.42),
      rx: n(m.w * 0.48),
      ry: n(Math.max(0.1, (m.bottom - m.top) * 0.3))
    },
    uvula: { transform: tr(0, m.top + 8 + (m.bottom - m.top) * 0.06) },
    tongue: { transform: `${tr(0, m.bottom - 3)} scale(${n(m.w / 50)} ${n(0.7 + p.jaw * 0.4)})` },
    lowerTeeth: { transform: `${tr(0, m.bottom)} scale(${n(m.w / 50)} 1)` },
    upperTeeth: { transform: `${tr(0, m.top + 1)} scale(${n(m.w / 50)} 1)` },
    lip: {
      d: `M ${n(-m.w * 0.42)} ${n(lipY + 6)} Q 0 ${n(lipY + 13 + Math.max(0, p.smile) * 3)} ${n(m.w * 0.42)} ${n(lipY + 6)}`,
      opacity: '0.9'
    },
    chin: { transform: tr(0, 123 + J - 12) },
    armLInk: { d: armL },
    armLSleeve: { d: armL },
    armRInk: { d: armR },
    armRSleeve: { d: armR },
    handL: { transform: `${tr(p.handL.x, p.handL.y)} rotate(${n(p.handL.r)}) scale(-1 1)` },
    handR: { transform: `${tr(p.handR.x, p.handR.y)} rotate(${n(p.handR.r)})` },
    sweat: { opacity: n(p.sweat) },
    drop1: { transform: tr(-84, -66 + sweatPhase * 26), opacity: n(1 - sweatPhase) },
    drop2: { transform: tr(88, -50 + ((sweatPhase + 0.5) % 1) * 26), opacity: n(1 - ((sweatPhase + 0.5) % 1)) }
  }
}
