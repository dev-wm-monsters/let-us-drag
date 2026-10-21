// Pure helpers around HTML5 drag data (DOM types are only used structurally so this runs in node tests).
import { categoryForExt, categoryForMime, combinedCategory, optionsFor } from '../../shared/catalog'
import type { Category, ConversionOption, DragProbe, DroppedItem } from '../../shared/types'

/** True when the drag carries files from the OS (and not text/links/window drags). */
export function isFileDrag(types: ArrayLike<string> | null | undefined): boolean {
  if (!types) return false
  for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true
  return false
}

interface ItemLike {
  kind: string
  type: string
}

/** Build a probe from `dataTransfer.items` (only MIME types are readable during dragover). */
export function probeFromItems(items: ArrayLike<ItemLike> | null | undefined): DragProbe {
  const mimeTypes: string[] = []
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it && it.kind === 'file') mimeTypes.push(it.type ?? '')
    }
  }
  return { mimeTypes, count: mimeTypes.length }
}

/** Category for a pre-drop probe. Empty or unknown MIME types → 'unknown' (feedMe). */
export function categoryForProbe(probe: DragProbe): Category {
  if (probe.mimeTypes.length === 0) return 'unknown'
  return combinedCategory(probe.mimeTypes.map(categoryForMime), false)
}

/** Options for a pre-drop probe (extensions are not known yet). */
export function optionsForProbe(probe: DragProbe): ConversionOption[] {
  const cat = categoryForProbe(probe)
  if (cat === 'unknown' || cat === 'blocked') return []
  return optionsFor({ categories: [cat], exts: [], count: Math.max(1, probe.count), hasDirectory: false })
}

export function categoryForItem(item: DroppedItem): Category {
  return item.isDirectory ? 'unknown' : categoryForExt(item.ext)
}

/** Options for real dropped items (after describePaths). */
export function optionsForItems(items: readonly DroppedItem[]): ConversionOption[] {
  return optionsFor({
    categories: items.map(categoryForItem),
    exts: items.filter((i) => !i.isDirectory).map((i) => i.ext),
    count: items.length,
    hasDirectory: items.some((i) => i.isDirectory)
  })
}

export function itemsAreBlocked(items: readonly DroppedItem[]): boolean {
  return items.some((i) => !i.isDirectory && categoryForExt(i.ext) === 'blocked')
}

export const HAMSTER_MIN_FILES = 3
export const STRUGGLE_MIN_BYTES = 200 * 1024 * 1024

export function isHamster(count: number): boolean {
  return count >= HAMSTER_MIN_FILES
}

export function isStruggle(items: readonly DroppedItem[]): boolean {
  return items.some((i) => i.sizeBytes > STRUGGLE_MIN_BYTES)
}
