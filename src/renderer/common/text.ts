// User-facing strings and small formatting helpers (pure).
import type { JobError, JobErrorCode } from '../../shared/types'

const FRIENDLY: Record<JobErrorCode, string> = {
  UNSUPPORTED: "I can't cook that one, sorry.",
  INPUT_NOT_FOUND: 'Hey, that file wandered off before I could eat it.',
  INPUT_INVALID: 'Blegh! That file seems broken.',
  OUTPUT_NOT_WRITABLE: "I couldn't put the result next to the original (no write access).",
  TOOL_MISSING: 'Some of my kitchen tools are missing. Try reinstalling the app.',
  TOOL_FAILED: 'Something went down the wrong pipe. The conversion failed.',
  MODEL_DOWNLOAD_FAILED: "I couldn't fetch my background-removal recipe. Check your connection.",
  CANCELLED: 'Okay, I spat it out. Nothing was changed.',
  INTERNAL: 'Oops, I got a hiccup. Please try again.'
}

/** The engine caps `JobError.message` at this many characters (src/engine/limits.ts MAX_MESSAGE_CHARS). */
export const MAX_ENGINE_MESSAGE_CHARS = 200

/** Prefer the engine's human message (contract: safe to show); fall back to our per-code text. */
export function friendlyError(error: Pick<JobError, 'code' | 'message'> | null | undefined): string {
  if (!error) return FRIENDLY.INTERNAL
  const msg = typeof error.message === 'string' ? error.message.trim() : ''
  if (msg && msg.length <= MAX_ENGINE_MESSAGE_CHARS) return msg
  return FRIENDLY[error.code] ?? FRIENDLY.INTERNAL
}

/** Engine stage text while the Remove BG model is downloaded once (src/engine/jobs.ts MODEL_DOWNLOAD_STAGE, D10/D15). */
export const MODEL_DOWNLOAD_STAGE = 'One-time download of my scissors (179 MB AI model)'
/** Share of the first file's progress the engine gives to that download (src/engine/jobs.ts: `p * 0.4`). */
export const MODEL_DOWNLOAD_SHARE = 0.4
const MAX_STAGE_CHARS = 80

/**
 * Caption under the progress ring while chewing (D15, QA3-02): the engine's stage text, plus the
 * download percentage during the one-time model download. `progress` is the job's overall 0..1
 * (-1 unknown); the download happens while the first of `itemCount` files is processed.
 */
export function stageCaption(stage: string | null | undefined, progress: number, itemCount: number): string | null {
  let text = typeof stage === 'string' ? stage.replace(/\s+/g, ' ').trim() : ''
  if (!text) return null
  if (text.length > MAX_STAGE_CHARS) text = text.slice(0, MAX_STAGE_CHARS - 1).trimEnd() + '…'
  if (text === MODEL_DOWNLOAD_STAGE) {
    if (!Number.isFinite(progress) || progress < 0) return text
    const pct = Math.floor((progress * Math.max(1, itemCount) * 100) / MODEL_DOWNLOAD_SHARE + 1e-6)
    return `${text} · ${Math.max(0, Math.min(100, pct))}%`
  }
  return /[.!?…)]$/.test(text) ? text : `${text}…`
}

export const LINES = {
  feedMe: 'Feed me!',
  pickOne: 'Pick one!',
  refuse: 'Nope, not eating that.',
  saved: 'Saved next to original',
  idleFeed: 'Drop a file on me!',
  noPaths: "Hmm, I couldn't get hold of that file.",
  nothingToDo: "I don't know how to cook that.",
  cancelled: 'Fine, keep it.',
  cancelHint: 'Spit it out'
} as const

/** Cross-platform basename (handles / and \). */
export function baseName(p: string): string {
  const s = p.replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i >= 0 ? s.slice(i + 1) : s
}

/** Middle-ellipsis for long file names, keeping the extension visible. */
export function shortName(name: string, max = 28): string {
  if (name.length <= max) return name
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : ''
  const keep = max - ext.length - 1
  const head = Math.ceil(keep * 0.6)
  const tail = keep - head
  const stem = name.slice(0, name.length - ext.length)
  return stem.slice(0, head) + '…' + (tail > 0 ? stem.slice(-tail) : '') + ext
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let u = 0
  let v = n
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${u === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${units[u]}`
}
