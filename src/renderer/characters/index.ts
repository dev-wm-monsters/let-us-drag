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

/** Art for a drawn character; null for the built-in Uncle (or if the files are missing). */
export function characterArt(id: CharacterId): CharacterArt | null {
  const info = characterInfo(id)
  if (info.art === null) return null
  const idle = svgs[`./${id}/idle.svg`]
  const eat = svgs[`./${id}/eat.svg`]
  if (!idle || !eat) return null
  return { id, idle, eat, scale: info.scale }
}

export function characterThumb(id: CharacterId): string | undefined {
  return thumbs[`./${id}/thumb.png`]
}

export { CHARACTERS }
