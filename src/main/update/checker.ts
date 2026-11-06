// Fetch the update manifest (TPM D29). Pure Node (fetch injected; app.ts passes the restricted
// update session's fetch); no electron import.
//
// Privacy: one plain GET of the manifest URL. No query string, no body, no cookies, no IDs; the only
// headers are Accept and the generic User-Agent `LetsDrag/<version>` the session sets.
// Any failure (offline, timeout, redirect, non-2xx, too big, bad JSON, invalid manifest) is reported
// as such and changes nothing: the caller keeps the previous state.

import { MAX_MANIFEST_CHARS, parseManifestText, type UpdateManifest } from './manifest'

export type UpdateFetchLike = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; signal: AbortSignal; redirect: 'error' }
) => Promise<{ status: number; ok: boolean; headers?: { get(name: string): string | null }; text(): Promise<string> }>

export type FetchOutcome =
  | { kind: 'ok'; manifest: UpdateManifest }
  | { kind: 'error'; reason: 'network' | 'timeout' | 'http' | 'too-big' | 'invalid'; status?: number }

export async function fetchManifest(fetchImpl: UpdateFetchLike, url: string, timeoutMs: number): Promise<FetchOutcome> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  timer.unref?.()
  try {
    let res: Awaited<ReturnType<UpdateFetchLike>>
    try {
      res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: ctl.signal, redirect: 'error' })
    } catch {
      return { kind: 'error', reason: ctl.signal.aborted ? 'timeout' : 'network' }
    }
    if (!res.ok) return { kind: 'error', reason: 'http', status: res.status }
    const length = Number(res.headers?.get('content-length') ?? NaN)
    if (Number.isFinite(length) && length > MAX_MANIFEST_CHARS) return { kind: 'error', reason: 'too-big' }
    let text: string
    try {
      text = await res.text()
    } catch {
      return { kind: 'error', reason: ctl.signal.aborted ? 'timeout' : 'network' }
    }
    if (text.length > MAX_MANIFEST_CHARS) return { kind: 'error', reason: 'too-big' }
    const manifest = parseManifestText(text)
    return manifest ? { kind: 'ok', manifest } : { kind: 'error', reason: 'invalid' }
  } finally {
    clearTimeout(timer)
  }
}
