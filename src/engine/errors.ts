// Engine errors: every failure is mapped to a JobErrorCode with a friendly, user-safe message.
import type { JobError, JobErrorCode } from '../shared/types'
import { MAX_DETAIL_CHARS, MAX_MESSAGE_CHARS } from './limits'

export const FRIENDLY_MESSAGES: Readonly<Record<JobErrorCode, string>> = {
  UNSUPPORTED: "The Uncle can't do that with this file.",
  INPUT_NOT_FOUND: "I can't find that file anymore. Was it moved or deleted?",
  INPUT_INVALID: "This file looks damaged, or it isn't what its name says.",
  OUTPUT_NOT_WRITABLE: "I can't save next to the original. That folder doesn't let me write.",
  TOOL_MISSING: 'A helper tool is missing. Reinstalling Let us drag! should fix it.',
  TOOL_FAILED: 'Something went wrong while converting this file.',
  MODEL_DOWNLOAD_FAILED:
    "I couldn't download the background-removal model. Check your internet connection and try again.",
  CANCELLED: 'Cancelled.',
  INTERNAL: 'Oops, something unexpected happened.'
}

/** An error that already knows its JobErrorCode and user-facing message. */
export class EngineError extends Error {
  readonly code: JobErrorCode
  readonly detail?: string

  constructor(code: JobErrorCode, message?: string, detail?: string) {
    super(message ?? FRIENDLY_MESSAGES[code])
    this.name = 'EngineError'
    this.code = code
    if (detail !== undefined) this.detail = detail
  }
}

function errnoCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const c = (err as { code: unknown }).code
    return typeof c === 'string' ? c : undefined
  }
  return undefined
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** One line, at most `max` characters (an ellipsis marks the cut). */
export function clampText(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= max ? one : `${one.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/** Shorten a file name for messages, keeping its start and its extension: "very-long…name.png". */
export function shortName(name: string, max = 48): string {
  if (name.length <= max) return name
  const keepEnd = Math.min(12, Math.floor(max / 3))
  return `${name.slice(0, max - keepEnd - 1)}…${name.slice(-keepEnd)}`
}

/**
 * Map any thrown value to a JobError (never leaks stack traces into `message`). The message is a
 * single line of at most 200 characters; `detail` (logs only) is capped at 4 KB.
 */
export function toJobError(err: unknown): JobError {
  const e = rawJobError(err)
  const out: JobError = { code: e.code, message: clampText(e.message, MAX_MESSAGE_CHARS) || FRIENDLY_MESSAGES[e.code] }
  if (e.detail !== undefined) out.detail = e.detail.length > MAX_DETAIL_CHARS ? `${e.detail.slice(0, MAX_DETAIL_CHARS - 1)}…` : e.detail
  return out
}

/**
 * Prefix an error's user-facing message with the name of the file it is about (batch jobs,
 * TPM decision D7). CANCELLED stays as it is.
 */
export function aboutFile(err: unknown, fileName: string): unknown {
  const e = err instanceof EngineError ? err : undefined
  const job = e ?? (isAbortError(err) ? undefined : rawJobError(err))
  if (!job || job.code === 'CANCELLED') return err
  const named = new EngineError(job.code, `${shortName(fileName)}: ${job.message}`, job.detail)
  return named
}

function rawJobError(err: unknown): JobError {
  if (err instanceof EngineError) {
    const out: JobError = { code: err.code, message: err.message }
    if (err.detail !== undefined) out.detail = err.detail
    return out
  }
  if (isAbortError(err)) return { code: 'CANCELLED', message: FRIENDLY_MESSAGES.CANCELLED }
  const code = errnoCode(err)
  if (code === 'ENOENT') {
    return { code: 'INPUT_NOT_FOUND', message: FRIENDLY_MESSAGES.INPUT_NOT_FOUND, detail: errMessage(err) }
  }
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return { code: 'OUTPUT_NOT_WRITABLE', message: FRIENDLY_MESSAGES.OUTPUT_NOT_WRITABLE, detail: errMessage(err) }
  }
  if (code === 'ENOSPC') {
    return { code: 'OUTPUT_NOT_WRITABLE', message: 'The disk is full, so I could not save the result.', detail: errMessage(err) }
  }
  return { code: 'INTERNAL', message: FRIENDLY_MESSAGES.INTERNAL, detail: errMessage(err) }
}

export function isAbortError(err: unknown): boolean {
  if (err instanceof EngineError) return err.code === 'CANCELLED'
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
}

/** Throw a CANCELLED EngineError when the signal is aborted. */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw cancelledOrTimeout(signal)
}

/** Convert an aborted signal's reason into the right EngineError (timeout vs user cancel). */
export function cancelledOrTimeout(signal: AbortSignal): EngineError {
  const reason: unknown = signal.reason
  if (reason instanceof EngineError) return reason
  return new EngineError('CANCELLED')
}

/** Wrap a library failure on bad input as INPUT_INVALID with a friendly message. */
export function invalidInput(message: string, cause?: unknown): EngineError {
  return new EngineError('INPUT_INVALID', message, cause === undefined ? undefined : errMessage(cause))
}

export { errMessage, errnoCode }
