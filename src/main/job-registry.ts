// Remembers what jobs produced (for revealPath) and, in E2E mode, every JobEvent (for test hooks).
// Pure (no electron import).

import { normalize, resolve } from 'node:path'
import type { JobEvent } from '../shared/types'

export const MAX_RECORDED_EVENTS = 10_000
export const MAX_REVEALABLE_PATHS = 5_000

function key(p: string): string {
  const n = normalize(resolve(p))
  return process.platform === 'win32' || process.platform === 'darwin' ? n.toLowerCase() : n
}

export class JobRegistry {
  private readonly events: JobEvent[] = []
  private readonly outputs = new Set<string>()

  constructor(private readonly recordEvents: boolean) {}

  record(event: JobEvent): void {
    if (this.recordEvents) {
      this.events.push(event)
      if (this.events.length > MAX_RECORDED_EVENTS) this.events.splice(0, this.events.length - MAX_RECORDED_EVENTS)
    }
    if (event.type === 'done') {
      for (const p of event.outputPaths) {
        this.outputs.add(key(p))
        if (this.outputs.size > MAX_REVEALABLE_PATHS) {
          const oldest = this.outputs.values().next().value
          if (oldest !== undefined) this.outputs.delete(oldest)
        }
      }
    }
  }

  /** Only paths produced by a finished job may be revealed in the file manager. */
  isRevealable(p: string): boolean {
    return this.outputs.has(key(p))
  }

  recordedEvents(): JobEvent[] {
    return this.events.map((e) => structuredClone(e))
  }
}
