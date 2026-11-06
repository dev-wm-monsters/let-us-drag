// Crash report scrubbing (TPM D28, privacy). Pure: no electron, no Sentry import (unit tested).
//
// Website promise: files never leave the computer. A crash report must therefore never carry a
// user's file name or folder, their user name (home directory), the licence key, the install ID,
// settings, logs or job inputs/outputs. Everything that leaves main goes through `scrubEvent`
// (beforeSend) and again through `filterEnvelope` (the transport), so even data that reached the
// main SDK by another route (renderer scope / envelope IPC) is cleaned before it is sent.
//
// Rules for every string:
//   1. file:// URLs are decoded to paths first, then treated like paths;
//   2. paths inside the app (app.getAppPath(), process.resourcesPath) become `app:///<relative>`
//      (our own code: kept, so stack traces stay useful);
//   3. a quoted string that starts with a path, or is a user file name, is replaced as a whole
//      (paths and names with spaces or apostrophes); a decoded file:// URL likewise;
//   4. the home directory becomes `~` and anything under it `~/<path>`;
//   5. any other absolute path (POSIX, Windows drive, UNC) becomes `<path>`;
//   6. a remaining word that ends in a user file extension (photo.png, Grüße.HEIC) becomes `<file>`;
//   7. licence-key / UUID-like tokens become `<id>`.
// Then whole events are reduced to an allow-list of fields (see scrubEvent).

import { EXTENSIONS } from '../../shared/catalog'
import { ALLOWED_TAG_KEYS } from './config'

export interface ScrubContext {
  /** Our app's own directories (app.getAppPath(), process.resourcesPath). Paths inside → `app:///…`. */
  appRoots: readonly string[]
  /** The user's home directory (os.homedir()). */
  homeDir: string
}

export const PATH_PLACEHOLDER = '<path>'
export const HOME_PLACEHOLDER = '~'
export const FILE_PLACEHOLDER = '<file>'
export const ID_PLACEHOLDER = '<id>'

/** User file extensions whose names are stripped (the catalog's, plus common ones; never .js/.ts). */
const USER_EXTENSIONS: readonly string[] = [
  ...Object.values(EXTENSIONS)
    .flat()
    .filter((e) => e !== 'com' && e !== 'app'),
  'doc', 'xls', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'pages', 'numbers', 'key', 'epub', 'svg', 'psd', 'ai',
  'raw', 'cr2', 'nef', 'dng', 'arw', 'jfif', 'mpg', 'mpeg', 'wmv', 'flv', '3gp', 'mts', 'm2ts', 'wma', 'aif', 'aiff',
  'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'eml', 'msg', 'vcf', 'ics', 'tsv', 'xml', 'sqlite', 'db', 'log', 'onnx'
]

const SEGMENT = String.raw`[^\s\\/'"\x60<>|*?:;,()\[\]{}]+`
const SEP = String.raw`(?:\\{1,2}|/)`
const EXT_ALT = [...new Set(USER_EXTENSIONS)].sort((a, b) => b.length - a.length).join('|')
/** The rest of a path after its first separator: segments, spaces allowed inside non-final ones. */
const TAIL = String.raw`(?:${SEGMENT}(?: ${SEGMENT})*(?=${SEP})${SEP})*(?:${SEGMENT}(?: ${SEGMENT})*?\.(?:${EXT_ALT})(?![\w])|${SEGMENT})?`

const FILE_URL_RE = /\bfile:\/\/(?:[^\s'"\x60<>()]|'(?=[\w%]))*/gi
/**
 * A quoted string: the opening quote is not preceded by a letter or digit and the closing one is not
 * followed by one, so an apostrophe inside a word (Can't, Mom's Wedding, O'Brien) neither opens nor
 * closes a quote and a quoted path with an apostrophe in a folder name is still replaced as a whole.
 */
const QUOTED_RE = /(?<![\p{L}\p{N}_])(['"\x60])([^\n]{1,2048}?)\1(?![\p{L}\p{N}_])/gu
const PATH_START_RE = new RegExp(String.raw`^(?:~(?:${SEP}|$)|/|[A-Za-z]:${SEP}|\\\\)`)
const UNC_RE = new RegExp(String.raw`(?<![\w:\\/])(?:\\\\{1,2}|//)${SEGMENT}${SEP}${TAIL}`, 'g')
const DRIVE_RE = new RegExp(String.raw`(?<![\w])[A-Za-z]:${SEP}${TAIL}`, 'g')
const POSIX_RE = new RegExp(String.raw`(?<![\w.:/\\~<>@-])/(?=[^\s/\\])${TAIL}`, 'g')
const TILDE_RE = new RegExp(String.raw`(?<![\w])~${SEP}(?=[^\s<\\/])${TAIL}`, 'g')
/** A whole quoted string that is a user file name (it may contain spaces): "Holiday Photo 2024.png". */
const QUOTED_FILE_NAME_RE = new RegExp(String.raw`^(?!app:///)[^\n]*\.(?:${EXT_ALT})$`, 'i')
/** Group 1: one of our app:/// paths (kept); otherwise a bare user file name. */
const FILE_NAME_RE = new RegExp(String.raw`(app:///[^\s'"\x60<>()]*)|(?<![\w.<>-])${SEGMENT}\.(?:${EXT_ALT})(?![\w])`, 'gi')
/** Licence keys (dash-separated alphanumeric groups with a digit) and UUIDs, e.g. ABCD-1234-EFGH-5678. */
const KEY_RE = /\b(?=[A-Za-z0-9-]*\d)[A-Za-z0-9]{4,}(?:-[A-Za-z0-9]{4,}){2,}\b/g

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The ways a directory may be written in a string: as is, with / or \ or \\ separators. */
function spellings(dir: string): string[] {
  const trimmed = dir.replace(/[\\/]+$/, '')
  if (trimmed.length < 2) return []
  const parts = trimmed.split(/[\\/]+/)
  return [...new Set([trimmed, parts.join('/'), parts.join('\\'), parts.join('\\\\')])].sort((a, b) => b.length - a.length)
}

/** Regex matching `dir` (any spelling, case-insensitive) followed by an optional path tail. */
function rootRe(dir: string): RegExp | null {
  const sp = spellings(dir)
  if (sp.length === 0) return null
  return new RegExp(String.raw`(?:${sp.map(escapeRe).join('|')})(?=$|[\\/\s'"\x60:)\],;])((?:${SEP}${TAIL})?)`, 'gi')
}

function decodeFileUrl(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return PATH_PLACEHOLDER
  }
  let path: string
  try {
    path = decodeURIComponent(u.pathname)
  } catch {
    path = u.pathname
  }
  if (u.host !== '') return `//${u.host}${path}` // file://server/share → UNC
  // file:///C:/x → C:/x
  return /^\/[A-Za-z]:[\\/]/.test(path) ? path.slice(1) : path
}

interface CompiledContext {
  appRes: RegExp[]
  homeRe: RegExp | null
}

const compiled = new WeakMap<ScrubContext, CompiledContext>()

function compile(ctx: ScrubContext): CompiledContext {
  let c = compiled.get(ctx)
  if (!c) {
    const roots = [...ctx.appRoots].filter((r) => r.replace(/[\\/]+$/, '').length >= 2).sort((a, b) => b.length - a.length)
    c = { appRes: roots.map(rootRe).filter((r): r is RegExp => r !== null), homeRe: rootRe(ctx.homeDir) }
    compiled.set(ctx, c)
  }
  return c
}

function scrubPaths(s: string, c: CompiledContext): string {
  let out = s
  for (const re of c.appRes) out = out.replace(re, (_m, rest: string) => `app://${rest.replace(/\\+/g, '/') || '/'}`)
  // A quoted path is replaced as a whole (it may contain spaces). Quoted app:// paths are ours.
  out = out.replace(QUOTED_RE, (m, q: string, inner: string) => {
    if (PATH_START_RE.test(inner) || (c.homeRe && startsWithRoot(inner, c.homeRe))) return `${q}${placeholderFor(inner, c)}${q}`
    if (QUOTED_FILE_NAME_RE.test(inner)) return `${q}${FILE_PLACEHOLDER}${q}`
    return m
  })
  if (c.homeRe) out = out.replace(c.homeRe, (_m, rest: string) => (rest ? `${HOME_PLACEHOLDER}/${PATH_PLACEHOLDER}` : HOME_PLACEHOLDER))
  out = out.replace(TILDE_RE, `${HOME_PLACEHOLDER}/${PATH_PLACEHOLDER}`)
  out = out.replace(UNC_RE, PATH_PLACEHOLDER)
  out = out.replace(DRIVE_RE, PATH_PLACEHOLDER)
  out = out.replace(POSIX_RE, PATH_PLACEHOLDER)
  return out
}

function startsWithRoot(s: string, re: RegExp): boolean {
  re.lastIndex = 0
  const m = re.exec(s)
  re.lastIndex = 0
  return m !== null && m.index === 0
}

function placeholderFor(path: string, c: CompiledContext): string {
  if (c.homeRe && startsWithRoot(path, c.homeRe)) {
    const rest = path.replace(c.homeRe, '$1')
    return rest ? `${HOME_PLACEHOLDER}/${PATH_PLACEHOLDER}` : HOME_PLACEHOLDER
  }
  if (/^~(?:[\\/]|$)/.test(path)) return path.length > 1 ? `${HOME_PLACEHOLDER}/${PATH_PLACEHOLDER}` : HOME_PLACEHOLDER
  return PATH_PLACEHOLDER
}

function scrubFileUrl(url: string, c: CompiledContext): string {
  const path = decodeFileUrl(url)
  if (path === PATH_PLACEHOLDER) return path
  // Our own files (stack frames of renderer bundles): app:///<relative>, as for plain paths.
  if (c.appRes.some((re) => startsWithRoot(path, re))) return scrubPaths(path, c)
  return placeholderFor(path, c)
}

/** Scrub one string (see the rules at the top of this file). */
export function scrubText(input: string, ctx: ScrubContext): string {
  if (input === '') return input
  const c = compile(ctx)
  // A decoded file:// URL is replaced as a whole: decoding may add spaces (%20) that would otherwise
  // end the path early and leave the rest of a folder name in the text.
  let out = input.replace(FILE_URL_RE, (url) => scrubFileUrl(url, c))
  out = scrubPaths(out, c)
  out = out.replace(FILE_NAME_RE, (m, own: string | undefined) => own ?? FILE_PLACEHOLDER)
  out = out.replace(KEY_RE, ID_PLACEHOLDER)
  return out
}

/** Keys whose values are protocol identifiers (never user data) and must stay as they are. */
const KEEP_AS_IS = new Set([
  'event_id',
  'trace_id',
  'span_id',
  'parent_span_id',
  'debug_id',
  'replay_id',
  'profile_id',
  'sid',
  'timestamp',
  'start_timestamp',
  'release',
  'environment',
  'level',
  'platform',
  'type'
])

const MAX_DEPTH = 12

/** Deep copy of a JSON-like value with every string (and object key) scrubbed. */
export function scrubValue(value: unknown, ctx: ScrubContext, depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value, ctx)
  if (value === null || typeof value !== 'object') return value
  if (depth >= MAX_DEPTH) return '[…]'
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, ctx, depth + 1))
  if (value instanceof Uint8Array) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined || typeof v === 'function') continue
    out[scrubText(k, ctx)] = KEEP_AS_IS.has(k) && typeof v === 'string' ? v : scrubValue(v, ctx, depth + 1)
  }
  return out
}

/** Contexts we send, and their fields (`*` = all fields, scrubbed). Everything else is dropped. */
const CONTEXT_FIELDS: Readonly<Record<string, readonly string[] | '*'>> = {
  os: ['name', 'version', 'build', 'kernel_version'],
  runtime: ['name', 'version'],
  app: ['app_name', 'app_version', 'build_type', 'app_arch'],
  device: ['arch', 'family'],
  browser: ['name', 'version'],
  chrome: ['name', 'version', 'type'],
  node: ['name', 'version', 'type'],
  electron: '*',
  trace: '*'
}

/** Top-level event fields we send. Everything else (request, user, extra, modules, server_name…) is dropped. */
const EVENT_FIELDS = new Set([
  'event_id',
  'timestamp',
  'start_timestamp',
  'level',
  'platform',
  'logger',
  'release',
  'dist',
  'environment',
  'message',
  'logentry',
  'exception',
  'threads',
  'stacktrace',
  'breadcrumbs',
  'tags',
  'contexts',
  'fingerprint',
  'sdk',
  'debug_meta',
  'type',
  'transaction'
])

export interface EventLike {
  [key: string]: unknown
}

export interface BreadcrumbLike {
  category?: string
  type?: string
  [key: string]: unknown
}

/** Breadcrumbs we never send: console output may contain anything; http/fetch would name hosts. */
const DROPPED_BREADCRUMB_CATEGORIES = new Set(['console', 'fetch', 'xhr', 'http', 'electron.net', 'navigation', 'ui.click', 'ui.input'])

export function scrubBreadcrumb<T extends BreadcrumbLike>(crumb: T, ctx: ScrubContext): T | null {
  if (crumb.category && DROPPED_BREADCRUMB_CATEGORIES.has(crumb.category)) return null
  if (crumb.type === 'http') return null
  return scrubValue(crumb, ctx) as T
}

function pick(obj: unknown, fields: readonly string[] | '*'): Record<string, unknown> | null {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null
  if (fields === '*') return obj as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const f of fields) if ((obj as Record<string, unknown>)[f] !== undefined) out[f] = (obj as Record<string, unknown>)[f]
  return out
}

function stripFrameVars(exception: unknown): void {
  const values = (exception as { values?: unknown[] } | undefined)?.values
  if (!Array.isArray(values)) return
  for (const ex of values) {
    const frames = (ex as { stacktrace?: { frames?: Record<string, unknown>[] } }).stacktrace?.frames
    if (!Array.isArray(frames)) continue
    for (const f of frames) {
      delete f['vars']
      delete f['pre_context']
      delete f['context_line']
      delete f['post_context']
    }
  }
}

/**
 * The event as it may leave the computer: allow-listed fields, tags and contexts only, no user /
 * request / extra / attachments-by-scope, every string scrubbed, `user.ip_address: null`.
 */
export function scrubEvent<T extends EventLike>(event: T, ctx: ScrubContext): T {
  const out: EventLike = {}
  for (const [k, v] of Object.entries(event)) if (EVENT_FIELDS.has(k) && v !== undefined) out[k] = v
  if (out['tags'] && typeof out['tags'] === 'object') {
    const tags: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(out['tags'] as Record<string, unknown>)) {
      if (ALLOWED_TAG_KEYS.has(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) tags[k] = String(v).slice(0, 200)
    }
    out['tags'] = tags
  }
  if (out['contexts'] && typeof out['contexts'] === 'object') {
    const contexts: Record<string, unknown> = {}
    for (const [name, fields] of Object.entries(CONTEXT_FIELDS)) {
      const picked = pick((out['contexts'] as Record<string, unknown>)[name], fields)
      if (picked && Object.keys(picked).length > 0) contexts[name] = picked
    }
    out['contexts'] = contexts
  }
  if (Array.isArray(out['breadcrumbs'])) {
    out['breadcrumbs'] = (out['breadcrumbs'] as BreadcrumbLike[]).filter((b) => b && typeof b === 'object' && scrubBreadcrumb(b, ctx) !== null)
  }
  const scrubbed = scrubValue(out, ctx) as EventLike
  stripFrameVars(scrubbed['exception'])
  scrubbed['user'] = { ip_address: null }
  return scrubbed as T
}

/**
 * Envelope item types that may be sent: events only. Nothing else (no sessions, spans, logs, and no
 * native crash dumps: a minidump is raw process memory that may hold file names and cannot be
 * scrubbed, so native crashes are reported as a small "process gone" event instead, see sdk.ts).
 */
export function allowedEnvelopeItem(headers: { type?: unknown; attachment_type?: unknown }): boolean {
  return headers.type === 'event'
}
