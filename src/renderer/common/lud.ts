// Defensive access to window.lud (the preload API). Every call is guarded so a missing method
// (e.g. during integration, or in the visual harness) degrades gracefully instead of crashing the UI.
import type { LudApi } from '../../shared/api'

type Fn = (...args: never[]) => unknown

function getApi(): Partial<LudApi> | null {
  const w = globalThis as { lud?: Partial<LudApi> }
  return w.lud ?? null
}

/** Call an async LudApi method; resolves to `fallback` when missing or failing. */
export async function call<K extends keyof LudApi>(
  name: K,
  fallback: Awaited<ReturnType<Extract<LudApi[K], Fn>>>,
  ...args: Parameters<Extract<LudApi[K], Fn>>
): Promise<Awaited<ReturnType<Extract<LudApi[K], Fn>>>> {
  const api = getApi()
  const fn = api?.[name] as unknown as ((...a: unknown[]) => unknown) | undefined
  if (typeof fn !== 'function') return fallback
  try {
    return (await fn.apply(api, args)) as Awaited<ReturnType<Extract<LudApi[K], Fn>>>
  } catch {
    return fallback
  }
}

/** Like call() but rethrows (used where the caller shows a friendly error). */
export async function callStrict<K extends keyof LudApi>(
  name: K,
  ...args: Parameters<Extract<LudApi[K], Fn>>
): Promise<Awaited<ReturnType<Extract<LudApi[K], Fn>>>> {
  const api = getApi()
  const fn = api?.[name] as unknown as ((...a: unknown[]) => unknown) | undefined
  if (typeof fn !== 'function') throw new Error(`window.lud.${String(name)} is not available`)
  return (await fn.apply(api, args)) as Awaited<ReturnType<Extract<LudApi[K], Fn>>>
}

type Subscriptions = {
  [K in keyof LudApi as K extends `on${string}` ? K : never]: LudApi[K]
}

/** Subscribe to a main → renderer channel; returns an unsubscribe function (no-op when unavailable). */
export function subscribe<K extends keyof Subscriptions>(name: K, cb: Parameters<Subscriptions[K]>[0]): () => void {
  const api = getApi()
  const fn = api?.[name] as unknown as ((c: unknown) => unknown) | undefined
  if (typeof fn !== 'function') return () => undefined
  try {
    const off = fn.call(api, cb)
    return typeof off === 'function' ? (off as () => void) : () => undefined
  } catch {
    return () => undefined
  }
}

/** Synchronous path resolution for dropped File objects. */
export function pathsForFiles(files: File[]): string[] {
  const api = getApi()
  if (!api || typeof api.pathsForFiles !== 'function') return []
  try {
    return api.pathsForFiles(files).filter((p) => typeof p === 'string' && p.length > 0)
  } catch {
    return []
  }
}

export function newJobId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) {
    try {
      return c.randomUUID()
    } catch {
      // not a secure context: fall through
    }
  }
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
