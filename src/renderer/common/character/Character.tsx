// The selected character: the built-in procedural Uncle, or a drawn character (SVG art + generic rig).
// Same props as the Uncle, same viewBox and anchor points, so the Stage lays out every character alike.
import { characterArt } from '../../characters'
import type { CharacterId } from '../../../shared/characters'
import { Uncle, type UncleProps } from '../uncle/Uncle'
import { DrawnCharacter } from './DrawnCharacter'

export function Character({ id, ...props }: UncleProps & { id: CharacterId }) {
  const art = characterArt(id)
  // key: switching characters remounts the rig (fresh brain, fresh bindings).
  return art ? <DrawnCharacter key={id} art={art} {...props} /> : <Uncle key="uncle" {...props} />
}
