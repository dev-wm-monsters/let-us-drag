// QA phase 4 (found while verifying B-060): elements the sanitizer drops "with content" (svg, math,
// noscript, template, …) swallow the REST of the document when their end tag is missing, because
// drop mode only ends at the matching end tag. A browser would close them at the end of the
// enclosing block, so text after them is lost from the HTML/PDF output (data loss, not a security
// issue: nothing unsafe is emitted). Written as it.fails (known bug, keeps npm test green): when the
// Engine fixes it these turn red, then change it.fails back to it.
import { marked } from 'marked'
import { describe, expect, it } from 'vitest'
import { sanitizeHtml } from '../../src/engine/tools/html'

const UNCLOSED = [
  '<svg><circle r="4">',
  '<math><mi>x</mi>',
  '<noscript>enable JS',
  '<template><p>t</p>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>'
]

describe('QA: text after an unclosed dropped element survives sanitizing', () => {
  for (const payload of UNCLOSED) it.fails(`QA-P4-01 known bug: ${payload}`, () => {
    const html = marked.parse(`Before.\n\n${payload}\n\nAfter the payload.\n`, { async: false, gfm: true })
    const out = sanitizeHtml(html)
    expect(out).toContain('Before.')
    expect(out, `sanitized: ${out}`).toContain('After the payload.')
  })
})
