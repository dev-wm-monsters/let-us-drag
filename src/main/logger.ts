// Diagnostics: silent in production; printed to stderr in development or with LUD_DEBUG=1.
// Field diagnostics (LUD_DEBUG=1 or userData/debug.flag, see README "Field diagnostics"): every
// line is timestamped and also appended to <logs>/debug.log.

import { createWriteStream, mkdirSync, renameSync, statSync, type WriteStream } from 'node:fs'
import { dirname } from 'node:path'

export function createLogger(enabled: boolean): (message: string) => void {
  if (!enabled) return () => undefined
  return (message: string) => {
    process.stderr.write(`[lud] ${message}\n`)
  }
}

/** debug.log is moved to debug.old.log at startup once it is larger than this. */
export const DEBUG_LOG_MAX_BYTES = 5 * 1024 * 1024
/** Lines kept until the file is attached (main can only ask for the logs path once ready). */
const PENDING_MAX = 1000

export interface DebugLogger {
  (message: string): void
  /** Start appending to `path` (lines logged before are written first). Never throws. */
  attachFile(path: string): void
}

export function formatDebugLine(message: string, now: Date = new Date()): string {
  return `[lud ${now.toISOString()}] ${message.replace(/[\r\n]+/g, ' ')}\n`
}

export function createDebugLogger(): DebugLogger {
  let stream: WriteStream | null = null
  let pending: string[] | null = []
  const write = (line: string): void => {
    try {
      process.stderr.write(line)
    } catch {
      // no console (GUI launch): the file still gets it
    }
    if (stream) stream.write(line)
    else if (pending && pending.length < PENDING_MAX) pending.push(line)
  }
  const logger = ((message: string) => write(formatDebugLine(message))) as DebugLogger
  logger.attachFile = (path: string) => {
    if (stream) return
    try {
      mkdirSync(dirname(path), { recursive: true })
      try {
        if (statSync(path).size > DEBUG_LOG_MAX_BYTES) renameSync(path, path.replace(/\.log$/, '.old.log'))
      } catch {
        // no previous file
      }
      const s = createWriteStream(path, { flags: 'a' })
      s.on('error', (err) => {
        stream = null
        process.stderr.write(formatDebugLine(`debug.log write failed: ${String(err)}`))
      })
      stream = s
      for (const line of pending ?? []) s.write(line)
      pending = null
    } catch (err) {
      pending = null
      write(formatDebugLine(`cannot open ${path}: ${String(err)}`))
    }
  }
  return logger
}
