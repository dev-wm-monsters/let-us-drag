// Pure helpers used by the E2E specs (unit-tested in tests/e2e/helpers.spec.ts).
import { basename, dirname, extname, join } from 'node:path'

/**
 * Expected output path for a single-output conversion, per PLAN §3.7:
 * next to the source, same base name, new extension; on collision "name (1).ext", "name (2).ext"…
 * `existing` lists names already present in the source folder (case-sensitive comparison).
 */
export function expectedOutputPath(inputPath: string, outExt: string, existing: readonly string[] = []): string {
  const dir = dirname(inputPath)
  const base = basename(inputPath, extname(inputPath))
  const taken = new Set(existing)
  let candidate = `${base}.${outExt}`
  for (let n = 1; taken.has(candidate); n++) candidate = `${base} (${n}).${outExt}`
  return join(dir, candidate)
}

/** True when `needle` appears in `haystack` in order (not necessarily contiguous). */
export function isSubsequence(needle: readonly string[], haystack: readonly string[]): boolean {
  let i = 0
  for (const item of haystack) {
    if (i < needle.length && item === needle[i]) i++
  }
  return i === needle.length
}

/** Collapse consecutive duplicates: [a,a,b,a] → [a,b,a]. */
export function dedupeConsecutive(items: readonly string[]): string[] {
  const out: string[] = []
  for (const item of items) if (out[out.length - 1] !== item) out.push(item)
  return out
}

/** Make a string safe for use as a screenshot file name on every OS. */
export function safeFileStem(s: string): string {
  const cleaned = s
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned.slice(0, 80) || 'unnamed'
}

/**
 * How long the first run of `state` lasted in a recorded timeline (ms), i.e. from its first sample
 * to the next sample with a different state. null if the state never appeared or never ended.
 */
export function firstStateDuration(timeline: readonly { state: string; t: number }[], state: string): number | null {
  const start = timeline.findIndex((s) => s.state === state)
  if (start < 0) return null
  const end = timeline.findIndex((s, i) => i > start && s.state !== state)
  if (end < 0) return null
  return timeline[end]!.t - timeline[start]!.t
}
