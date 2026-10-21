// The Uncle's "brain": turns (mood, time, look target) into a Pose every frame.
// Pure and DOM-free (unit tested); the React component only writes the Pose into SVG attributes.
import { type Point, pupilOffset, softNorm } from '../geometry'
import { mulberry32, randRange, type Rng } from '../prng'
import { clamp, spring, springStep, type SpringState } from '../spring'

export type Mood =
  | 'hidden'
  | 'idle'
  | 'appear'
  | 'hover'
  | 'feedMe'
  | 'eat'
  | 'chew'
  | 'spit'
  | 'choke'
  | 'refuse'
  | 'leave'
  | 'cancel'

export interface Modifiers {
  hamster: boolean
  struggle: boolean
}

export interface HandPose {
  x: number
  y: number
  r: number
}

export interface Pose {
  rootScale: number
  rootOpacity: number
  rootRot: number
  bodyY: number
  headX: number
  headY: number
  headRot: number
  sx: number
  sy: number
  /** Normalised look direction (-1..1) used for parallax layers. */
  lx: number
  ly: number
  jaw: number
  smile: number
  brow: number
  knit: number
  lid: number
  happy: number
  cheek: number
  blush: number
  sweat: number
  t: number
  pupilL: Point
  pupilR: Point
  handL: HandPose
  handR: HandPose
  hairRot: number
  moleHairRot: number
}

/** Eye centres in face coordinates (must match the SVG drawing). */
export const EYE_L: Point = { x: -40, y: -30 }
export const EYE_R: Point = { x: 40, y: -30 }
export const PUPIL_MAX = 9.5
/**
 * Parallax depth per layer (multiplies the normalised look vector, in viewBox units).
 * Front features (nose, moustache) move most, the skull less, ears/hair (behind the face) move the
 * other way: together with the head roll this reads as a 3D head turn.
 */
export const DEPTH = {
  head: { x: 11, y: 7 },
  ears: { x: -12, y: -4 },
  hair: { x: -8, y: -4 },
  shine: { x: 20, y: 13 },
  wrinkles: { x: 16, y: 12 },
  brows: { x: 25, y: 17 },
  eyes: { x: 25, y: 16 },
  nose: { x: 38, y: 22 },
  cheeks: { x: 19, y: 12 },
  mole: { x: 26, y: 15 },
  moustache: { x: 33, y: 19 },
  mouth: { x: 27, y: 15 }
} as const

/** Head roll toward the look target at full turn (deg). */
export const HEAD_TURN_DEG = 11
/** Pivot of the head roll (the neck) and of the squash & stretch, in face coordinates. */
export const HEAD_PIVOT: Point = { x: 0, y: 110 }
export const SQUASH_PIVOT_Y = 132

/**
 * Foreshortening for a head turn of `lx` (-1..1, + = turning to the viewer's right): the features
 * compress a little, the far eye narrows, the near eye widens. Shared by attrs (SVG) and the pupil
 * solver, so the eyes keep pointing exactly at the target whatever the turn.
 */
export interface TurnRig {
  /** Face-features group: horizontal scale about x = faceCx. */
  faceCx: number
  faceSx: number
  /** Per-eye horizontal scale about the eye centre. */
  eyeSxL: number
  eyeSxR: number
  /** Far-side temple of the glasses shortens (goes behind the head), near side lengthens. */
  templeSxL: number
  templeSxR: number
  /** Ears: inward shift + horizontal squash (the far ear tucks behind the skull). */
  earL: { dx: number; sx: number }
  earR: { dx: number; sx: number }
}

export function turnRig(lx: number): TurnRig {
  const u = clamp(lx, -1, 1)
  const a = Math.abs(u)
  const farR = u >= 0
  const far = { eye: 1 - 0.36 * a, temple: 1 - 0.8 * a, ear: { dx: 0, sx: 1 - 0.45 * a } }
  const near = { eye: 1 + 0.05 * a, temple: 1 + 0.25 * a, ear: { dx: 0, sx: 1 + 0.08 * a } }
  // Both ears slide against the turn (they sit behind the face plane); the far one more.
  const farEarDx = -u * 16
  const nearEarDx = -u * 4
  return {
    faceCx: u * 30,
    faceSx: 1 - 0.1 * a,
    eyeSxL: farR ? near.eye : far.eye,
    eyeSxR: farR ? far.eye : near.eye,
    templeSxL: farR ? near.temple : far.temple,
    templeSxR: farR ? far.temple : near.temple,
    earL: farR ? { dx: nearEarDx, sx: near.ear.sx } : { dx: farEarDx, sx: far.ear.sx },
    earR: farR ? { dx: farEarDx, sx: far.ear.sx } : { dx: nearEarDx, sx: near.ear.sx }
  }
}

/** Head group transform parameters (see attrs.ts `head`). */
export interface HeadXf {
  headX: number
  headY: number
  headRot: number
  sx: number
  sy: number
}

/** Map a point from the overlay (viewBox) space into head-local (face) coordinates. */
export function headInverse(h: HeadXf, w: Point): Point {
  // Inverse of: translate(hx hy) rotate(rot, pivot) translate(0 S) scale(sx sy) translate(0 -S)
  const px = w.x - h.headX - HEAD_PIVOT.x
  const py = w.y - h.headY - HEAD_PIVOT.y
  const r = (-h.headRot * Math.PI) / 180
  const rx = px * Math.cos(r) - py * Math.sin(r) + HEAD_PIVOT.x
  const ry = px * Math.sin(r) + py * Math.cos(r) + HEAD_PIVOT.y
  return { x: rx / (h.sx || 1), y: (ry - SQUASH_PIVOT_Y) / (h.sy || 1) + SQUASH_PIVOT_Y }
}

/** Forward mapping of a head-local point into viewBox space (inverse of headInverse). */
export function headForward(h: HeadXf, p: Point): Point {
  const x = p.x * h.sx
  const y = (p.y - SQUASH_PIVOT_Y) * h.sy + SQUASH_PIVOT_Y
  const r = (h.headRot * Math.PI) / 180
  const dx = x - HEAD_PIVOT.x
  const dy = y - HEAD_PIVOT.y
  return {
    x: dx * Math.cos(r) - dy * Math.sin(r) + HEAD_PIVOT.x + h.headX,
    y: dx * Math.sin(r) + dy * Math.cos(r) + HEAD_PIVOT.y + h.headY
  }
}

/**
 * Where an eye-local point (inside the eye's scale wrapper, before the pupil offset) ends up in
 * head-local coordinates, and back. Used to aim the pupils through the whole rig.
 */
export function eyeLocalToHead(side: 'L' | 'R', p: Point, lx: number, ly: number, rig: TurnRig): Point {
  const e = side === 'L' ? EYE_L : EYE_R
  const k = side === 'L' ? rig.eyeSxL : rig.eyeSxR
  const x1 = (p.x - e.x) * k + e.x + lx * DEPTH.eyes.x
  const y1 = p.y + ly * DEPTH.eyes.y
  return { x: (x1 - rig.faceCx) * rig.faceSx + rig.faceCx, y: y1 }
}

function headToEyeLocal(side: 'L' | 'R', p: Point, lx: number, ly: number, rig: TurnRig): Point {
  const e = side === 'L' ? EYE_L : EYE_R
  const k = side === 'L' ? rig.eyeSxL : rig.eyeSxR
  const x0 = (p.x - rig.faceCx) / rig.faceSx + rig.faceCx - lx * DEPTH.eyes.x
  const y0 = p.y - ly * DEPTH.eyes.y
  return { x: (x0 - e.x) / k + e.x, y: y0 }
}

const SHOULDER_L: Point = { x: -66, y: 132 }
const SHOULDER_R: Point = { x: 66, y: 132 }
export { SHOULDER_L, SHOULDER_R }

export interface PoseInput {
  /** Seconds since start (monotonic). */
  t: number
  dt: number
  mood: Mood
  /** Seconds since the mood started. */
  moodT: number
  /** Look target in viewBox coordinates (null = idle wander). */
  target: Point | null
  mods: Modifiers
  reduced: boolean
}

type Hand = { x: SpringState; y: SpringState; r: SpringState }

export interface Brain {
  rng: Rng
  lookX: SpringState
  lookY: SpringState
  pl: { x: SpringState; y: SpringState }
  pr: { x: SpringState; y: SpringState }
  jaw: SpringState
  smile: SpringState
  brow: SpringState
  knit: SpringState
  lid: SpringState
  happy: SpringState
  cheek: SpringState
  blush: SpringState
  sweat: SpringState
  sq: SpringState
  hairRot: SpringState
  hl: Hand
  hr: Hand
  nextBlink: number
  blinkStart: number
  doubleBlink: boolean
  wander: Point
  nextWander: number
  chewPhase: number
  lastMood: Mood
}

const hand = (p: HandPose): Hand => ({ x: spring(p.x), y: spring(p.y), r: spring(p.r) })

export const REST_L: HandPose = { x: -44, y: 178, r: 42 }
export const REST_R: HandPose = { x: 44, y: 178, r: -42 }

export function createBrain(seed = 7): Brain {
  const rng = mulberry32(seed)
  return {
    rng,
    lookX: spring(0),
    lookY: spring(0),
    pl: { x: spring(0), y: spring(0) },
    pr: { x: spring(0), y: spring(0) },
    jaw: spring(0.05),
    smile: spring(0.35),
    brow: spring(0),
    knit: spring(0),
    lid: spring(0.1),
    happy: spring(0),
    cheek: spring(0),
    blush: spring(0.55),
    sweat: spring(0),
    sq: spring(0),
    hairRot: spring(0),
    hl: hand(REST_L),
    hr: hand(REST_R),
    nextBlink: 1.2,
    blinkStart: -10,
    doubleBlink: false,
    wander: { x: 0, y: 0 },
    nextWander: 2,
    chewPhase: 0,
    lastMood: 'hidden'
  }
}

interface Targets {
  jaw: number
  smile: number
  brow: number
  knit: number
  lid: number
  happy: number
  cheek: number
  blush: number
  sweat: number
  handL: HandPose
  handR: HandPose
  /** Extra head rotation (deg) e.g. head shake. */
  rot: number
  /** Extra head offset. */
  dx: number
  dy: number
  /** How strongly the Uncle follows the look target (0..1). */
  follow: number
  jawOmega: number
}

export function chewRate(mods: Modifiers): number {
  if (mods.struggle) return 1.7
  if (mods.hamster) return 2.6
  return 3.1
}

function easeOutBack(x: number): number {
  const c1 = 2.2
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

/** Mood → target expression (pure). */
export function moodTargets(mood: Mood, moodT: number, t: number, mods: Modifiers): Targets {
  const base: Targets = {
    jaw: 0.04,
    smile: 0.4,
    brow: 0,
    knit: 0,
    lid: 0.1,
    happy: 0,
    cheek: 0,
    blush: 0.55,
    sweat: mods.struggle ? 0.6 : 0,
    handL: REST_L,
    handR: REST_R,
    rot: 0,
    dx: 0,
    dy: 0,
    follow: 1,
    jawOmega: 14
  }
  const wig = Math.sin(t * 9) * 6
  switch (mood) {
    case 'hidden':
    case 'idle':
      return { ...base, follow: 0.8 }
    case 'appear':
      return {
        ...base,
        jaw: 0.92,
        smile: 0.25,
        brow: 0.9,
        lid: 0,
        handL: { x: -124, y: 78 + wig * 0.5, r: -34 + wig },
        handR: { x: 124, y: 78 - wig * 0.5, r: 34 - wig }
      }
    case 'hover':
      return {
        ...base,
        jaw: 1,
        smile: 0.55,
        brow: 1,
        lid: 0,
        blush: 0.8,
        handL: { x: -120, y: 70 + wig * 0.6, r: -30 + wig * 1.4 },
        handR: { x: 120, y: 70 - wig * 0.6, r: 30 - wig * 1.4 }
      }
    case 'feedMe': {
      const aah = Math.sin(t * 7) * 0.05
      const beckon = Math.sin(t * 8) * 14
      return {
        ...base,
        jaw: 1.02 + aah,
        smile: 0.15,
        brow: 0.75,
        lid: 0,
        handL: { x: -112, y: 92, r: -70 + beckon },
        handR: { x: 112, y: 92, r: 70 - beckon }
      }
    }
    case 'eat': {
      const snap = moodT > 0.2
      return {
        ...base,
        jaw: snap ? 0 : 1.1,
        smile: snap ? 0.1 : 0.2,
        brow: snap ? 0.4 : 1,
        lid: snap ? 0.85 : 0,
        cheek: snap ? 0.9 : 0,
        jawOmega: snap ? 40 : 18,
        handL: { x: -100, y: 120, r: 40 },
        handR: { x: 100, y: 120, r: -40 },
        follow: 0.3
      }
    }
    case 'chew': {
      // Jaw follows the chew cycle directly (the brain integrates the phase).
      const circ = t * 5
      return {
        ...base,
        jaw: 0.08,
        smile: 0.35,
        brow: 0.15,
        lid: mods.struggle ? 0.3 : 0.55,
        cheek: mods.hamster ? 1.25 : 0.75,
        blush: 0.75,
        handL: { x: -40 + Math.cos(circ) * 8, y: 178 + Math.sin(circ) * 5, r: 40 },
        handR: { x: 40 - Math.cos(circ) * 8, y: 178 - Math.sin(circ) * 5, r: -40 },
        follow: 0.35
      }
    }
    case 'spit': {
      const ptoo = moodT < 0.2
      return {
        ...base,
        jaw: ptoo ? 0.75 : 0.28,
        smile: 1,
        brow: 0.6,
        lid: 0,
        happy: ptoo ? 0 : 1,
        blush: 0.85,
        sweat: 0,
        jawOmega: 22,
        handL: REST_L,
        handR: moodT < 0.35 ? { x: 132, y: 80, r: 70 } : { x: 126, y: 22, r: 30 + Math.sin(t * 6) * 8 },
        follow: 0.5
      }
    }
    case 'choke': {
      const cycle = moodT % 0.62
      const cough = moodT < 2.2 && cycle < 0.14
      return {
        ...base,
        jaw: cough ? 0.78 : 0.12,
        smile: -0.5,
        brow: 0.3,
        knit: 0.6,
        lid: cough ? 0.9 : 0.35,
        blush: 1,
        sweat: 1,
        jawOmega: 30,
        dx: cough ? 3 : 0,
        dy: cough ? -4 : 0,
        rot: cough ? -3 : 0,
        handL: { x: -52, y: 168, r: 30 },
        handR: { x: 34, y: 104, r: -95 },
        follow: 0.2
      }
    }
    case 'refuse': {
      const shake = 10 * Math.sin(moodT * 2 * Math.PI * 2.1) * Math.exp(-moodT * 0.9)
      return {
        ...base,
        jaw: 0,
        smile: -0.75,
        brow: -0.2,
        knit: 1,
        lid: 0.4,
        blush: 0.7,
        rot: shake,
        handL: { x: 48, y: 166, r: 92 },
        handR: { x: -48, y: 160, r: -92 },
        follow: 0.15
      }
    }
    case 'cancel': {
      // "Ptoo!" — cheeks puff, the mouth pops open and the file flies back out; then a grumpy shrug.
      const ptoo = moodT < 0.22
      const puff = moodT < 0.1
      return {
        ...base,
        jaw: puff ? 0.05 : ptoo ? 0.85 : 0.1,
        smile: ptoo ? -0.1 : -0.3,
        brow: ptoo ? 0.8 : 0.45,
        knit: ptoo ? 0 : 0.25,
        lid: ptoo ? 0 : 0.45,
        cheek: puff ? 1.1 : 0,
        blush: 0.7,
        jawOmega: 34,
        dy: ptoo ? -5 : 0,
        rot: ptoo ? 0 : -5,
        handL: ptoo ? { x: -70, y: 150, r: 20 } : { x: -114, y: 108, r: -72 + Math.sin(t * 5) * 4 },
        handR: ptoo ? { x: 70, y: 150, r: -20 } : { x: 114, y: 108, r: 72 - Math.sin(t * 5) * 4 },
        follow: 0.4
      }
    }
    case 'leave': {
      const wave = Math.sin(t * 14) * 18
      const p = Math.min(1, moodT / 0.38)
      return { ...base, jaw: 0.3, smile: 0.8, happy: 1, handR: { x: 122, y: 34, r: 20 + wave }, follow: 0, dy: p * 6 }
    }
  }
}

/** Root (whole character) scale/opacity for appear/leave pops. */
export function rootTransform(mood: Mood, moodT: number, reduced: boolean): { scale: number; opacity: number; rot: number } {
  if (mood === 'hidden') return { scale: 0.6, opacity: 0, rot: 0 }
  if (mood === 'leave') {
    const p = clamp(moodT / 0.38, 0, 1)
    // Small swell, then shrink away.
    const s = reduced ? 1 - p * 0.2 : 1 + 0.08 * Math.sin(p * Math.PI) - p * p * 0.95
    return { scale: Math.max(0.05, s), opacity: 1 - p * p, rot: reduced ? 0 : -p * 12 }
  }
  if (mood === 'appear' && moodT < 0.42 && !reduced) {
    const p = moodT / 0.42
    return { scale: 0.6 + 0.4 * easeOutBack(p), opacity: Math.min(1, 0.45 + moodT / 0.1), rot: 0 }
  }
  if (mood === 'appear' && reduced) return { scale: 1, opacity: Math.min(1, 0.45 + moodT / 0.15), rot: 0 }
  return { scale: 1, opacity: 1, rot: 0 }
}

export interface StepResult {
  pose: Pose
  /** True on the frame the jaw closes during chewing (crunch sound). */
  chewBeat: boolean
}

/** Advance the brain by one frame. */
export function step(b: Brain, i: PoseInput): StepResult {
  const dt = Math.min(Math.max(i.dt, 0), 0.1)
  const motion = i.reduced ? 0.3 : 1
  const tg = moodTargets(i.mood, i.moodT, i.t, i.mods)

  // Mood change kicks (squash & stretch impulses).
  if (i.mood !== b.lastMood) {
    if (i.mood === 'appear') {
      b.sq.x = 0
      b.sq.v = 2.4
    }
    if (i.mood === 'spit') b.sq.v -= 1.6
    if (i.mood === 'refuse') b.sq.v += 0.8
    if (i.mood === 'cancel') b.sq.v += 1.6
    b.lastMood = i.mood
  }
  if (i.mood === 'eat' && i.moodT > 0.2 && i.moodT - dt <= 0.2) b.sq.v -= 2.8 // jaw snap = squash

  // Look target → normalised direction (with idle wander when no target).
  let tx: number
  let ty: number
  if (i.target) {
    tx = softNorm(i.target.x, 170)
    ty = softNorm(i.target.y + 10, 170)
  } else {
    if (i.t >= b.nextWander) {
      const r = b.rng()
      b.wander = r < 0.45 ? { x: 0, y: 0 } : { x: randRange(b.rng, -0.6, 0.6), y: randRange(b.rng, -0.35, 0.3) }
      b.nextWander = i.t + randRange(b.rng, 1.2, 3.2)
    }
    tx = b.wander.x
    ty = b.wander.y
  }
  tx *= tg.follow
  ty *= tg.follow
  const prevLx = b.lookX.x
  springStep(b.lookX, tx, 9, dt)
  springStep(b.lookY, ty, 9, dt)
  const lx = b.lookX.x
  const ly = b.lookY.x

  // Expression springs.
  if (i.mood === 'chew') {
    const rate = chewRate(i.mods)
    const before = b.chewPhase
    b.chewPhase = (b.chewPhase + dt * rate) % 1
    const wrapped = b.chewPhase < before
    const amp = i.reduced ? 0.14 : 0.26
    const c = 0.5 - 0.5 * Math.cos(b.chewPhase * Math.PI * 2)
    springStep(b.jaw, tg.jaw + amp * c, 30, dt)
    return finish(b, i, tg, lx, ly, prevLx, dt, motion, wrapped)
  }
  b.chewPhase = 0
  springStep(b.jaw, tg.jaw, tg.jawOmega, dt)
  return finish(b, i, tg, lx, ly, prevLx, dt, motion, false)
}

function finish(
  b: Brain,
  i: PoseInput,
  tg: Targets,
  lx: number,
  ly: number,
  prevLx: number,
  dt: number,
  motion: number,
  chewBeat: boolean
): StepResult {
  springStep(b.smile, tg.smile, 12, dt)
  springStep(b.brow, tg.brow, 12, dt)
  springStep(b.knit, tg.knit, 12, dt)
  springStep(b.happy, tg.happy, 18, dt)
  springStep(b.cheek, tg.cheek, 10, dt)
  springStep(b.blush, tg.blush, 6, dt)
  springStep(b.sweat, tg.sweat, 5, dt)
  springStep(b.sq, 0, 7, dt)
  for (const [h, p] of [
    [b.hl, tg.handL],
    [b.hr, tg.handR]
  ] as const) {
    springStep(h.x, p.x, 13, dt)
    springStep(h.y, p.y, 13, dt)
    springStep(h.r, p.r, 13, dt)
  }

  // Blinks: deterministic pseudo-random schedule, sometimes a double blink.
  if (i.t >= b.nextBlink) {
    b.blinkStart = i.t
    b.doubleBlink = b.rng() < 0.2
    b.nextBlink = i.t + randRange(b.rng, 2.2, 5.5)
  }
  const bt = i.t - b.blinkStart
  const blinkDur = 0.14
  let blink = 0
  if (bt >= 0 && bt < blinkDur) blink = 1 - Math.abs(bt / blinkDur - 0.5) * 2
  else if (b.doubleBlink && bt >= blinkDur + 0.08 && bt < 2 * blinkDur + 0.08)
    blink = 1 - Math.abs((bt - blinkDur - 0.08) / blinkDur - 0.5) * 2
  springStep(b.lid, tg.lid, 16, dt)
  const lid = clamp(Math.max(b.lid.x, blink * 1.05), 0, 1)

  // Breathing + squash & stretch.
  const breath = Math.sin(i.t * ((2 * Math.PI) / 3.4))
  const sqv = clamp(b.sq.x, -0.3, 0.3) * motion
  const sy = 1 + 0.014 * breath * motion + sqv
  const sx = 1 - 0.009 * breath * motion - sqv * 0.6

  // Secondary motion: the comb-over hair lags behind head turns.
  const lookVel = dt > 0 ? (lx - prevLx) / dt : 0
  springStep(b.hairRot, clamp(-lookVel * 18, -30, 30), 6, dt)

  // Head turn: translate + roll toward the target, slight narrowing (foreshortening).
  const lxm = lx * motion
  const lym = ly * motion
  const rig = turnRig(lxm)
  const headX = lxm * DEPTH.head.x + tg.dx * motion
  const headY = lym * DEPTH.head.y + breath * 1.2 * motion + tg.dy * motion
  const headRot = lxm * HEAD_TURN_DEG + tg.rot * motion
  const sxTurn = sx * (1 - 0.035 * Math.abs(lxm))

  // Pupils: exact direction to the target, solved through the whole rig (roll, squash, parallax,
  // per-eye foreshortening) so the eyes stay locked on the file however far the head turns.
  let pl: Point = { x: 0, y: 0 }
  let pr: Point = { x: 0, y: 0 }
  if (i.target) {
    const local = headInverse({ headX, headY, headRot, sx: sxTurn, sy }, i.target)
    pl = pupilOffset(EYE_L, headToEyeLocal('L', local, lxm, lym, rig), PUPIL_MAX)
    pr = pupilOffset(EYE_R, headToEyeLocal('R', local, lxm, lym, rig), PUPIL_MAX)
  } else {
    pl = { x: lx * PUPIL_MAX * 0.8, y: ly * PUPIL_MAX * 0.7 }
    pr = { ...pl }
  }
  if (i.mood === 'choke' || i.mood === 'chew') {
    // Look slightly down while chewing / coughing.
    pl = { x: pl.x * 0.4, y: pl.y * 0.4 + 3 }
    pr = { x: pr.x * 0.4, y: pr.y * 0.4 + 3 }
  }
  springStep(b.pl.x, pl.x, 26, dt)
  springStep(b.pl.y, pl.y, 26, dt)
  springStep(b.pr.x, pr.x, 26, dt)
  springStep(b.pr.y, pr.y, 26, dt)

  const root = rootTransform(i.mood, i.moodT, i.reduced)
  const pose: Pose = {
    rootScale: root.scale,
    rootOpacity: root.opacity,
    rootRot: root.rot,
    bodyY: breath * 0.6 * motion,
    headX,
    headY,
    headRot,
    sx: sxTurn,
    sy,
    lx: lxm,
    ly: lym,
    jaw: clamp(b.jaw.x, 0, 1.15),
    smile: clamp(b.smile.x, -1, 1),
    brow: b.brow.x,
    knit: clamp(b.knit.x, 0, 1),
    lid,
    happy: clamp(b.happy.x, 0, 1),
    cheek: Math.max(0, b.cheek.x),
    blush: clamp(b.blush.x, 0, 1),
    sweat: clamp(b.sweat.x, 0, 1),
    t: i.t,
    pupilL: { x: b.pl.x.x, y: b.pl.y.x },
    pupilR: { x: b.pr.x.x, y: b.pr.y.x },
    handL: { x: b.hl.x.x, y: b.hl.y.x, r: b.hl.r.x },
    handR: { x: b.hr.x.x, y: b.hr.y.x, r: b.hr.r.x },
    hairRot: b.hairRot.x + Math.sin(i.t * 2.3) * 4 * motion,
    moleHairRot: Math.sin(i.t * 3.1) * 12 * motion
  }
  return { pose, chewBeat }
}

/** Run the brain for `seconds` at 60 fps in a fixed mood (used for static renders and tests). */
export function settle(mood: Mood, seconds: number, target: Point | null, mods: Modifiers = { hamster: false, struggle: false }, seed = 7): Pose {
  const b = createBrain(seed)
  let r: StepResult | null = null
  const dt = 1 / 60
  const n = Math.max(1, Math.round(seconds * 60))
  for (let k = 0; k < n; k++) r = step(b, { t: 10 + k * dt, dt, mood, moodT: k * dt, target, mods, reduced: false })
  return r!.pose
}
