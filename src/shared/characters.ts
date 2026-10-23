// Character manifest: which characters ship, their display names, and where their art comes from.
// Shared by main (settings validation), the renderer (picker + rig) and scripts/sync-characters.mjs
// (which reads this file directly, so keep it plain data: no imports, no enums).
//
// 'uncle' is the built-in procedural Uncle (src/renderer/common/uncle). Every other character is
// two SVG files in src/renderer/characters/<id>/{idle,eat}.svg plus a 128 px thumb.png, copied from
// docs/art/characters/<art>.svg and <art>-eat.svg by `node scripts/sync-characters.mjs`.
// Swapping a character's art later is a file copy (or re-running the sync script).

export interface CharacterInfo {
  id: string
  name: string
  /** One-line description shown under the name in the picker. */
  blurb: string
  /** docs/art/characters/<art>.svg (idle) and <art>-eat.svg; null = the built-in Uncle. */
  art: string | null
  /** Scale of the art inside the Uncle's viewBox (face origin (0, 0) in both). */
  scale: number
}

export const CHARACTERS = [
  { id: 'uncle', name: 'The Uncle', blurb: 'The original. Glasses, moustache, gold tooth.', art: null, scale: 1 },
  { id: 'motu-uncle', name: 'Motu Uncle', blurb: 'The Uncle, after a very good lunch.', art: '00-motu-uncle', scale: 0.9 },
  { id: 'chacha-gappu', name: 'Chacha Gappu', blurb: 'Retired, with the morning paper and cutting chai.', art: '01-chacha-gappu', scale: 0.92 },
  { id: 'dadi-amma', name: 'Dadi Amma', blurb: 'Cat-eye glasses and a whistling cooker.', art: '02-dadi-amma', scale: 0.9 },
  { id: 'halwai-bhaiya', name: 'Halwai Bhaiya', blurb: 'Holds up a jalebi like a trophy.', art: '03-halwai-bhaiya', scale: 0.92 },
  { id: 'auto-wala-uncle', name: 'Auto-wala Uncle', blurb: 'Handlebar moustache, the meter is running.', art: '04-auto-wala-uncle', scale: 0.9 },
  { id: 'great-uncle-nickels', name: 'Great-Uncle Nickels', blurb: 'Bites every coin to check it is real.', art: '05-great-uncle-nickels', scale: 0.9 },
  { id: 'sumo-san', name: 'Sumo-san', blurb: 'A gentle giant. "Itadakimasu!"', art: '06-sumo-san', scale: 0.9 },
  { id: 'nonna-pina', name: 'Nonna Pina', blurb: 'Rolls your file flat like pasta dough.', art: '07-nonna-pina', scale: 0.92 },
  { id: 'pehlwan-pappu', name: 'Pehlwan Pappu', blurb: 'Akhada wrestler with a tall glass of milk.', art: '09-pehlwan-pappu', scale: 0.92 }
] as const satisfies readonly CharacterInfo[]

export type CharacterId = (typeof CHARACTERS)[number]['id']

export const CHARACTER_IDS: readonly CharacterId[] = CHARACTERS.map((c) => c.id)

export const DEFAULT_CHARACTER: CharacterId = 'uncle'

export function isCharacterId(x: unknown): x is CharacterId {
  return typeof x === 'string' && (CHARACTER_IDS as readonly string[]).includes(x)
}

export function characterInfo(id: CharacterId): CharacterInfo {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0]
}
