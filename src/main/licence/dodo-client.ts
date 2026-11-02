// Minimal client for Dodo Payments' three PUBLIC licence endpoints (no API key; TPM D26).
// Pure Node (global fetch, injectable for tests); no electron import.
//
// Contract (docs.dodopayments.com, checked 2026-11 via search; see docs/TPM_DECISIONS.md D26):
//   POST /licenses/activate   { license_key, name }                       → 200 instance { id: "lki_…", product?: { product_id } … }
//                                                                           403 key not active · 404 not found · 422 activation limit
//   POST /licenses/validate   { license_key, license_key_instance_id? }   → 200 { valid: boolean }
//   POST /licenses/deactivate { license_key, license_key_instance_id }    → 200 · 403 instance not of this key · 404 not found
// Error bodies are JSON { code, message } (message may be null); we only use the HTTP status.
//
// Privacy (website promise): a request body only ever carries the licence key, the activation
// instance ID and the device label. No other headers or fields are added.

export type DodoCall<T> =
  | { kind: 'ok'; data: T }
  /** Dodo answered with a non-2xx status. `code` is Dodo's error code when the body had one. */
  | { kind: 'http'; status: number; code: string | null }
  /** No usable answer: offline, DNS, TLS, timeout, captive portal / non-JSON 2xx body. */
  | { kind: 'network'; reason: string }

export interface ActivateData {
  instanceId: string
  /** Product the key belongs to, when Dodo says so. */
  productId: string | null
}

export interface ValidateData {
  valid: boolean
  productId: string | null
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: 'error' }) => Promise<{
  status: number
  ok: boolean
  text(): Promise<string>
}>

export interface DodoClientOptions {
  baseUrl: string
  fetchImpl?: FetchLike
  /** Per request; default 15 s. */
  timeoutMs?: number
}

export const DEFAULT_TIMEOUT_MS = 15_000
const MAX_BODY_CHARS = 64 * 1024

function errorCodeOf(text: string): string | null {
  try {
    const j = JSON.parse(text) as unknown
    if (j && typeof j === 'object' && typeof (j as { code?: unknown }).code === 'string') return (j as { code: string }).code.slice(0, 80)
  } catch {
    // not JSON
  }
  return null
}

function productIdOf(j: Record<string, unknown>): string | null {
  const p = j['product']
  if (p && typeof p === 'object' && typeof (p as { product_id?: unknown }).product_id === 'string') return (p as { product_id: string }).product_id
  if (typeof j['product_id'] === 'string') return j['product_id']
  return null
}

export class DodoClient {
  private readonly fetchImpl: FetchLike
  private readonly timeoutMs: number
  readonly baseUrl: string

  constructor(opts: DodoClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  activate(licenseKey: string, name: string): Promise<DodoCall<ActivateData>> {
    return this.post('/licenses/activate', { license_key: licenseKey, name }, (j) => {
      const id = j['id']
      if (typeof id !== 'string' || id.length === 0 || id.length > 200) return null
      return { instanceId: id, productId: productIdOf(j) }
    })
  }

  validate(licenseKey: string, instanceId: string | null): Promise<DodoCall<ValidateData>> {
    const body: Record<string, string> = { license_key: licenseKey }
    if (instanceId) body['license_key_instance_id'] = instanceId
    return this.post('/licenses/validate', body, (j) => {
      if (typeof j['valid'] !== 'boolean') return null
      return { valid: j['valid'], productId: productIdOf(j) }
    })
  }

  deactivate(licenseKey: string, instanceId: string): Promise<DodoCall<true>> {
    return this.post('/licenses/deactivate', { license_key: licenseKey, license_key_instance_id: instanceId }, () => true as const, true)
  }

  private async post<T>(
    path: string,
    body: Record<string, string>,
    parse: (j: Record<string, unknown>) => T | null,
    emptyOk = false
  ): Promise<DodoCall<T>> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        // A captive portal answers with a redirect: that is "no answer from Dodo", not an error from it.
        redirect: 'error'
      })
      const text = (await res.text()).slice(0, MAX_BODY_CHARS)
      if (!res.ok) return { kind: 'http', status: res.status, code: errorCodeOf(text) }
      if (emptyOk && text.trim() === '') return { kind: 'ok', data: parse({}) as T }
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        return { kind: 'network', reason: 'unexpected response' }
      }
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        return emptyOk ? { kind: 'ok', data: parse({}) as T } : { kind: 'network', reason: 'unexpected response' }
      }
      const data = parse(json as Record<string, unknown>)
      if (data === null) return { kind: 'network', reason: 'unexpected response' }
      return { kind: 'ok', data }
    } catch (err) {
      const reason = ctrl.signal.aborted ? 'timeout' : err instanceof Error ? err.name : 'error'
      return { kind: 'network', reason }
    } finally {
      clearTimeout(timer)
    }
  }
}
