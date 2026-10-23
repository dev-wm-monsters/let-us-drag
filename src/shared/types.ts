// Shared domain types. Imported by main, preload, renderer and engine.
// Contract owner: TPM. Additive changes are fine; renames/removals need sign-off (docs/PLAN.md §4).
import { type CharacterId, DEFAULT_CHARACTER } from './characters'

export type { CharacterId } from './characters'

export type Category =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'text'
  | 'data'
  | 'archive'
  | 'blocked'
  | 'unknown'

export type OptionId =
  | 'to-png'
  | 'to-jpg'
  | 'to-webp'
  | 'to-avif'
  | 'to-pdf'
  | 'to-ico'
  | 'remove-bg'
  | 'compress'
  | 'to-mp4'
  | 'to-mov'
  | 'to-webm'
  | 'to-gif'
  | 'to-mp3'
  | 'to-wav'
  | 'to-m4a'
  | 'to-ogg'
  | 'to-flac'
  | 'pdf-to-png'
  | 'pdf-to-jpg'
  | 'to-txt'
  | 'pdf-merge'
  | 'to-html'
  | 'to-md'
  | 'to-docx'
  | 'to-csv'
  | 'to-json'
  | 'to-yaml'
  | 'to-xlsx'
  | 'unzip'
  | 'zip'

export interface ConversionOption {
  id: OptionId
  /** Label shown on the option bubble, e.g. "PNG", "Remove BG". Max ~10 chars. */
  label: string
  /** Short hint shown when hovering, e.g. "Convert to PNG image". */
  hint: string
  /** 'each' = one output per input, 'merge' = one output for all inputs. */
  batch: 'each' | 'merge'
  /** Minimum number of inputs required (e.g. pdf-merge needs 2). */
  minInputs: number
}

/** What the renderer knows about the drag before the drop (MIME types only). */
export interface DragProbe {
  mimeTypes: string[]
  count: number
}

/** What we know after the drop (real paths). */
export interface DroppedItem {
  path: string
  name: string
  ext: string // lower-case, without dot; '' for folders / no extension
  isDirectory: boolean
  sizeBytes: number
}

export interface JobRequest {
  id: string
  optionId: OptionId
  inputPaths: string[]
}

export type JobErrorCode =
  | 'UNSUPPORTED'
  | 'INPUT_NOT_FOUND'
  | 'INPUT_INVALID'
  | 'OUTPUT_NOT_WRITABLE'
  | 'TOOL_MISSING'
  | 'TOOL_FAILED'
  | 'MODEL_DOWNLOAD_FAILED'
  | 'CANCELLED'
  | 'INTERNAL'

export interface JobError {
  code: JobErrorCode
  /** Human-friendly message, safe to show to the user. */
  message: string
  /** Technical details for logs only. */
  detail?: string
}

export type JobEvent =
  | { type: 'queued'; jobId: string }
  | { type: 'progress'; jobId: string; progress: number /* 0..1, or -1 if unknown */; stage?: string }
  | { type: 'done'; jobId: string; outputPaths: string[] }
  | { type: 'error'; jobId: string; error: JobError }

export type TriggerKey = 'shift' | 'alt' | 'ctrl' | 'meta'

export interface Settings {
  triggerKey: TriggerKey
  sounds: boolean
  /** Instant gulp: no minimum chew duration. */
  hungryMode: boolean
  /** No character, just a plain ring of options. */
  plainMode: boolean
  launchAtLogin: boolean
  firstRunDone: boolean
  /** Which character appears (see src/shared/characters.ts). */
  character: CharacterId
}

export const DEFAULT_SETTINGS: Settings = {
  triggerKey: 'shift',
  sounds: true,
  hungryMode: false,
  plainMode: false,
  launchAtLogin: false,
  firstRunDone: false,
  character: DEFAULT_CHARACTER
}

/** Platform capability report shown in settings / used to pick fallbacks. */
export interface PlatformStatus {
  platform: 'darwin' | 'win32' | 'linux'
  /** Global drag gesture available (false on Wayland or when macOS permission is missing). */
  gestureAvailable: boolean
  gestureUnavailableReason?: 'wayland' | 'mac-permission' | 'hook-failed'
  accessibilityTrusted?: boolean
}
