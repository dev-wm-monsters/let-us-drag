/// <reference types="vite/client" />
// Renderer registry of character art: src/renderer/characters/<id>/{idle,eat}.svg + thumb.png.
// The SVGs are imported through the build-time sanitiser (scripts/lib/character-svg.mjs, the
// `?character` query), so a plain file copy of new art is enough to swap a character.
import { CHARACTERS, type CharacterId, characterInfo } from '../../shared/characters'

const svgs = import.meta.glob<string>('./*/{idle,eat}.svg', { query: '?character', import: 'default', eager: true })
const thumbs = import.meta.glob<string>('./*/thumb.png', { query: '?url', import: 'default', eager: true })

export interface CharacterArt {
  id: CharacterId
  /** Sanitised idle (mouth closed) and eat (mouth open) drawings. */
  idle: string
  eat: string
  scale: number
}

const artCache = new Map<CharacterId, CharacterArt | null>()

/**
 * Art for a drawn character; null for the built-in Uncle (or if the files are missing). The same
 * object every call: the rig restarts (fresh brain, rebinding) whenever it gets a new one.
 */
export function characterArt(id: CharacterId): CharacterArt | null {
  if (artCache.has(id)) return artCache.get(id) ?? null
  const info = characterInfo(id)
  const idle = svgs[`./${id}/idle.svg`]
  const eat = svgs[`./${id}/eat.svg`]
  const art = info.art !== null && idle && eat ? { id, idle, eat, scale: info.scale } : null
  artCache.set(id, art)
  return art
}

export function characterThumb(id: CharacterId): string | undefined {
  return thumbs[`./${id}/thumb.png`]
}

export { CHARACTERS }
