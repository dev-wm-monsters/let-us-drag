import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../prng'
import { PART_KEYS, poseAttrs } from './attrs'
import { armPath, headPath, JAW_DROP, lidPath, mouthPath, mouthShape } from './paths'
import {
  createBrain,
  EYE_L,
  EYE_R,
  eyeLocalToHead,
  headForward,
  headInverse,
  type Mood,
  moodTargets,
  type Pose,
  PUPIL_MAX,
  rootTransform,
  settle,
  step,
  turnRig
} from './pose'

const MOODS: Mood[] = ['hidden', 'idle', 'appear', 'hover', 'feedMe', 'eat', 'chew', 'spit', 'choke', 'refuse', 'leave', 'cancel']
const noMods = { hamster: false, struggle: false }
const NUM = /-?\d+(\.\d+)?/g

function finiteNumbers(s: string): boolean {
  return !/NaN|Infinity/.test(s) && (s.match(NUM) ?? []).every((x) => Number.isFinite(Number(x)))
}

describe('procedural paths', () => {
  it('produce finite path data across the whole parameter range', () => {
    for (let j = 0; j <= 1.15; j += 0.05) {
      for (let s = -1; s <= 1; s += 0.25) {
        expect(finiteNumbers(mouthPath(j, s))).toBe(true)
      }
      expect(finiteNumbers(headPath(j, j))).toBe(true)
    }
    expect(finiteNumbers(armPath({ x: 0, y: 0 }, { x: 0, y: 0 }, 1))).toBe(true)
    expect(finiteNumbers(lidPath(0, 0, 20, 22, 2))).toBe(true)
  })

  it('the chin drops with the jaw and the mouth opens wider', () => {
    const closed = mouthShape(0, 0)
    const open = mouthShape(1, 0)
    expect(open.bottom - open.top).toBeGreaterThan(closed.bottom - closed.top + 50)
    expect(open.w).toBeGreaterThan(closed.w)
    expect(headPath(1)).toContain(`0,${123 + JAW_DROP}`)
  })

  it('a smile lifts the mouth corners, a frown lowers them', () => {
    expect(mouthShape(0, 1).corner).toBeLessThan(mouthShape(0, 0).corner)
    expect(mouthShape(0, -1).corner).toBeGreaterThan(mouthShape(0, 0).corner)
  })
})

describe('pose brain', () => {
  it('every mood yields finite attributes for every animated part', () => {
    for (const mood of MOODS) {
      const pose = settle(mood, 0.8, { x: 120, y: -40 })
      const attrs = poseAttrs(pose)
      for (const k of PART_KEYS) {
        for (const v of Object.values(attrs[k])) expect(finiteNumbers(v)).toBe(true)
      }
    }
  })

  it('pupils stay inside the eyes for any target (random sweep)', () => {
    const rng = mulberry32(99)
    const b = createBrain(1)
    for (let i = 0; i < 2000; i++) {
      const target = { x: (rng() - 0.5) * 4000, y: (rng() - 0.5) * 4000 }
      const { pose } = step(b, { t: i / 60, dt: 1 / 60, mood: 'hover', moodT: i / 60, target, mods: noMods, reduced: false })
      expect(Math.hypot(pose.pupilL.x, pose.pupilL.y)).toBeLessThanOrEqual(PUPIL_MAX + 1e-6)
      expect(Math.hypot(pose.pupilR.x, pose.pupilR.y)).toBeLessThanOrEqual(PUPIL_MAX + 1e-6)
    }
  })

  it('head turns toward the target and pupils point at it', () => {
    const right = settle('appear', 1.5, { x: 400, y: -10 })
    const left = settle('appear', 1.5, { x: -400, y: -10 })
    expect(right.lx).toBeGreaterThan(0.5)
    expect(left.lx).toBeLessThan(-0.5)
    expect(right.pupilL.x).toBeGreaterThan(5)
    expect(left.pupilR.x).toBeLessThan(-5)
    expect(right.headRot).toBeGreaterThan(0)
  })

  it('the head turn is clearly visible: ~±10° roll, strong parallax, far eye foreshortened (F1)', () => {
    const right = settle('hover', 1.5, { x: 300, y: -60 })
    const left = settle('hover', 1.5, { x: -300, y: -60 })
    expect(right.headRot).toBeGreaterThan(8)
    expect(right.headRot).toBeLessThan(12.5)
    expect(left.headRot).toBeLessThan(-8)
    // Nose (front) moves much more than the skull: a 3D turn, not a slide.
    const attrs = poseAttrs(right)
    const noseX = Number(/translate\((-?[\d.]+)/.exec(attrs.nose.transform ?? '')?.[1] ?? 'NaN')
    expect(noseX).toBeGreaterThan(25)
    expect(noseX).toBeGreaterThan(right.headX * 2)
    // Turning right: the right eye is the far one and is narrower than the left one.
    const rig = turnRig(right.lx)
    expect(rig.eyeSxR).toBeLessThan(0.8)
    expect(rig.eyeSxL).toBeGreaterThanOrEqual(1)
    expect(turnRig(0)).toMatchObject({ eyeSxL: 1, eyeSxR: 1, faceSx: 1 })
  })

  it('head transform inverse/forward round-trip', () => {
    const h = { headX: 7, headY: -3, headRot: 9.5, sx: 0.97, sy: 1.02 }
    for (const p of [
      { x: 0, y: 0 },
      { x: -40, y: -30 },
      { x: 300, y: -200 }
    ]) {
      const q = headForward(h, headInverse(h, p))
      expect(q.x).toBeCloseTo(p.x, 6)
      expect(q.y).toBeCloseTo(p.y, 6)
    }
  })

  it('pupils point exactly at the target through the whole rig (roll, parallax, foreshortening)', () => {
    const worldPupil = (pose: Pose, side: 'L' | 'R') => {
      const e = side === 'L' ? EYE_L : EYE_R
      const off = side === 'L' ? pose.pupilL : pose.pupilR
      const rig = turnRig(pose.lx)
      const h = { headX: pose.headX, headY: pose.headY, headRot: pose.headRot, sx: pose.sx, sy: pose.sy }
      const centre = headForward(h, eyeLocalToHead(side, e, pose.lx, pose.ly, rig))
      const pupil = headForward(h, eyeLocalToHead(side, { x: e.x + off.x, y: e.y + off.y }, pose.lx, pose.ly, rig))
      return { centre, pupil }
    }
    for (const target of [
      { x: 260, y: -220 },
      { x: -260, y: -220 },
      { x: -260, y: 200 },
      { x: 260, y: 200 },
      { x: 30, y: -300 }
    ]) {
      const pose = settle('hover', 2, target)
      for (const side of ['L', 'R'] as const) {
        const { centre, pupil } = worldPupil(pose, side)
        const want = Math.atan2(target.y - centre.y, target.x - centre.x)
        const got = Math.atan2(pupil.y - centre.y, pupil.x - centre.x)
        const diff = Math.abs(Math.atan2(Math.sin(want - got), Math.cos(want - got)))
        expect(diff).toBeLessThan((4 * Math.PI) / 180)
      }
    }
  })

  it('blinks within a few seconds (deterministic schedule)', () => {
    const b = createBrain(5)
    let closed = 0
    for (let i = 0; i < 60 * 8; i++) {
      const { pose } = step(b, { t: i / 60, dt: 1 / 60, mood: 'idle', moodT: i / 60, target: null, mods: noMods, reduced: false })
      if (pose.lid > 0.9) closed++
    }
    expect(closed).toBeGreaterThan(0)
    expect(closed).toBeLessThan(60) // blinks are short
  })

  it('breathes (body moves) even when idle with no target', () => {
    const b = createBrain(2)
    const ys = new Set<number>()
    for (let i = 0; i < 120; i++) {
      const { pose } = step(b, { t: i / 60, dt: 1 / 60, mood: 'idle', moodT: i / 60, target: null, mods: noMods, reduced: false })
      ys.add(Math.round(pose.sy * 1e4))
    }
    expect(ys.size).toBeGreaterThan(10)
  })

  it('chewing produces crunch beats at roughly the chew rate (slower when struggling)', () => {
    const beats = (struggle: boolean) => {
      const b = createBrain(3)
      let n = 0
      for (let i = 0; i < 60 * 4; i++) {
        const r = step(b, {
          t: i / 60,
          dt: 1 / 60,
          mood: 'chew',
          moodT: i / 60,
          target: null,
          mods: { hamster: false, struggle },
          reduced: false
        })
        if (r.chewBeat) n++
      }
      return n
    }
    expect(beats(false)).toBeGreaterThanOrEqual(11)
    expect(beats(false)).toBeLessThanOrEqual(13)
    expect(beats(true)).toBeLessThan(beats(false))
  })

  it('reduced motion damps head movement but keeps the eyes tracking', () => {
    const run = (reduced: boolean) => {
      const b = createBrain(4)
      let pose = step(b, { t: 0, dt: 0, mood: 'hover', moodT: 0, target: { x: 500, y: 0 }, mods: noMods, reduced }).pose
      for (let i = 1; i < 90; i++)
        pose = step(b, { t: i / 60, dt: 1 / 60, mood: 'hover', moodT: i / 60, target: { x: 500, y: 0 }, mods: noMods, reduced }).pose
      return pose
    }
    const full = run(false)
    const calm = run(true)
    expect(Math.abs(calm.headX)).toBeLessThan(Math.abs(full.headX) * 0.5)
    expect(calm.pupilL.x).toBeGreaterThan(5)
  })

  it('appear pops in with overshoot, leave shrinks and fades out', () => {
    const scales = Array.from({ length: 30 }, (_, i) => rootTransform('appear', i / 60, false).scale)
    expect(scales[0]).toBeCloseTo(0.6, 5)
    // Visible on the very first frame of engagement.
    expect(rootTransform('appear', 0, false).opacity).toBeGreaterThan(0.3)
    expect(rootTransform('appear', 0, true).opacity).toBeGreaterThan(0.3)
    expect(Math.max(...scales)).toBeGreaterThan(1)
    expect(rootTransform('appear', 1, false).scale).toBe(1)
    expect(rootTransform('leave', 0.38, false).opacity).toBe(0)
    expect(rootTransform('hidden', 0, false).opacity).toBe(0)
  })

  it('moods map to recognisable expressions', () => {
    const t = (m: Mood, moodT = 1) => moodTargets(m, moodT, 0, noMods)
    expect(t('appear').jaw).toBeGreaterThan(0.8) // mouth wide open
    expect(t('eat', 0.1).jaw).toBeGreaterThan(1) // about to snap
    expect(t('eat', 0.3).jaw).toBe(0) // snapped shut
    expect(t('refuse').smile).toBeLessThan(0) // frown
    expect(t('refuse').knit).toBe(1) // angry brows
    expect(t('refuse').handL.x).toBeGreaterThan(0) // arms crossed
    expect(t('spit').happy).toBe(1)
    expect(t('cancel', 0.15).jaw).toBeGreaterThan(0.6) // "ptoo!"
    expect(t('cancel', 1).smile).toBeLessThan(0) // "fine, keep it."
    expect(t('cancel', 1).handR.x).toBeGreaterThan(100) // shrug
    expect(moodTargets('chew', 1, 0, { hamster: true, struggle: false }).cheek).toBeGreaterThan(t('chew').cheek)
    expect(moodTargets('chew', 1, 0, { hamster: false, struggle: true }).sweat).toBeGreaterThan(0)
  })
})
