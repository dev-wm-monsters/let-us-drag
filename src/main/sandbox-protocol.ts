// Custom scheme for the hidden helper windows (htmlToPdf, renderPdfPages).
//
// Why a custom scheme: those windows render untrusted content (HTML made from user documents,
// user PDFs). Serving them from `file://` would give the page file-origin privileges and put the
// document next to the user's files (SEC-82). Instead each helper window gets its own in-memory
// session whose `protocol.handle('lud-sandbox', …)` serves ONLY the bytes main decides to serve
// (the current document and, for PDFs, the pdf.js files). Everything else is refused, and a
// webRequest filter on the same session cancels every other URL (http, file, ws, …).
//
// The scheme is registered as privileged before the app is ready (index.ts, SANDBOX_PRIVILEGES).
// This module is pure (no electron import) and unit tested.

export const SANDBOX_SCHEME = 'lud-sandbox'

/** `standard` gives the pages a real origin (needed for module scripts and the pdf.js worker);
 * `secure` makes it a secure context; `supportFetchAPI` lets pdf.js fetch its font/cmap/wasm
 * data from the same origin. No CORS, no service workers, no code cache. */
export const SANDBOX_PRIVILEGES = { standard: true, secure: true, supportFetchAPI: true, codeCache: false } as const

/** Minimal content types for what the helper windows load. */
export function contentTypeFor(path: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ''
  switch (ext) {
    case 'html':
      return 'text/html; charset=utf-8'
    case 'mjs':
    case 'js':
      return 'text/javascript; charset=utf-8'
    case 'pdf':
      return 'application/pdf'
    case 'wasm':
      return 'application/wasm'
    default:
      return 'application/octet-stream'
  }
}

/** Is `url` on our scheme and the given host? (Parsed, never prefix-matched.) */
export function isSandboxUrl(url: string, host: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === `${SANDBOX_SCHEME}:` && u.host === host && u.username === '' && u.password === ''
  } catch {
    return false
  }
}

/**
 * Map a request path onto a relative file path below one of the allowed prefixes, or null.
 * Rejects traversal (`..`, encoded or not), backslashes, NUL and empty segments.
 */
export function mapSandboxPath(pathname: string, prefixes: readonly string[]): { prefix: string; rel: string } | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null
  for (const prefix of prefixes) {
    if (!decoded.startsWith(prefix)) continue
    const rel = decoded.slice(prefix.length)
    const parts = rel.split('/')
    if (rel === '' || parts.some((p) => p === '' || p === '.' || p === '..')) return null
    return { prefix, rel }
  }
  return null
}

export function sandboxResponse(body: Uint8Array | string | null, status: number, contentType: string, csp: string): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': contentType,
      'content-security-policy': csp,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store'
    }
  })
}
