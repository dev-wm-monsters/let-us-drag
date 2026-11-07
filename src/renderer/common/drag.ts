// Pure helpers around HTML5 drag data (DOM types are only used structurally so this runs in node tests).
import { categoryForExt, categoryForMime, combinedCategory, extForMime, OPTIONS, optionsFor } from '../../shared/catalog'
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

/**
 * Category for a pre-drop probe. Empty or unknown MIME types (SVG, many documents) and mixed
 * selections → 'unknown'; any blocked type → 'blocked'.
 */
export function categoryForProbe(probe: DragProbe): Category {
  if (probe.mimeTypes.length === 0) return 'unknown'
  return combinedCategory(probe.mimeTypes.map(categoryForMime), false)
}

/**
 * Options for a pre-drop probe (extensions are not known yet, D31):
 * - every MIME type known and of one category → that category's options;
 * - unknown, partly unknown (some empty MIME types) or mixed → ZIP, which works for any set of
 *   non-blocked files. What else would be valid for all of them cannot be told before the drop
 *   (an empty MIME type may be anything); a drop on the mouth then offers the real options;
 * - blocked (exe…) anywhere in the selection → nothing (he refuses).
 */
export function optionsForProbe(probe: DragProbe): ConversionOption[] {
  const cat = categoryForProbe(probe)
  if (cat === 'blocked') return []
  const options = cat === 'unknown' ? [OPTIONS.zip] : optionsFor({ categories: [cat], exts: probeExts(probe), count: Math.max(1, probe.count), hasDirectory: false })
  return devOverride ? devOverride(options, 'probe') : options
}

/**
 * Extensions told by the drag's MIME types (catalog extForMime), only when every one is unambiguous:
 * then the drag already hides no-op options and shows extension-only ones (D30: GIF → MP4, CSV / XLSX
 * → PDF), like the ring after the drop. Otherwise none (category options only).
 */
export function probeExts(probe: DragProbe): string[] {
  const exts = probe.mimeTypes.map(extForMime)
  return exts.length > 0 && exts.every((e) => e !== '') ? exts : []
}

/**
 * The drag shows a guess (ZIP), not the real options: the file types could not be told, or do not
 * agree, during the drag (D31). He then says "Feed me, or ZIP it!".
 */
export function probeIsGuess(probe: DragProbe): boolean {
  return categoryForProbe(probe) === 'unknown'
}

type OptionsOverride = (options: ConversionOption[], phase: 'probe' | 'items') => ConversionOption[]
let devOverride: OptionsOverride | null = null

/**
 * Visual harness only (src/renderer/dev): replace the offered options, e.g. with a long list to show
 * the paged ring before the catalog has that many (D31). Never called by the app.
 */
export function setDevOptionsOverride(fn: OptionsOverride | null): void {
  devOverride = fn
}

export function categoryForItem(item: DroppedItem): Category {
  return item.isDirectory ? 'unknown' : categoryForExt(item.ext)
}

/** Options for real dropped items (after describePaths). */
export function optionsForItems(items: readonly DroppedItem[]): ConversionOption[] {
  const options = optionsFor({
    categories: items.map(categoryForItem),
    exts: items.filter((i) => !i.isDirectory).map((i) => i.ext),
    count: items.length,
    hasDirectory: items.some((i) => i.isDirectory)
  })
  return devOverride && options.length > 0 ? devOverride(options, 'items') : options
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
