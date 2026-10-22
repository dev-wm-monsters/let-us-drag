// B-060 / Security F-25: mutation-XSS through SVG/MathML foreign content. The sanitizer drops
// <svg> and <math> with everything inside, so its output can never enter foreign content (where
// <style> is not raw text and HTML "breakout" tags escape). CSP stays as the second layer.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sanitizeHtml } from '../../src/engine/tools/html'
import { makeTempDir } from '../helpers/fixtures'
import { convertOk, fakeHtmlToPdf } from '../helpers/engine'

/** The reported payload (REVIEW.md F-25) and classic mXSS variants (DOMPurify bypass history). */
const PAYLOADS: readonly string[] = [
  `<svg><style><img src=x onerror="document.title='PWNED7'"></style></svg>`,
  `<SVG><STYLE><img src=x onerror=alert(1)></STYLE></SVG>`,
  `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>`,
  `<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">`,
  `<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">`,
  `<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>`,
  `<math><annotation-xml encoding="text/html"><style><img src=x onerror=alert(1)></style></annotation-xml></math>`,
  `<svg><![CDATA[ > </svg> <style><img src=x onerror=alert(1)//]]></svg>`,
  `<svg><title></svg><img src=x onerror=alert(1)></title></svg>`,
  `<svg><foreignObject><style><img src=x onerror=alert(1)></style></foreignObject></svg>`,
  `<svg/onload=alert(1)>`,
  `<math href="javascript:alert(1)">click</math>`,
  `<noscript><p title="</noscript><img src=x onerror=alert(1)>">`,
  `<svg><use href="data:image/svg+xml;base64,PHN2ZyBpZD0neCcgeG1sbnM9J2h0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnJz48aW1hZ2UgaHJlZj0nMScgb25lcnJvcj0nYWxlcnQoMSknLz48L3N2Zz4=#x"/></svg>`
]

function assertInert(clean: string): void {
  expect(clean).not.toMatch(/<\s*(svg|math)\b/i)
  expect(clean).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i) // no event-handler attribute on any tag
  expect(clean).not.toMatch(/javascript:/i)
  expect(clean).not.toMatch(/<img\b[^>]*\ssrc="(?!data:image\/)/i) // no external/relative image
  expect(clean).not.toMatch(/<(mglyph|mtext|annotation-xml|foreignobject)\b/i)
}

describe('sanitizer: SVG/MathML mutation XSS (F-25)', () => {
  it('the reported payload no longer passes unchanged', () => {
    const p = PAYLOADS[0]!
    const clean = sanitizeHtml(p)
    expect(clean).not.toBe(p)
    expect(clean).toBe('')
  })

  it.each(PAYLOADS)('neutralised: %s', (payload) => {
    assertInert(sanitizeHtml(payload))
    // also inside surrounding content, and with the payload twice
    const clean = sanitizeHtml(`<p>before</p>${payload}${payload}<p>after</p>`)
    assertInert(clean)
    expect(clean).toContain('<p>before</p>')
  })

  it('content after a closed <svg>/<math> is kept; SVG as a data: image still works', () => {
    const clean = sanitizeHtml('<p>a</p><svg><circle r="5"/><text>x</text></svg><p>b</p><math><mi>x</mi></math><p>c</p><img src="data:image/svg+xml;base64,PHN2Zy8+" alt="pic">')
    expect(clean).toBe('<p>a</p><p>b</p><p>c</p><img src="data:image/svg+xml;base64,PHN2Zy8+" alt="pic">')
  })

  it('a plain <style> outside foreign content stays CSS (nothing can close it early)', () => {
    const clean = sanitizeHtml('<style>p{color:red}</style><style><img src=x onerror=alert(1)></style>')
    expect(clean).toContain('<style>p{color:red}</style>')
    // inside <style> the <img …> is CSS text for the browser, never an element
    expect(clean).toMatch(/^<style>p\{color:red\}<\/style><style>[^]*<\/style>$/)
    expect(clean.match(/<\/style>/g)).toHaveLength(2)
  })
})

describe('end to end: Markdown/HTML with the payload (F-25 repro note.md → note.html)', () => {
  let dir = ''
  let cleanup: () => Promise<void> = async () => undefined
  beforeAll(async () => {
    ;({ dir, cleanup } = await makeTempDir('lud-mxss-'))
  })
  afterAll(() => cleanup())

  it('note.md → to-html: no foreign content in the written file', async () => {
    const src = join(dir, 'note.md')
    await writeFile(src, `# Note\n\n${PAYLOADS[0]!}\n\nAfter.\n`)
    const [out] = await convertOk('to-html', [src])
    const html = await readFile(out!, 'utf8')
    assertInert(html.slice(html.indexOf('<body>')))
    expect(html).toContain('After.')
    expect(html).toContain('Content-Security-Policy') // second layer still there
  })

  it('page.html → to-pdf: the HTML handed to Chromium has no foreign content', async () => {
    const src = join(dir, 'page.html')
    await writeFile(src, `<html><body><h1>Page</h1>${PAYLOADS[2]!}<p>Middle.</p>${PAYLOADS[4]!}<p>After.</p></body></html>`)
    const adapter = fakeHtmlToPdf()
    await convertOk('to-pdf', [src], { adapters: adapter })
    const html = adapter.calls[0]!
    assertInert(html.slice(html.indexOf('<body>')))
    expect(html).toContain('Middle.')
  })
})
