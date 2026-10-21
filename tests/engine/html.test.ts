import { describe, expect, it } from 'vitest'
import {
  decodeEntities,
  htmlToMarkdown,
  htmlToText,
  isSafeLinkUrl,
  isSafeResourceUrl,
  parseHtml,
  sanitizeCss,
  sanitizeHtml,
  textContent,
  tokenize,
  wrapHtmlDocument
} from '../../src/engine/tools/html'

describe('tokenizer / parser', () => {
  it('handles attributes in every quoting style and raw-text elements', () => {
    const t = tokenize(`<a href="x" title='y' data-z=w checked>t</a><script>if (a<b) {}</script><!-- c -->`)
    expect(t[0]).toEqual({
      type: 'start',
      name: 'a',
      attrs: [
        { name: 'href', value: 'x' },
        { name: 'title', value: 'y' },
        { name: 'data-z', value: 'w' },
        { name: 'checked', value: '' }
      ],
      selfClosing: false
    })
    expect(t.find((x) => x.type === 'rawtext')).toEqual({ type: 'rawtext', raw: 'if (a<b) {}', parent: 'script' })
  })

  it('never throws on malformed markup', () => {
    for (const s of ['<', '<a', '<a href="', '</', '<!--', '<p><b>x</p>', '<<>>', '<script>no end']) {
      expect(() => parseHtml(s)).not.toThrow()
    }
  })

  it('decodes entities', () => {
    expect(decodeEntities('a &amp; b &lt;&#65;&#x42;&nbsp;&unknown; &copy')).toBe('a & b <AB &unknown; ©')
    expect(decodeEntities('&#0;&#xD800;')).toBe('��')
  })

  it('implicitly closes <p> and <li>', () => {
    const root = parseHtml('<ul><li>a<li>b</ul><p>one<p>two')
    const ul = root.children[0]
    expect(ul?.type === 'element' && ul.children.length).toBe(2)
    expect(textContent(root)).toBe('abonetwo')
  })
})

describe('sanitizer (untrusted HTML → PDF)', () => {
  it('removes scripts, handlers, frames, objects, meta refresh, base, external loads', () => {
    const dirty = `<html><head><meta http-equiv="refresh" content="0;url=http://x"><base href="http://x/"><link rel=stylesheet href="http://x/a.css"><style>@import url(http://x/b.css); p{background:url('http://x/c.png')} q{background:url(data:image/png;base64,AAA)}</style></head>
<body onload="x()"><p onclick="y()" style="background-image:url(http://x/d.png);color:red">hi</p>
<img src="http://x/e.png" srcset="http://x/f.png 2x"><img src="data:image/png;base64,AAAA" alt="ok">
<iframe src="http://x"></iframe><object data="http://x/o"></object><embed src="http://x/e"><svg><image href="http://x/i.png"/><script>z()</script></svg>
<a href="javascript:alert(1)">j</a><a href="https://example.com">ok</a><form action="http://x"><button formaction="http://x">b</button></form>
<video src="http://x/v.mp4"></video><noscript><img src="http://x/n.png"></noscript></body></html>`
    const clean = sanitizeHtml(dirty)
    expect(clean).not.toMatch(/http:\/\/x/)
    expect(clean).not.toMatch(/<script|<iframe|<object|<embed|<meta|<base|<link|<video|<noscript/i)
    expect(clean).not.toMatch(/\son\w+=/i)
    expect(clean).not.toMatch(/javascript:/i)
    expect(clean).not.toMatch(/@import/i)
    expect(clean).toContain('data:image/png;base64,AAAA')
    expect(clean).toContain('url(data:image/png;base64,AAA)')
    expect(clean).toContain('href="https://example.com"')
    expect(clean).toContain('color:red')
    expect(clean).toContain('>hi</p>')
  })

  it('URL policies', () => {
    expect(isSafeResourceUrl('data:image/png;base64,AA')).toBe(true)
    expect(isSafeResourceUrl(' DATA:image/svg+xml;utf8,<svg/>')).toBe(true)
    expect(isSafeResourceUrl('data:text/html,<script>')).toBe(false)
    expect(isSafeResourceUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeResourceUrl('//cdn.example/x.png')).toBe(false)
    expect(isSafeResourceUrl('img.png')).toBe(false)
    expect(isSafeLinkUrl('java\u0000script:alert(1)')).toBe(false)
    expect(isSafeLinkUrl('mailto:a@b.c')).toBe(true)
  })

  it('CSS: strips @import, remote url(), image-set and legacy script hooks', () => {
    const css = sanitizeCss('@import "x.css"; a{background:url( "https://x/y.png" )} b{width:expression(alert(1))} c{background:image-set("x.png" 1x)}')
    expect(css).not.toMatch(/@import|https:|expression\(|image-set\(/)
  })

  it('wraps into a full document with CSP when asked', () => {
    const doc = wrapHtmlDocument('<p>x</p>', 'A <title>', { csp: true })
    expect(doc).toContain("default-src 'none'")
    expect(doc).toContain('<title>A &lt;title&gt;</title>')
    expect(wrapHtmlDocument('<p>x</p>', 't')).not.toContain('Content-Security-Policy')
  })
})

describe('HTML → text', () => {
  it('keeps structure readable', () => {
    const t = htmlToText('<h1>Title</h1><p>Hello <b>big</b>\n   world</p><ul><li>a</li><li>b<ul><li>c</li></ul></li></ul><table><tr><td>1</td><td>2</td></tr></table><p>x<br>y</p><script>bad()</script>')
    expect(t).toBe('Title\n\nHello big world\n\n- a\n- b\n  - c\n\n1\t2\n\nx\ny\n')
  })

  it('preserves <pre> whitespace', () => {
    expect(htmlToText('<pre>a\n  b</pre>')).toBe('a\n  b\n')
  })
})

describe('HTML → Markdown', () => {
  it('converts mammoth-style HTML', () => {
    const md = htmlToMarkdown(
      '<h1>Report</h1><p>Some <strong>bold</strong>, <em>italic</em> and <a href="https://x.y/a b">a link</a>.</p><ul><li>one</li><li>two<ul><li>deep</li></ul></li></ul><ol><li>first</li><li>second</li></ol><table><tr><td><p>H1</p></td><td><p>H|2</p></td></tr><tr><td><p>v1</p></td><td><p>v2</p></td></tr></table><pre>code *x*</pre><blockquote><p>quote</p></blockquote><hr><p>line<br />break</p><p><img src="data:image/png;base64,AA" alt="pic"></p>'
    )
    expect(md).toBe(
      [
        '# Report',
        'Some **bold**, *italic* and [a link](https://x.y/a%20b).',
        '- one\n- two\n  - deep',
        '1. first\n2. second',
        '| H1 | H\\|2 |\n| --- | --- |\n| v1 | v2 |',
        '```\ncode *x*\n```',
        '> quote',
        '---',
        'line\\\nbreak',
        '![pic](data:image/png;base64,AA)'
      ].join('\n\n') + '\n'
    )
  })

  it('escapes Markdown syntax in plain text', () => {
    expect(htmlToMarkdown('<p>1. not a list *really* [x]</p><p># not a heading</p>')).toBe('1\\. not a list \\*really\\* \\[x\\]\n\n\\# not a heading\n')
  })

  it('returns an empty string for empty input', () => {
    expect(htmlToMarkdown('')).toBe('')
  })
})
