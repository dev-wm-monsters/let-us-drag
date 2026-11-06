// Crash reporting configuration (TPM D28). Pure: no electron, no Sentry import (unit tested).
//
// SENTRY_DSN is a build-time setting (electron-vite `define`, like DODO_ENV): a DSN is public by
// design (it only allows sending events to one project), so it ships in the app. Empty → crash
// reporting is compiled out of the decision entirely (`crashReportingMode` says disabled).

import { REPORT_PROBLEM_EMAIL } from '../../shared/crash'

/** Default DSN: org wakeup-monster, project lets-drag. */
export const DEFAULT_SENTRY_DSN = 'https://a2dd68eda7b45b6b81a8592402434940@o4512383055626240.ingest.us.sentry.io/4512383176867840'

/** userData flag file: on the next launch of a packaged build, send ONE test event, then delete the file. */
export const SENTRY_TEST_FLAG_FILE = 'sentry-test.flag'

/** In-memory session used only by the crash transport (restricted to the DSN's ingest origin). */
export const CRASH_SESSION_PARTITION = 'lud-crash'

export interface ParsedDsn {
  /** e.g. https://o123.ingest.us.sentry.io */
  origin: string
  publicKey: string
  projectId: string
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * A DSN we accept: `https://<key>@<host>/<project>` (or http on a loopback host, for the E2E mock).
 * Anything else → null (crash reporting stays off).
 */
export function parseDsn(raw: unknown): ParsedDsn | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  const loopback = LOOPBACK_HOSTS.has(u.hostname)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) return null
  if (!/^[0-9a-f]{16,64}$/i.test(u.username) || u.password !== '') return null
  const projectId = u.pathname.replace(/^\/+|\/+$/g, '')
  if (!/^\d{1,20}$/.test(projectId) || u.search !== '' || u.hash !== '') return null
  return { origin: u.origin, publicKey: u.username, projectId }
}

/** The DSN this build was made with (`__SENTRY_DSN__`; absent under vitest → the default). */
export function buildSentryDsn(): string {
  return typeof __SENTRY_DSN__ === 'string' ? __SENTRY_DSN__.trim() : DEFAULT_SENTRY_DSN
}

export type CrashEnvironment = 'production' | 'development' | 'e2e'

export type CrashReportingMode =
  | { enabled: false; reason: 'no-dsn' | 'unpackaged' }
  | { enabled: true; dsn: string; origin: string; environment: CrashEnvironment }

/**
 * Is crash reporting possible in this run at all? (The user's `crashReports` setting is checked
 * separately, live.)
 * - packaged build with a valid DSN → yes (environment `production`);
 * - unpackaged: never by default (dev, E2E: no noise). Two explicit switches, both ignored by a
 *   packaged build (D12 pattern):
 *   - `LUD_E2E=1` + `LUD_E2E_SENTRY_URL=http://127.0.0.1:<port>`: a loopback mock ingest server
 *     (any other host is refused), environment `e2e`;
 *   - `LUD_SENTRY_DEV=1` (not E2E): the build DSN, environment `development`, for
 *     "Send test crash report (development)".
 */
export function crashReportingMode(input: {
  isPackaged: boolean
  e2e: boolean
  env: Readonly<Record<string, string | undefined>>
  buildDsn: string
}): CrashReportingMode {
  const { isPackaged, e2e, env, buildDsn } = input
  if (!isPackaged && e2e) {
    const mock = e2eSentryDsn(env['LUD_E2E_SENTRY_URL'])
    if (!mock) return { enabled: false, reason: 'unpackaged' }
    return { enabled: true, dsn: mock, origin: parseDsn(mock)!.origin, environment: 'e2e' }
  }
  const parsed = parseDsn(buildDsn)
  if (!parsed) return { enabled: false, reason: 'no-dsn' }
  if (isPackaged) return { enabled: true, dsn: buildDsn.trim(), origin: parsed.origin, environment: 'production' }
  if (env['LUD_SENTRY_DEV'] === '1') return { enabled: true, dsn: buildDsn.trim(), origin: parsed.origin, environment: 'development' }
  return { enabled: false, reason: 'unpackaged' }
}

/** E2E only: a DSN pointing at the loopback mock ingest server (`http://127.0.0.1:<port>`), or null. */
export function e2eSentryDsn(raw: string | undefined): string | null {
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' || !LOOPBACK_HOSTS.has(u.hostname) || u.port === '') return null
  return `http://${'e2e0'.repeat(8)}@${u.host}/1`
}

export function releaseName(version: string): string {
  return `lets-drag@${version}`
}

/** `team` for builds made with LUD_LICENSING=off, else `user`. */
export function buildChannel(licensingEnabled: boolean): 'team' | 'user' {
  return licensingEnabled ? 'user' : 'team'
}

export interface CrashTagInput {
  version: string
  platform: string
  arch: string
  character: string
  licensingEnabled: boolean
  dodoEnv: string
}

/** The only tags we set (D28). The process type tag (`event.process`) is set by the SDK. */
export function crashTags(i: CrashTagInput): Record<string, string> {
  return {
    'app.version': i.version,
    os: i.platform,
    arch: i.arch,
    character: i.character,
    channel: buildChannel(i.licensingEnabled),
    dodo_env: i.dodoEnv
  }
}

/** Tag keys allowed on an outgoing event (ours + the SDK's process / crash kind tags). */
export const ALLOWED_TAG_KEYS: ReadonlySet<string> = new Set([
  'app.version',
  'os',
  'arch',
  'character',
  'channel',
  'dodo_env',
  'event.process',
  'event.environment',
  'exit.reason'
])

/**
 * Should an event be sent right now? All three must hold: reporting is possible in this run, the
 * user has `crashReports` on, and the event is not a test event in a run that forbids it.
 */
export function shouldSend(mode: CrashReportingMode, consent: boolean): boolean {
  return mode.enabled && consent
}

/** "Report a problem": `mailto:` with the app version and OS prefilled (no logs, no paths). */
export function reportProblemUrl(i: { version: string; platform: string; osRelease: string; arch: string }): string {
  const os = `${osDisplayName(i.platform)} ${i.osRelease.replace(/[^\w.-]/g, '').slice(0, 32)} (${i.arch.replace(/[^\w]/g, '').slice(0, 16)})`
  const subject = `Let's Drag! ${i.version}: problem report`
  const body = [
    'What happened?',
    '',
    '',
    'What did you expect?',
    '',
    '',
    '---',
    `App version: ${i.version}`,
    `OS: ${os}`
  ].join('\n')
  // encodeURIComponent, not URLSearchParams: mail clients expect %20, not "+".
  return `mailto:${REPORT_PROBLEM_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export function osDisplayName(platform: string): string {
  switch (platform) {
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return platform.replace(/[^\w]/g, '').slice(0, 16)
  }
}
