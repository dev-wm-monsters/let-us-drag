// Pure helper for the htmlToPdf adapter: a CSP that blocks all network and scripts.

export const PDF_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"

/** Insert a CSP meta tag at the very top of the document (after a doctype, if any). */
export function injectCsp(html: string, csp: string = PDF_CSP): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`
  const m = /^\s*<!doctype[^>]*>/i.exec(html)
  if (m) return html.slice(0, m[0].length) + meta + html.slice(m[0].length)
  return meta + html
}
