// macOS only: runs the lud-modifiers helper (native/mac-modifiers/main.swift) while a left-button
// drag is in progress and turns its output into modifier snapshots for trigger-logic.
//
// Why: during a Finder file drag our CGEventTap (uiohook) gets the press and the first moves, then
// nothing until the release, so a trigger key pressed mid-drag is never seen. The helper polls
// CGEventSource.flagsState(.combinedSessionState) every ~30 ms and prints
// `shift=0|1 ctrl=0|1 alt=0|1 meta=0|1` once at start and on every change; it exits when its
// stdin closes, so it never outlives us.
//
// Privacy: the helper reports the four modifier flags and nothing else. This file logs only
// helper lifecycle (start/stop/exit/missing), never the flags; trigger.ts logs the trigger key's
// transitions as usual (describeTriggerTransition).
//
// At most one helper runs. A missing or broken binary never throws: it is logged once and the
// trigger keeps working as before (key pressed before the drag still arms).

import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { ModifierFlags } from './trigger-logic'

/** Name of the helper binary in resources/bin (electron-builder extraResources). */
export const MODIFIER_HELPER_NAME = 'lud-modifiers'

/** Longest partial line kept while waiting for a newline (real lines are 31 chars). */
const MAX_PENDING_CHARS = 256

const LINE_RE = /^shift=([01]) ctrl=([01]) alt=([01]) meta=([01])$/

/** Parse one helper line; null for anything that is not exactly the expected format. */
export function parseModifierLine(line: string): ModifierFlags | null {
  const m = LINE_RE.exec(line.replace(/\r$/, ''))
  if (!m) return null
  return { shift: m[1] === '1', ctrl: m[2] === '1', alt: m[3] === '1', meta: m[4] === '1' }
}

/** The subset of ChildProcess the probe uses (a fake in tests). */
export interface ProbeChild {
  readonly stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null
  readonly stdin: { end(): void; on(event: 'error', listener: (err: Error) => void): unknown } | null
  kill(): boolean
  on(event: 'error', listener: (err: Error) => void): unknown
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
}

export interface ModifierProbeDeps {
  /** Absolute path of the helper binary. */
  helperPath: string
  /** Called with every valid snapshot from the current helper. */
  onModifiers(modifiers: ModifierFlags): void
  /** Spawns the helper (default: child_process.spawn, no shell, piped stdin/stdout). */
  spawn?: (file: string) => ProbeChild
  exists?: (path: string) => boolean
  /** Field diagnostics logger (lifecycle only). */
  debug?: (message: string) => void
}

function defaultSpawn(file: string): ProbeChild {
  return nodeSpawn(file, [], { shell: false, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
}

export interface ModifierProbeLike {
  start(): void
  stop(): void
}

export class ModifierProbe implements ModifierProbeLike {
  private child: ProbeChild | null = null
  private missingLogged = false
  private errorLogged = false

  constructor(private readonly deps: ModifierProbeDeps) {}

  get isRunning(): boolean {
    return this.child !== null
  }

  /** Start the helper unless one is already running. Never throws. */
  start(): void {
    if (this.child) return
    const exists = this.deps.exists ?? existsSync
    if (!exists(this.deps.helperPath)) {
      if (!this.missingLogged) {
        this.missingLogged = true
        this.deps.debug?.(`modifier helper not found (${this.deps.helperPath}); mid-drag trigger key detection off`)
      }
      return
    }
    let child: ProbeChild
    try {
      child = (this.deps.spawn ?? defaultSpawn)(this.deps.helperPath)
    } catch (err) {
      this.logErrorOnce(err)
      return
    }
    this.child = child
    let pending = ''
    child.on('error', (err) => {
      this.logErrorOnce(err)
      if (this.child === child) this.child = null
    })
    child.on('exit', (code, signal) => {
      if (this.child !== child) return // stopped by us
      this.child = null
      this.deps.debug?.(`modifier helper exited (code ${code ?? 'none'}${signal ? `, ${signal}` : ''})`)
    })
    child.stdin?.on('error', () => undefined) // EPIPE when the helper is already gone
    child.stdout?.on('data', (chunk) => {
      if (this.child !== child) return
      pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      if (pending.length > MAX_PENDING_CHARS) pending = ''
      for (const line of lines) {
        const m = parseModifierLine(line)
        if (m && this.child === child) this.deps.onModifiers(m)
      }
    })
    this.deps.debug?.('modifier helper started')
  }

  /** Stop the helper if one is running. Never throws. */
  stop(): void {
    const child = this.child
    if (!child) return
    this.child = null
    try {
      child.stdin?.end()
    } catch {
      // already closed
    }
    try {
      child.kill()
    } catch {
      // already gone
    }
    this.deps.debug?.('modifier helper stopped')
  }

  private logErrorOnce(err: unknown): void {
    if (this.errorLogged) return
    this.errorLogged = true
    this.deps.debug?.(`modifier helper failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
