// Small, dependency-free HTML toolkit: tokenizer, forgiving tree builder, sanitizer for
// rendering untrusted HTML to PDF, HTML → plain text and HTML → Markdown.
// It is NOT a full HTML5 parser; it targets the well-formed HTML produced by mammoth/marked and
// typical hand-written pages, and degrades gracefully (never throws) on malformed markup.

export interface Attr {
  name: string
  value: string
}

export type Token =
  | { type: 'text'; raw: string }
  | { type: 'rawtext'; raw: string; parent: string }
  | { type: 'start'; name: string; attrs: Attr[]; selfClosing: boolean }
  | { type: 'end'; name: string }
  | { type: 'comment' }
  | { type: 'doctype' }

/** Elements whose content is not markup. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext'])
export const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•',
  middot: '·', euro: '€', pound: '£', yen: '¥', cent: '¢', laquo: '«', raquo: '»', times: '×',
  divide: '÷', deg: '°', para: '¶', sect: '§', shy: '­', ensp: ' ', emsp: ' ', thinsp: ' ',
  zwnj: '‌', zwj: '‍', larr: '←', rarr: '→', uarr: '↑', darr: '↓', check: '✓', hearts: '♥'
}

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});?/g, (m, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '�'
      return String.fromCodePoint(cp)
    }
    const named = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()]
    return named ?? m
  })
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

const NAME_CHAR = /[A-Za-z0-9:_-]/

/** Tokenize HTML. Never throws. */
export function tokenize(html: string): Token[] {
  const out: Token[] = []
  const n = html.length
  let i = 0
  let textStart = 0
  const flushText = (end: number): void => {
    if (end > textStart) out.push({ type: 'text', raw: html.slice(textStart, end) })
  }
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt < 0) break
    i = lt
    const next = html[i + 1] ?? ''
    if (html.startsWith('<!--', i)) {
      flushText(i)
      const end = html.indexOf('-->', i + 4)
      i = end < 0 ? n : end + 3
      out.push({ type: 'comment' })
      textStart = i
      continue
    }
    if (next === '!' || next === '?') {
      flushText(i)
      const end = html.indexOf('>', i + 2)
      const isDoctype = /^<!doctype/i.test(html.slice(i, i + 9))
      i = end < 0 ? n : end + 1
      out.push(isDoctype ? { type: 'doctype' } : { type: 'comment' })
      textStart = i
      continue
    }
    if (next === '/' && /[A-Za-z]/.test(html[i + 2] ?? '')) {
      flushText(i)
      let j = i + 2
      while (j < n && NAME_CHAR.test(html[j]!)) j++
      const name = html.slice(i + 2, j).toLowerCase()
      const end = html.indexOf('>', j)
      i = end < 0 ? n : end + 1
      out.push({ type: 'end', name })
      textStart = i
      continue
    }
    if (!/[A-Za-z]/.test(next)) {
      i++ // a literal '<' in text
      continue
    }
    flushText(i)
    let j = i + 1
    while (j < n && NAME_CHAR.test(html[j]!)) j++
    const name = html.slice(i + 1, j).toLowerCase()
    const attrs: Attr[] = []
    let selfClosing = false
    // attributes
    for (;;) {
      while (j < n && /[\s/]/.test(html[j]!)) {
        if (html[j] === '/' && html[j + 1] === '>') selfClosing = true
        j++
      }
      if (j >= n) break
      if (html[j] === '>') {
        j++
        break
      }
      const nameStart = j
      while (j < n && !/[\s/>=]/.test(html[j]!)) j++
      const attrName = html.slice(nameStart, j).toLowerCase()
      while (j < n && /\s/.test(html[j]!)) j++
      let value = ''
      if (html[j] === '=') {
        j++
        while (j < n && /\s/.test(html[j]!)) j++
        const q = html[j]
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, j + 1)
          value = html.slice(j + 1, end < 0 ? n : end)
          j = end < 0 ? n : end + 1
        } else {
          const vs = j
          while (j < n && !/[\s>]/.test(html[j]!)) j++
          value = html.slice(vs, j)
        }
      }
      if (attrName && !attrs.some((a) => a.name === attrName)) attrs.push({ name: attrName, value: decodeEntities(value) })
    }
    out.push({ type: 'start', name, attrs, selfClosing })
    i = j
    textStart = i
    if (RAW_TEXT.has(name) && !selfClosing) {
      const closeRe = new RegExp(`</${name}[\\s/>]`, 'ig')
      closeRe.lastIndex = i
      const m = name === 'plaintext' ? null : closeRe.exec(html)
      const end = m ? m.index : n
      if (end > i) out.push({ type: 'rawtext', raw: html.slice(i, end), parent: name })
      if (m) {
        const gt = html.indexOf('>', end)
        i = gt < 0 ? n : gt + 1
        out.push({ type: 'end', name })
      } else {
        i = n
      }
      textStart = i
    }
  }
  flushText(n)
  return out
}

// ---------------------------------------------------------------------------------------------
// Tree

export interface ElementNode {
  type: 'element'
  name: string
  attrs: Record<string, string>
  children: HtmlNode[]
}
export interface TextNode {
  type: 'text'
  text: string
}
export type HtmlNode = ElementNode | TextNode

const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul'
])

/** Build a forgiving DOM-like tree. Text is entity-decoded. */
export function parseHtml(html: string): ElementNode {
  const root: ElementNode = { type: 'element', name: '#root', attrs: {}, children: [] }
  const stack: ElementNode[] = [root]
  const top = (): ElementNode => stack[stack.length - 1]!
  const popTo = (name: string, stopAt: readonly string[] = []): boolean => {
    for (let k = stack.length - 1; k > 0; k--) {
      const el = stack[k]!
      if (stopAt.includes(el.name)) return false
      if (el.name === name) {
        stack.length = k
        return true
      }
    }
    return false
  }
  for (const t of tokenize(html)) {
    if (t.type === 'text') {
      top().children.push({ type: 'text', text: decodeEntities(t.raw) })
    } else if (t.type === 'rawtext') {
      const text = t.parent === 'title' || t.parent === 'textarea' ? decodeEntities(t.raw) : t.raw
      top().children.push({ type: 'text', text })
    } else if (t.type === 'start') {
      if (CLOSES_P.has(t.name)) popTo('p', ['td', 'th', 'li', 'blockquote', 'div', 'table'])
      if (t.name === 'li') popTo('li', ['ul', 'ol'])
      if (t.name === 'td' || t.name === 'th') {
        if (!popTo('td', ['tr', 'table'])) popTo('th', ['tr', 'table'])
      }
      if (t.name === 'tr') popTo('tr', ['table', 'tbody', 'thead', 'tfoot'])
      const el: ElementNode = { type: 'element', name: t.name, attrs: Object.fromEntries(t.attrs.map((a) => [a.name, a.value])), children: [] }
      top().children.push(el)
      if (!VOID_ELEMENTS.has(t.name) && !t.selfClosing) stack.push(el)
    } else if (t.type === 'end') {
      if (t.name === 'p' && !stack.some((e) => e.name === 'p')) {
        top().children.push({ type: 'element', name: 'p', attrs: {}, children: [] })
        continue
      }
      popTo(t.name)
    }
  }
  return root
}

export function textContent(node: HtmlNode): string {
  if (node.type === 'text') return node.text
  return node.children.map(textContent).join('')
}

// ---------------------------------------------------------------------------------------------
// Sanitizer (for rendering untrusted HTML into a PDF)

/** Elements removed together with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'noscript', 'template', 'base', 'link', 'meta',
  'title', 'portal', 'audio', 'video', 'source', 'track'
])
/** Wrapper elements that are unwrapped (content kept) because we provide our own document shell. */
const UNWRAP = new Set(['html', 'head', 'body'])
const URL_ATTRS = new Set(['src', 'href', 'xlink:href', 'poster', 'background', 'data', 'codebase', 'action', 'formaction', 'lowsrc', 'dynsrc', 'longdesc', 'cite', 'manifest', 'ping', 'srcset', 'imagesrcset'])

function normalizedUrl(v: string): string {
  return v.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase()
}

/** Only inline data: images (no network, no file access) and in-document anchors are kept. */
export function isSafeResourceUrl(v: string): boolean {
  const u = normalizedUrl(v)
  return /^data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml);/.test(u) || u.startsWith('#')
}

/** Links (<a href>) don't load anything while rendering; allow web/mail links and anchors. */
export function isSafeLinkUrl(v: string): boolean {
  const u = normalizedUrl(v)
  return u.startsWith('#') || u.startsWith('http:') || u.startsWith('https:') || u.startsWith('mailto:')
}

/** Neutralise CSS that could load external resources or run legacy script hooks. */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, _q: string, url: string) => (isSafeResourceUrl(url) ? m : 'none'))
    .replace(/image-set\s*\(/gi, 'invalid(')
    .replace(/expression\s*\(/gi, 'invalid(')
    .replace(/behavior\s*:/gi, 'invalid:')
    .replace(/-moz-binding\s*:/gi, 'invalid:')
}

function sanitizeAttrs(tag: string, attrs: Attr[]): Attr[] {
  const out: Attr[] = []
  for (const a of attrs) {
    const name = a.name
    if (name.startsWith('on')) continue
    if (name === 'http-equiv' || name === 'srcdoc' || name === 'is') continue
    if (name === 'style') {
      out.push({ name, value: sanitizeCss(a.value) })
      continue
    }
    if (URL_ATTRS.has(name)) {
      if (name === 'srcset' || name === 'imagesrcset' || name === 'ping' || name === 'action' || name === 'formaction') continue
      const ok = tag === 'a' && name === 'href' ? isSafeLinkUrl(a.value) : isSafeResourceUrl(a.value)
      if (!ok) continue
    }
    out.push(a)
  }
  return out
}

/**
 * Sanitize an HTML document or fragment into a body fragment that is safe to render with
 * JavaScript disabled and without network access: removes scripts, frames, plugins, meta
 * refreshes, event handlers, javascript: URLs and every external resource reference.
 */
export function sanitizeHtml(html: string): string {
  let out = ''
  let dropDepth = 0
  let dropTag = ''
  for (const t of tokenize(html)) {
    if (dropDepth > 0) {
      if (t.type === 'start' && t.name === dropTag && !t.selfClosing && !VOID_ELEMENTS.has(t.name)) dropDepth++
      else if (t.type === 'end' && t.name === dropTag) dropDepth--
      continue
    }
    switch (t.type) {
      case 'text':
        out += t.raw.replace(/</g, '&lt;')
        break
      case 'rawtext':
        out += t.parent === 'style' ? sanitizeCss(t.raw).replace(/<\//g, '<\\/') : escapeHtml(decodeEntities(t.raw))
        break
      case 'start': {
        if (DROP_WITH_CONTENT.has(t.name)) {
          if (!VOID_ELEMENTS.has(t.name) && !t.selfClosing) {
            dropDepth = 1
            dropTag = t.name
          }
          break
        }
        if (UNWRAP.has(t.name)) break
        const attrs = sanitizeAttrs(t.name, t.attrs)
        out += `<${t.name}${attrs.map((a) => ` ${a.name}="${escapeAttr(a.value)}"`).join('')}${t.selfClosing && VOID_ELEMENTS.has(t.name) ? ' /' : ''}>`
        break
      }
      case 'end':
        if (DROP_WITH_CONTENT.has(t.name) || UNWRAP.has(t.name)) break
        out += `</${t.name}>`
        break
      default:
        break
    }
  }
  return out
}

/** Clean, print-friendly stylesheet used for every generated HTML/PDF. */
export const PRINT_CSS = `
@page { size: A4; margin: 18mm 16mm; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif; font-size: 11pt; line-height: 1.5; color: #1a1a1a; max-width: 48em; margin: 0 auto; padding: 0 1em; overflow-wrap: break-word; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.2em 0 0.5em; page-break-after: avoid; break-after: avoid; }
h1 { font-size: 1.9em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
p, ul, ol, blockquote, pre, table { margin: 0 0 0.9em; }
img, svg { max-width: 100%; height: auto; }
pre, code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; font-size: 0.92em; }
pre { background: #f5f5f4; padding: 0.8em 1em; border-radius: 4px; white-space: pre-wrap; page-break-inside: avoid; }
:not(pre) > code { background: #f5f5f4; padding: 0.1em 0.3em; border-radius: 3px; }
blockquote { border-left: 3px solid #d6d3d1; padding-left: 1em; color: #44403c; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #d6d3d1; padding: 0.3em 0.6em; text-align: left; vertical-align: top; }
th { background: #f5f5f4; }
a { color: #1d4ed8; }
hr { border: 0; border-top: 1px solid #d6d3d1; margin: 1.5em 0; }
pre.lud-plain { background: none; padding: 0; font-family: inherit; font-size: 1em; white-space: pre-wrap; }
`.trim()

/** CSP that forbids scripts and any network/file loads (defence in depth for PDF rendering). */
export const RENDER_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"

/** Wrap a body fragment into a complete, styled HTML document. */
export function wrapHtmlDocument(bodyHtml: string, title: string, opts: { csp?: boolean } = {}): string {
  const csp = opts.csp ? `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(RENDER_CSP)}">\n` : ''
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
${csp}<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${PRINT_CSS}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`
}

/** Plain text → HTML fragment that preserves line breaks. */
export function plainTextToHtml(text: string): string {
  return `<pre class="lud-plain">${escapeHtml(text)}</pre>`
}

// ---------------------------------------------------------------------------------------------
// HTML → plain text

const BLOCKS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer',
  'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table',
  'tr', 'ul', 'caption', 'details', 'summary'
])
const INVISIBLE = new Set(['script', 'style', 'head', 'title', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'select', 'button'])

/** Convert HTML to readable plain text (paragraphs, list bullets, tab-separated table cells). */
export function htmlToText(html: string): string {
  const root = parseHtml(html)
  let out = ''
  const nl = (count: number): void => {
    const trailing = /\n*$/.exec(out)![0].length
    if (out.length === 0) return
    if (trailing < count) out += '\n'.repeat(count - trailing)
  }
  const walk = (node: HtmlNode, pre: boolean, listDepth: number): void => {
    if (node.type === 'text') {
      if (pre) out += node.text
      else {
        const t = node.text.replace(/[ \t\r\n\f]+/g, ' ')
        if (t === ' ' && (out.length === 0 || /[\s]$/.test(out))) return
        out += /\s$/.test(out) ? t.replace(/^ /, '') : t
      }
      return
    }
    const name = node.name
    if (INVISIBLE.has(name)) return
    if (name === 'br') {
      out += '\n'
      return
    }
    if (name === 'hr') {
      nl(2)
      out += '----------'
      nl(2)
      return
    }
    if (name === 'img') {
      const alt = node.attrs['alt']
      if (alt) out += alt
      return
    }
    if (name === 'td' || name === 'th') {
      if (!/(^|\n)$/.test(out)) out += '\t'
      node.children.forEach((c) => walk(c, pre, listDepth))
      return
    }
    const isBlock = BLOCKS.has(name)
    const para = /^(p|h[1-6]|pre|blockquote|ul|ol|table|dl)$/.test(name)
    if (isBlock) nl(para && listDepth === 0 ? 2 : 1)
    if (name === 'li') {
      out += '  '.repeat(Math.max(0, listDepth - 1)) + '- '
    }
    const childDepth = name === 'ul' || name === 'ol' ? listDepth + 1 : listDepth
    node.children.forEach((c) => walk(c, pre || name === 'pre', childDepth))
    if (isBlock) nl(para && listDepth === 0 ? 2 : 1)
  }
  walk(root, false, 0)
  return (
    out
      .split('\n')
      .map((l) => l.replace(/[  ]+$/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  )
}

// ---------------------------------------------------------------------------------------------
// HTML → Markdown (CommonMark/GFM). Supports headings, paragraphs, emphasis, links, images,
// lists (nested), code, blockquotes, tables (GFM) and rules. Other tags keep their text.

function escapeMd(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, '\\$1')
}

function escapeLineStart(line: string): string {
  return line
    .replace(/^(\s*)(#{1,6}\s|[-+]\s|>)/, (_m, sp: string, mark: string) => `${sp}\\${mark}`)
    .replace(/^(\s*\d+)([.)]\s)/, (_m, num: string, rest: string) => `${num}\\${rest}`)
}

function inlineMd(nodes: readonly HtmlNode[]): string {
  let out = ''
  for (const node of nodes) {
    if (node.type === 'text') {
      out += escapeMd(node.text.replace(/[ \t\r\n\f]+/g, ' '))
      continue
    }
    const inner = (): string => inlineMd(node.children)
    switch (node.name) {
      case 'strong':
      case 'b': {
        const s = inner().trim()
        if (s) out += `**${s}**`
        break
      }
      case 'em':
      case 'i': {
        const s = inner().trim()
        if (s) out += `*${s}*`
        break
      }
      case 's':
      case 'del':
      case 'strike': {
        const s = inner().trim()
        if (s) out += `~~${s}~~`
        break
      }
      case 'code': {
        const s = textContent(node)
        const fence = s.includes('`') ? '``' : '`'
        out += `${fence}${fence === '``' ? ' ' : ''}${s}${fence === '``' ? ' ' : ''}${fence}`
        break
      }
      case 'a': {
        const href = node.attrs['href']
        const s = inner()
        if (href && s.trim()) out += `[${s.trim()}](${href.replace(/\s/g, '%20').replace(/\)/g, '%29')})`
        else out += s
        break
      }
      case 'img': {
        const src = node.attrs['src']
        if (src) out += `![${escapeMd(node.attrs['alt'] ?? '')}](${src.replace(/\s/g, '%20').replace(/\)/g, '%29')})`
        break
      }
      case 'br':
        out += '\\\n'
        break
      default:
        if (INVISIBLE.has(node.name)) break
        out += inner()
    }
  }
  return out
}

function indent(text: string, prefix: string, firstPrefix = prefix): string {
  return text
    .split('\n')
    .map((l, i) => (l ? (i === 0 ? firstPrefix : prefix) + l : l))
    .join('\n')
}

function blocksMd(nodes: readonly HtmlNode[]): string[] {
  const blocks: string[] = []
  let inline: HtmlNode[] = []
  const flush = (): void => {
    const s = inlineMd(inline).trim()
    if (s) blocks.push(s.split('\n').map(escapeLineStart).join('\n'))
    inline = []
  }
  for (const node of nodes) {
    if (node.type === 'text' || !BLOCKS.has(node.name)) {
      if (node.type === 'element' && INVISIBLE.has(node.name)) continue
      if (node.type === 'element' && (node.name === 'thead' || node.name === 'tbody' || node.name === 'tfoot')) {
        flush()
        blocks.push(...blocksMd(node.children))
        continue
      }
      inline.push(node)
      continue
    }
    flush()
    const name = node.name
    if (/^h[1-6]$/.test(name)) {
      const s = inlineMd(node.children).replace(/\\\n/g, ' ').trim()
      if (s) blocks.push(`${'#'.repeat(Number(name[1]))} ${s}`)
    } else if (name === 'p' || name === 'div' || name === 'section' || name === 'article' || name === 'main' || name === 'header' || name === 'footer' || name === 'nav' || name === 'aside' || name === 'figure' || name === 'figcaption' || name === 'address' || name === 'form' || name === 'fieldset' || name === 'details' || name === 'summary' || name === 'caption' || name === 'dd' || name === 'dt' || name === 'dl') {
      blocks.push(...blocksMd(node.children))
    } else if (name === 'pre') {
      const code = textContent(node).replace(/\n$/, '')
      const fence = code.includes('```') ? '~~~~' : '```'
      blocks.push(`${fence}\n${code}\n${fence}`)
    } else if (name === 'blockquote') {
      const inner = blocksMd(node.children).join('\n\n')
      if (inner) blocks.push(inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'))
    } else if (name === 'ul' || name === 'ol') {
      blocks.push(listMd(node))
    } else if (name === 'li') {
      blocks.push(listMd({ type: 'element', name: 'ul', attrs: {}, children: [node] }))
    } else if (name === 'hr') {
      blocks.push('---')
    } else if (name === 'table') {
      const t = tableMd(node)
      if (t) blocks.push(t)
    } else if (name === 'tr') {
      const t = tableMd({ type: 'element', name: 'table', attrs: {}, children: [node] })
      if (t) blocks.push(t)
    } else {
      blocks.push(...blocksMd(node.children))
    }
  }
  flush()
  return blocks.filter((b) => b.trim() !== '')
}

function listMd(list: ElementNode): string {
  const ordered = list.name === 'ol'
  let n = Number(list.attrs['start'] ?? '1')
  if (!Number.isFinite(n)) n = 1
  const items: string[] = []
  let loose = false
  for (const child of list.children) {
    if (child.type !== 'element' || child.name !== 'li') {
      if (child.type === 'element' && (child.name === 'ul' || child.name === 'ol') && items.length > 0) {
        // Malformed nesting (<ul><li>a</li><ul>…</ul></ul>): attach to the previous item.
        const marker = ordered ? `${n - 1}. ` : '- '
        items[items.length - 1] += '\n' + indent(listMd(child), ' '.repeat(marker.length))
      }
      continue
    }
    const marker = ordered ? `${n++}. ` : '- '
    // Items with <p> children are "loose" (blank lines between blocks); others stay tight.
    const itemLoose = child.children.some((c) => c.type === 'element' && c.name === 'p')
    if (itemLoose) loose = true
    const body = blocksMd(child.children).join(itemLoose ? '\n\n' : '\n') || ''
    items.push(indent(body, ' '.repeat(marker.length), marker) || marker.trimEnd())
  }
  return items.join(loose ? '\n\n' : '\n')
}

function collectRows(node: ElementNode, rows: ElementNode[]): void {
  for (const c of node.children) {
    if (c.type !== 'element') continue
    if (c.name === 'tr') rows.push(c)
    else if (c.name === 'thead' || c.name === 'tbody' || c.name === 'tfoot') collectRows(c, rows)
  }
}

function tableMd(table: ElementNode): string {
  const rows: ElementNode[] = []
  collectRows(table, rows)
  const cells = rows.map((r) =>
    r.children
      .filter((c): c is ElementNode => c.type === 'element' && (c.name === 'td' || c.name === 'th'))
      .map((c) => blocksMd(c.children).join(' ').replace(/\\\n/g, ' ').replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim())
  )
  const width = Math.max(0, ...cells.map((r) => r.length))
  if (width === 0) return ''
  const pad = (r: string[]): string[] => [...r, ...Array<string>(width - r.length).fill('')]
  const line = (r: string[]): string => `| ${pad(r).join(' | ')} |`
  const [head, ...body] = cells
  return [line(head!), `| ${Array<string>(width).fill('---').join(' | ')} |`, ...body.map(line)].join('\n')
}

/** Convert HTML (e.g. mammoth output) to Markdown. */
export function htmlToMarkdown(html: string): string {
  const root = parseHtml(html)
  const md = blocksMd(root.children).join('\n\n').trim()
  return md ? `${md}\n` : ''
}
