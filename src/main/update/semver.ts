// A tiny semantic-version comparator (semver.org 2.0 precedence) for update notices (TPM D29).
// Pure; unit tested. Accepts an optional leading "v" and ignores build metadata ("+…").

export interface SemVer {
  major: number
  minor: number
  patch: number
  /** Pre-release identifiers ("beta.8" → ['beta', 8]); empty for a release. */
  pre: (string | number)[]
}

const MAX_LENGTH = 64
const RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function num(s: string): number | null {
  // No leading zeros (semver.org rule 2); stays exact.
  if (s.length > 1 && s.startsWith('0')) return null
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : null
}

export function parseSemver(raw: unknown): SemVer | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (s.length === 0 || s.length > MAX_LENGTH) return null
  const m = RE.exec(s)
  if (!m) return null
  const major = num(m[1]!)
  const minor = num(m[2]!)
  const patch = num(m[3]!)
  if (major === null || minor === null || patch === null) return null
  const pre: (string | number)[] = []
  if (m[4]) {
    for (const id of m[4].split('.')) {
      if (/^\d+$/.test(id)) {
        const n = num(id)
        if (n === null) return null
        pre.push(n)
      } else {
        pre.push(id)
      }
    }
  }
  return { major, minor, patch, pre }
}

export function isSemver(raw: unknown): raw is string {
  return parseSemver(raw) !== null
}

function cmp(a: number | string, b: number | string): -1 | 0 | 1 {
  // Numeric identifiers sort before alphanumeric ones; numbers numerically, strings in ASCII order.
  if (typeof a === 'number' && typeof b === 'string') return -1
  if (typeof a === 'string' && typeof b === 'number') return 1
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/** -1 when a < b, 0 when equal in precedence, 1 when a > b. */
export function compareSemver(a: SemVer, b: SemVer): -1 | 0 | 1 {
  for (const k of ['major', 'minor', 'patch'] as const) {
    const c = cmp(a[k], b[k])
    if (c !== 0) return c
  }
  // A release ranks above any of its pre-releases (1.0.0-beta < 1.0.0).
  if (a.pre.length === 0 && b.pre.length === 0) return 0
  if (a.pre.length === 0) return 1
  if (b.pre.length === 0) return -1
  const n = Math.max(a.pre.length, b.pre.length)
  for (let i = 0; i < n; i++) {
    const x = a.pre[i]
    const y = b.pre[i]
    // A shorter list of equal identifiers ranks lower (1.0.0-alpha < 1.0.0-alpha.1).
    if (x === undefined) return -1
    if (y === undefined) return 1
    const c = cmp(x, y)
    if (c !== 0) return c
  }
  return 0
}

/** Compare two version strings; null when either does not parse. */
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1 | null {
  const x = parseSemver(a)
  const y = parseSemver(b)
  if (!x || !y) return null
  return compareSemver(x, y)
}

/** Canonical text form ("v1.2.3+build" → "1.2.3"). */
export function formatSemver(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}${v.pre.length ? `-${v.pre.join('.')}` : ''}`
}
