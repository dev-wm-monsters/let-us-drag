// Conversion catalog: categories, extensions, MIME mapping and options per category.
// Pure data + pure functions so the renderer can decide instantly during dragover and the
// engine can validate requests. Source of truth for docs/PLAN.md §5.

import type { Category, ConversionOption, OptionId } from './types'

export const EXTENSIONS: Record<Exclude<Category, 'unknown'>, readonly string[]> = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'tif', 'tiff', 'bmp', 'ico', 'heic', 'heif'],
  video: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac'],
  pdf: ['pdf'],
  document: ['docx'],
  text: ['md', 'markdown', 'txt', 'html', 'htm'],
  data: ['csv', 'json', 'yaml', 'yml', 'xlsx'],
  archive: ['zip'],
  blocked: ['exe', 'msi', 'app', 'dmg', 'pkg', 'bat', 'cmd', 'sh', 'com', 'scr', 'dll']
}

const EXT_TO_CATEGORY: ReadonlyMap<string, Category> = new Map(
  (Object.entries(EXTENSIONS) as [Category, readonly string[]][]).flatMap(([cat, exts]) =>
    exts.map((e) => [e, cat] as const)
  )
)

export function normalizeExt(ext: string): string {
  return ext.replace(/^\./, '').toLowerCase()
}

export function categoryForExt(ext: string): Category {
  return EXT_TO_CATEGORY.get(normalizeExt(ext)) ?? 'unknown'
}

/**
 * Best-effort category from a MIME type reported by Chromium during dragover.
 * Returns 'unknown' when the MIME type is empty or not specific enough.
 */
export function categoryForMime(mime: string): Category {
  const m = mime.toLowerCase().trim()
  if (!m) return 'unknown'
  if (m === 'application/pdf') return 'pdf'
  if (m === 'image/svg+xml') return 'unknown'
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'document'
  if (m === 'text/markdown' || m === 'text/plain' || m === 'text/html') return 'text'
  if (
    m === 'text/csv' ||
    m === 'application/json' ||
    m === 'application/yaml' ||
    m === 'application/x-yaml' ||
    m === 'text/yaml' ||
    m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
    return 'data'
  if (m === 'application/zip' || m === 'application/x-zip-compressed') return 'archive'
  if (
    m === 'application/x-msdownload' ||
    m === 'application/x-msdos-program' ||
    m === 'application/x-apple-diskimage' ||
    m === 'application/x-sh'
  )
    return 'blocked'
  return 'unknown'
}

const O = (
  id: OptionId,
  label: string,
  hint: string,
  batch: 'each' | 'merge' = 'each',
  minInputs = 1
): ConversionOption => ({ id, label, hint, batch, minInputs })

export const OPTIONS: Record<OptionId, ConversionOption> = {
  'to-png': O('to-png', 'PNG', 'Convert to PNG'),
  'to-jpg': O('to-jpg', 'JPG', 'Convert to JPG'),
  'to-webp': O('to-webp', 'WEBP', 'Convert to WEBP'),
  'to-avif': O('to-avif', 'AVIF', 'Convert to AVIF'),
  'to-pdf': O('to-pdf', 'PDF', 'Make a PDF', 'merge'),
  'to-ico': O('to-ico', 'ICO', 'Make an icon (.ico)'),
  'remove-bg': O('remove-bg', 'Remove BG', 'Remove the background (first use downloads a 179 MB AI model, once)'),
  compress: O('compress', 'Compress', 'Make it smaller'),
  'to-mp4': O('to-mp4', 'MP4', 'Convert to MP4'),
  'to-mov': O('to-mov', 'MOV', 'Convert to MOV'),
  'to-webm': O('to-webm', 'WEBM', 'Convert to WEBM'),
  'to-gif': O('to-gif', 'GIF', 'Make a GIF'),
  'to-mp3': O('to-mp3', 'MP3', 'Convert to MP3'),
  'to-wav': O('to-wav', 'WAV', 'Convert to WAV'),
  'to-m4a': O('to-m4a', 'M4A', 'Convert to M4A'),
  'to-ogg': O('to-ogg', 'OGG', 'Convert to OGG'),
  'to-flac': O('to-flac', 'FLAC', 'Convert to FLAC'),
  'pdf-to-png': O('pdf-to-png', 'PNG', 'Pages to PNG images'),
  'pdf-to-jpg': O('pdf-to-jpg', 'JPG', 'Pages to JPG images'),
  'to-txt': O('to-txt', 'TXT', 'Extract plain text'),
  'pdf-merge': O('pdf-merge', 'Merge', 'Merge PDFs into one', 'merge', 2),
  'to-html': O('to-html', 'HTML', 'Convert to HTML'),
  'to-md': O('to-md', 'Markdown', 'Convert to Markdown'),
  'to-docx': O('to-docx', 'DOCX', 'Convert to Word'),
  'to-csv': O('to-csv', 'CSV', 'Convert to CSV'),
  'to-json': O('to-json', 'JSON', 'Convert to JSON'),
  'to-yaml': O('to-yaml', 'YAML', 'Convert to YAML'),
  'to-xlsx': O('to-xlsx', 'XLSX', 'Convert to Excel'),
  unzip: O('unzip', 'Unzip', 'Extract the archive'),
  zip: O('zip', 'ZIP', 'Pack into a .zip', 'merge')
}

/** Options per category, in display order (max 8). */
export const CATEGORY_OPTIONS: Record<Category, readonly OptionId[]> = {
  image: ['to-png', 'to-jpg', 'to-webp', 'to-avif', 'to-pdf', 'to-ico', 'remove-bg', 'compress'],
  video: ['to-mp4', 'to-mov', 'to-webm', 'to-gif', 'to-mp3', 'to-wav', 'compress'],
  audio: ['to-mp3', 'to-wav', 'to-m4a', 'to-ogg', 'to-flac', 'compress'],
  pdf: ['pdf-to-png', 'pdf-to-jpg', 'to-txt', 'pdf-merge'],
  document: ['to-pdf', 'to-html', 'to-md', 'to-txt'],
  text: ['to-pdf', 'to-html', 'to-docx', 'to-txt'],
  data: ['to-csv', 'to-json', 'to-yaml', 'to-xlsx'],
  archive: ['unzip'],
  blocked: [],
  unknown: ['zip']
}

/** Output extension produced by an option for a given input extension (used to hide no-op options). */
const OPTION_TARGET_EXT: Partial<Record<OptionId, readonly string[]>> = {
  'to-png': ['png'],
  'to-jpg': ['jpg', 'jpeg'],
  'to-webp': ['webp'],
  'to-avif': ['avif'],
  'to-ico': ['ico'],
  'to-mp4': ['mp4'],
  'to-mov': ['mov'],
  'to-webm': ['webm'],
  'to-gif': ['gif'],
  'to-mp3': ['mp3'],
  'to-wav': ['wav'],
  'to-m4a': ['m4a'],
  'to-ogg': ['ogg', 'oga'],
  'to-flac': ['flac'],
  'to-txt': ['txt'],
  'to-html': ['html', 'htm'],
  'to-md': ['md', 'markdown'],
  'to-csv': ['csv'],
  'to-json': ['json'],
  'to-yaml': ['yaml', 'yml'],
  'to-xlsx': ['xlsx']
}

export interface OptionQuery {
  categories: Category[]
  /** Known input extensions (after drop). Empty during dragover. */
  exts: string[]
  count: number
  hasDirectory: boolean
}

/** The category that a set of inputs maps to (mixed → 'unknown', which offers ZIP). */
export function combinedCategory(categories: Category[], hasDirectory: boolean): Category {
  if (hasDirectory || categories.length === 0) return 'unknown'
  if (categories.includes('blocked')) return 'blocked'
  const first = categories[0]!
  return categories.every((c) => c === first) ? first : 'unknown'
}

/** Options to show for a set of inputs. Never returns options that would be a no-op. */
export function optionsFor(q: OptionQuery): ConversionOption[] {
  const cat = combinedCategory(q.categories, q.hasDirectory)
  const exts = q.exts.map(normalizeExt)
  const ids = CATEGORY_OPTIONS[cat].filter((id) => {
    const opt = OPTIONS[id]
    if (q.count < opt.minInputs) return false
    const targets = OPTION_TARGET_EXT[id]
    // Hide "convert to X" when every input is already X.
    if (targets && exts.length > 0 && exts.every((e) => targets.includes(e))) return false
    return true
  })
  // ZIP is always available for any known non-blocked set except archives (Unzip instead).
  if (cat !== 'unknown' && cat !== 'blocked' && cat !== 'archive' && ids.length < 8 && !ids.includes('zip')) {
    ids.push('zip')
  }
  return ids.map((id) => OPTIONS[id])
}
