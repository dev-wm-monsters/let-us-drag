// Every resource limit of the engine in one place (docs/security/CHECKLIST.md SEC-41).
// Limits protect the engine process (memory, disk, time) from hostile or accidental huge inputs.
// Hitting a limit is reported as INPUT_INVALID with a friendly message (never a crash).
import type { Category } from '../shared/types'

const MB = 1024 * 1024
const GB = 1024 * MB

/**
 * Max input file size per category. Media is streamed by ffmpeg and archives are streamed by
 * yauzl/yazl, so they have no byte limit here (time is bounded by JOB_TIMEOUT_MS). Formats whose
 * parsers need the whole file in memory (PDF, DOCX, XLSX, text, data, HEIC) are capped.
 */
export const MAX_INPUT_BYTES: Readonly<Record<Category, number>> = {
  image: 1 * GB, // sharp/libvips reads from the file path (no full JS copy), HEIC has its own cap
  video: Number.POSITIVE_INFINITY,
  audio: Number.POSITIVE_INFINITY,
  pdf: 512 * MB,
  document: 128 * MB,
  text: 64 * MB,
  data: 128 * MB,
  archive: Number.POSITIVE_INFINITY,
  blocked: 0,
  unknown: Number.POSITIVE_INFINITY // only reachable through "zip", which streams
}

/** HEIC/HEIF (HEVC) is decoded by heic-decode (wasm) from an in-memory copy of the file. */
export const MAX_HEIC_BYTES = 256 * MB

/** BMP / ICO inputs are decoded by ffmpeg into an in-memory PNG. */
export const MAX_FFMPEG_IMAGE_BYTES = 256 * MB

/** sharp/libvips: max decoded pixels per image (width × height). 0x3FFF² ≈ 268 MP. */
export const MAX_INPUT_PIXELS = 268_402_689

/** PDF: pages rasterised per job and the largest embedded image pdf.js decodes (pixels). */
export const MAX_PDF_PAGES = 1000
export const MAX_PDF_IMAGE_PIXELS = 100_000_000

/** Unzip (SEC-103). */
export const MAX_ZIP_ENTRIES = 10_000
export const MAX_ZIP_TOTAL_BYTES = 2 * GB
/** A single entry is refused when it expands by more than this factor... */
export const MAX_ZIP_ENTRY_RATIO = 200
/** ...and is larger than this (small, very compressible files such as empty logs stay fine). */
export const ZIP_RATIO_MIN_BYTES = 32 * MB
/** Keep this much disk space free after unpacking. */
export const ZIP_FREE_DISK_MARGIN = 256 * MB

/** ZIP creation (SEC-106). */
export const MAX_ZIP_CREATE_ENTRIES = 50_000
export const MAX_ZIP_CREATE_BYTES = 16 * GB

/** DOCX / XLSX are ZIP containers read fully into memory (mammoth/exceljs via JSZip) (SEC-91). */
export const MAX_OOXML_ENTRIES = 10_000
export const MAX_OOXML_TOTAL_BYTES = 512 * MB

/** HTML handed to the htmlToPdf adapter (Chromium printToPDF). */
export const MAX_HTML_BYTES = 32 * MB

/** YAML: aliases per document (SEC-90), nesting depth, nodes after alias expansion. */
export const YAML_MAX_ALIASES = 100
export const YAML_MAX_DEPTH = 200
export const MAX_EXPANDED_NODES = 2_000_000

/** Per-job wall-clock timeout. */
export const JOB_TIMEOUT_MS = 30 * 60 * 1000

/** User-facing JobError.message length cap, and the detail (logs only) cap (SEC-44). */
export const MAX_MESSAGE_CHARS = 200
export const MAX_DETAIL_CHARS = 4096

/** Remove-BG model download: time to response headers, and max silence while streaming. */
export const MODEL_CONNECT_TIMEOUT_MS = 30_000
export const MODEL_STALL_TIMEOUT_MS = 60_000

export function formatBytes(n: number): string {
  if (n >= GB) return `${Math.round((n / GB) * 10) / 10} GB`
  return `${Math.round(n / MB)} MB`
}
