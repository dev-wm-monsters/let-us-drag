// Generic, data-driven rig for SVG characters (pure; unit tested).
// The character art is two drawings (idle = mouth closed, eat = mouth open) whose groups carry
// data-part="<rig name>". The Uncle's brain (uncle/pose.ts) still produces the Pose every frame;
// these helpers turn it into transforms for the data-part groups (smaller amplitudes than the
// Uncle's procedural rig) and decide which drawing shows.
import { clamp } from '../spring'
import { chewRate, type Modifiers, type Mood, type Pose } from '../uncle/pose'

/** How much of the Uncle's head motion a drawn character takes. */
export const HEAD_AMP = 0.6
/** Pupil travel relative to the Uncle's (the drawn eyes are a bit smaller). */
export const PUPIL_AMP = 0.75
/** Chew cadence (open/close cycles per second) for the default mood. */
export const CHEW_HZ = 4

/** Parts that move with the face (toward the look target) or against it (behind the face plane). */
export const FACE_PARTS = ['face'] as const
export const NOSE_PARTS = ['nose'] as const
export const BEHIND_PARTS = ['hair', 'bun', 'topknot', 'toupee', 'cap', 'sideHair', 'sideburns', 'earL', 'earR'] as const

/** The rig names this module drives. Everything else in the drawing stays as drawn. */
export const RIG_PARTS = [
  'body',
  'head',
  ...FACE_PARTS,
  ...NOSE_PARTS,
  ...BEHIND_PARTS,
  'pupilL',
  'pupilR',
  'lidL',
  'lidR'
] as const
export type RigPart = (typeof RIG_PARTS)[number]

export interface Box {
  y: number
  height: number
}

/** Neck pivot of the head roll, and the squash pivot, in face coordinates (as drawn). */
export const HEAD_PIVOT = { x: 0, y: 100 } as const
export const SQUASH_PIVOT_Y = 120

const n = (x: number): string => (Math.round(x * 100) / 100).toString()

/**
 * Is the mouth open (eat drawing) at `moodT` seconds into `mood`? Open while eating, waiting to be
 * fed and hovering; chew alternates closed/open at ~4 Hz (slower when struggling, 2 Hz with reduced
 * motion); spit and the cancel spit-back open briefly; everything else is closed.
 */
export function mouthOpen(mood: Mood, moodT: number, mods: Modifiers, reduced: boolean): boolean {
  switch (mood) {
    case 'eat':
    case 'feedMe':
    case 'hover':
      return true
    case 'chew': {
      const hz = reduced ? 2 : CHEW_HZ * (chewRate(mods) / chewRate({ hamster: false, struggle: false }))
      // Starts open (the bite), then closes: phase 0..0.5 open, 0.5..1 closed.
      return (moodT * hz) % 1 < 0.5
    }
    case 'spit':
    case 'cancel':
      return moodT < 0.35
    default:
      return false
  }
}

/** 0 (open) .. 1 (shut) eyelid from the brain's lid (which rests around 0.1–0.55 by mood). */
export function blinkAmount(lid: number): number {
  return clamp((lid - 0.6) / 0.35, 0, 1)
}

/**
 * Upper-lid blink: stretch the drawn lid down from its top edge until its bottom edge reaches the
 * bottom of the eye. `lid` = the lid group's box, `eye` = the eye group's box (local coordinates).
 */
export function lidTransform(amount: number, lid: Box, eye: Box): string {
  if (amount <= 0 || lid.height <= 0) return ''
  const reach = Math.max(0, eye.y + eye.height - (lid.y + lid.height))
  const k = 1 + (amount * reach) / lid.height
  return `translate(0 ${n(lid.y)}) scale(1 ${n(k)}) translate(0 ${n(-lid.y)})`
}

/** Dynamic transforms for the rig parts (prepended to the drawing's own transform). */
export function partTransforms(p: Pose): Record<Exclude<RigPart, 'lidL' | 'lidR'>, string> {
  const a = HEAD_AMP
  const lx = clamp(p.lx, -1, 1)
  const ly = clamp(p.ly, -1, 1)
  const head =
    `translate(${n(p.headX * a)} ${n(p.headY * a)}) rotate(${n(p.headRot * a)} ${HEAD_PIVOT.x} ${HEAD_PIVOT.y}) ` +
    `translate(0 ${SQUASH_PIVOT_Y}) scale(${n(1 + (p.sx - 1) * a)} ${n(1 + (p.sy - 1) * a)}) translate(0 ${-SQUASH_PIVOT_Y})`
  const face = `translate(${n(lx * 10)} ${n(ly * 6)})`
  const nose = `translate(${n(lx * 5)} ${n(ly * 3)})`
  const behind = `translate(${n(-lx * 5)} ${n(-ly * 3)})`
  const out = {
    body: `translate(0 ${n(p.bodyY * a)})`,
    head,
    face,
    nose,
    pupilL: `translate(${n(p.pupilL.x * PUPIL_AMP)} ${n(p.pupilL.y * PUPIL_AMP)})`,
    pupilR: `translate(${n(p.pupilR.x * PUPIL_AMP)} ${n(p.pupilR.y * PUPIL_AMP)})`
  } as Record<Exclude<RigPart, 'lidL' | 'lidR'>, string>
  for (const k of BEHIND_PARTS) out[k] = behind
  return out
}

/** Root (appear / leave) transform + opacity, exactly like the Uncle's root group. */
export function rootAttrs(p: Pose): { transform: string; opacity: string } {
  return { transform: `rotate(${n(p.rootRot)}) scale(${n(p.rootScale)})`, opacity: n(p.rootOpacity) }
}

/** Compose a dynamic transform with the drawing's own one (the drawing's applies first, inside). */
export function compose(dynamic: string, own: string | null): string {
  return [dynamic, own ?? ''].filter((s) => s.trim() !== '').join(' ')
}

/**
 * Make the ids of an inlined drawing unique per instance: prefixes every id="…" and every
 * url(#…) / href="#…" reference with `prefix-`.
 */
export function prefixIds(svg: string, prefix: string): string {
  return svg
    .replace(/\sid="([^"]+)"/g, (_m, id: string) => ` id="${prefix}-${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_m, id: string) => `url(#${prefix}-${id})`)
    .replace(/href="#([^"]+)"/g, (_m, id: string) => `href="#${prefix}-${id}"`)
}
