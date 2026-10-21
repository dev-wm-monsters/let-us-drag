// Pure helpers for the htmlToPdf adapter: a CSP that blocks all network and scripts, and the
// request filter of its session.

import { isSandboxUrl } from './sandbox-protocol'

export const PRINT_HOST = 'print'

export const PDF_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"

/** Insert a CSP meta tag at the very top of the document (after a doctype, if any). */
export function injectCsp(html: string, csp: string = PDF_CSP): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`
  const m = /^\s*<!doctype[^>]*>/i.exec(html)
  if (m) return html.slice(0, m[0].length) + meta + html.slice(m[0].length)
  return meta + html
}

/** Pure: may the print session load this URL? Only the current document and data: URLs. */
export function isAllowedPrintRequest(url: string, documentUrl: string | null): boolean {
  if (url.startsWith('data:')) return true
  return documentUrl !== null && url === documentUrl && isSandboxUrl(url, PRINT_HOST)
}

