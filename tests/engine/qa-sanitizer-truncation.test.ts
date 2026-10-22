// QA phase 4 (found while verifying B-060): elements the sanitizer drops "with content" (svg, math,
// noscript, template, …) used to swallow the REST of the document when their end tag was missing,
// because drop mode only ended at the matching end tag (QA-P4-01, B-065). Fixed: an unclosed one
// is dropped only up to the next block boundary. The B-060 mXSS guarantees still hold for the
// unclosed payloads (tests/engine/sanitizer-mxss.test.ts covers the closed ones).
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

function markdownToSanitized(payload: string): string {
  const html = marked.parse(`Before.\n\n${payload}\n\nAfter the payload.\n`, { async: false, gfm: true })
  return sanitizeHtml(html)
}

const FORBIDDEN = /^(svg|math|script|iframe|frame|frameset|object|embed|applet|noscript|template|base|link|meta|portal|audio|video|source|track)$/

/**
 * Nothing that can run script, load a resource or enter foreign content. Checked structurally:
 * every '<' in the output must open a well-formed tag the sanitizer built (text and raw text
 * never contain one), so the attributes seen here are exactly the ones a browser sees.
 */
function assertInert(clean: string): void {
  const TAG = /<(\/?)([a-z][a-z0-9:_-]*)((?: [^\s"'>/=]+="[^"<>]*")*)( \/)?>/giy
  for (let i = clean.indexOf('<'); i >= 0; i = clean.indexOf('<', i + 1)) {
    TAG.lastIndex = i
    const m = TAG.exec(clean)
    expect(m, `stray '<' at ${i} in: ${clean}`).not.toBeNull()
    const [, , name, attrs] = m!
    expect(name!.toLowerCase()).not.toMatch(FORBIDDEN)
    for (const [, attr, value] of attrs!.matchAll(/ ([^\s"'>/=]+)="([^"]*)"/g)) {
      expect(attr).not.toMatch(/^(on|srcdoc$|http-equiv$)/i)
      expect(value).not.toMatch(/javascript:/i)
      if (attr === 'src') expect(value).toMatch(/^data:image\//)
    }
  }
}

describe('QA: text after an unclosed dropped element survives sanitizing', () => {
  for (const payload of UNCLOSED) it(`QA-P4-01 fixed (B-065): ${payload}`, () => {
    const out = markdownToSanitized(payload)
    expect(out).toContain('Before.')
    expect(out, `sanitized: ${out}`).toContain('After the payload.')
    // the text after the payload is rendered as a paragraph, not hidden in raw text
    expect(out).toMatch(/<p>After the payload\.<\/p>/)
    assertInert(out)
  })
})

describe('B-065: unclosed drop-with-content elements', () => {
  it('drop only up to the next block boundary', () => {
    expect(sanitizeHtml('<p>a</p><svg><circle r="1"><text>t</text><p>b</p><div>c</div>')).toBe('<p>a</p><p>b</p><div>c</div>')
    expect(sanitizeHtml('<p>a <math><mi>x</mi> rest</p><h2>Next</h2>')).toBe('<p>a <h2>Next</h2>')
    expect(sanitizeHtml('<ul><li>one <svg><path d="M0"></li><li>two</li></ul>')).toBe('<ul><li>one <li>two</li></ul>')
    expect(sanitizeHtml('<template><b>t</b>tail<p>after</p>')).toBe('<p>after</p>')
    expect(sanitizeHtml('<video><source src="x.mp4"><p>after</p>')).toBe('<p>after</p>')
  })

  it('raw text running to the end of the input resumes at the next block boundary', () => {
    expect(sanitizeHtml('<noscript>enable JS<p>after</p>')).toBe('<p>after</p>')
    expect(sanitizeHtml('<title>Doc</head><body>Hello <b>world</b><p>x</p>')).toBe('Hello <b>world</b><p>x</p>')
    expect(sanitizeHtml('<script>var a = 1 < 2;<p>after</p>')).toBe('<p>after</p>')
    expect(sanitizeHtml('<svg><style>x{}<p>after</p>')).toBe('<p>after</p>')
    // nothing to resume at: the rest really is the element's own content
    expect(sanitizeHtml('<p>a</p><noscript>only inline text')).toBe('<p>a</p>')
  })

  it('closed elements are still dropped with everything inside (B-060 unchanged)', () => {
    expect(sanitizeHtml('<p>a</p><template><p>t</p></template><svg><foreignObject><div>x</div></foreignObject></svg><p>b</p>')).toBe('<p>a</p><p>b</p>')
    expect(sanitizeHtml('<noscript><p>Enable JS</p></noscript><p>b</p>')).toBe('<p>b</p>')
  })

  const PAYLOADS: readonly string[] = [
    `<svg><style><img src=x onerror=alert(1)>`,
    `<svg><style><p><img src=x onerror=alert(1)>`,
    `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>`,
    `<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">`,
    `<math><mtext><p><mglyph><svg><mtext><style><path id="</style><img onerror=alert(1) src>">`,
    `<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">`,
    `<svg><p><style><img src=x onerror=alert(1)>`,
    `<svg><title><p></svg><img src=x onerror=alert(1)>`,
    `<noscript><p title="<img src=x onerror=alert(1)>"><a href="javascript:alert(1)">x</a>`,
    `<noscript><p><script>alert(1)</script><iframe srcdoc="<script>alert(1)</script>">`,
    `<template><p><img src=x onerror=alert(1)><svg onload=alert(1)>`,
    `<svg/onload=alert(1)>`,
    `<math><annotation-xml encoding="text/html"><p><style><img src=x onerror=alert(1)>`
  ]

  it.each(PAYLOADS)('unclosed payload stays inert: %s', (payload) => {
    assertInert(sanitizeHtml(payload))
    const clean = sanitizeHtml(`<p>before</p>${payload}${payload}<p>after</p>`)
    assertInert(clean)
    expect(clean).toContain('<p>before</p>')
    expect(clean).toContain('after')
  })

  it('stays linear on many nested unclosed elements', () => {
    const t0 = Date.now()
    const out = sanitizeHtml(`${'<math><style><p>'.repeat(20000)}${'<noscript><p>x'.repeat(20000)}<p>end</p>`)
    expect(out.endsWith('<p>end</p>')).toBe(true)
    expect(Date.now() - t0).toBeLessThan(5000)
  })
})
