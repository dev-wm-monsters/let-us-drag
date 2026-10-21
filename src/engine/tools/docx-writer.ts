// HTML tree → DOCX with the `docx` package.
// Supported: headings h1–h6, paragraphs, bold/italic/strikethrough/inline code, links (http/https/
// mailto), line breaks, bullet + numbered lists (nested up to 9 levels), code blocks (monospace),
// block quotes (indented), horizontal rules, simple tables (text only).
// Not supported (documented): images (replaced by their alt text), colours/fonts/CSS, merged table
// cells, footnotes, page layout.
import type { Paragraph as DocxParagraph, ParagraphChild, Table as DocxTable } from 'docx'
import { parseHtml, textContent, type ElementNode, type HtmlNode } from './html'

type Docx = typeof import('docx')

interface RunStyle {
  bold?: boolean
  italics?: boolean
  strike?: boolean
  code?: boolean
  link?: string
}

const MONO = 'Courier New'
const NUMBERING_REF = 'lud-numbered'
const SKIP = new Set(['script', 'style', 'head', 'title', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'select', 'button'])
const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer',
  'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table',
  'tr', 'ul', 'caption', 'details', 'summary', 'thead', 'tbody', 'tfoot'
])

function safeLink(href: string | undefined): string | undefined {
  if (!href) return undefined
  const h = href.trim()
  return /^(https?:|mailto:)/i.test(h) ? h : undefined
}

class Builder {
  private listInstance = 0
  readonly blocks: (DocxParagraph | DocxTable)[] = []

  constructor(private readonly d: Docx) {}

  runs(nodes: readonly HtmlNode[], style: RunStyle = {}): ParagraphChild[] {
    const { TextRun, ExternalHyperlink } = this.d
    const out: ParagraphChild[] = []
    const text = (t: string, s: RunStyle): void => {
      if (!t) return
      const run = new TextRun({
        text: t,
        bold: s.bold,
        italics: s.italics,
        strike: s.strike,
        font: s.code ? MONO : undefined,
        style: s.link ? 'Hyperlink' : undefined
      })
      out.push(s.link ? new ExternalHyperlink({ link: s.link, children: [run] }) : run)
    }
    const walk = (n: HtmlNode, s: RunStyle): void => {
      if (n.type === 'text') {
        text(s.code ? n.text : n.text.replace(/[ \t\r\n\f]+/g, ' '), s)
        return
      }
      if (SKIP.has(n.name)) return
      switch (n.name) {
        case 'br':
          out.push(new TextRun({ text: '', break: 1 }))
          return
        case 'img': {
          const alt = n.attrs['alt']
          if (alt) text(`[${alt}]`, s)
          return
        }
        case 'strong':
        case 'b':
          n.children.forEach((c) => walk(c, { ...s, bold: true }))
          return
        case 'em':
        case 'i':
          n.children.forEach((c) => walk(c, { ...s, italics: true }))
          return
        case 's':
        case 'del':
        case 'strike':
          n.children.forEach((c) => walk(c, { ...s, strike: true }))
          return
        case 'code':
        case 'kbd':
        case 'samp':
          n.children.forEach((c) => walk(c, { ...s, code: true }))
          return
        case 'a': {
          const link = safeLink(n.attrs['href'])
          n.children.forEach((c) => walk(c, link ? { ...s, link } : s))
          return
        }
        default:
          n.children.forEach((c) => walk(c, s))
      }
    }
    nodes.forEach((n) => walk(n, style))
    // Trim leading/trailing whitespace-only text at paragraph edges.
    return out
  }

  paragraph(children: ParagraphChild[], opts: Record<string, unknown> = {}): void {
    if (children.length === 0 && Object.keys(opts).length === 0) return
    this.blocks.push(new this.d.Paragraph({ children, ...opts }))
  }

  /** Emit block-level content for a list of nodes. */
  blocksFrom(nodes: readonly HtmlNode[], ctx: { indent?: number } = {}): void {
    let inline: HtmlNode[] = []
    const flush = (): void => {
      if (inline.some((n) => textContent(n).trim() !== '' || (n.type === 'element' && (n.name === 'br' || n.name === 'img')))) {
        this.paragraph(this.runs(inline), ctx.indent ? { indent: { left: ctx.indent } } : {})
      }
      inline = []
    }
    for (const n of nodes) {
      if (n.type === 'text' || !BLOCK.has(n.name)) {
        if (n.type === 'element' && SKIP.has(n.name)) continue
        inline.push(n)
        continue
      }
      flush()
      this.block(n, ctx)
    }
    flush()
  }

  block(n: ElementNode, ctx: { indent?: number }): void {
    const { HeadingLevel, Paragraph, TextRun, BorderStyle } = this.d
    const name = n.name
    const indentOpt = ctx.indent ? { indent: { left: ctx.indent } } : {}
    if (/^h[1-6]$/.test(name)) {
      const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]
      this.paragraph(this.runs(n.children), { heading: levels[Number(name[1]) - 1], ...indentOpt })
      return
    }
    switch (name) {
      case 'ul':
      case 'ol':
        this.list(n, 0)
        return
      case 'li':
        this.list({ type: 'element', name: 'ul', attrs: {}, children: [n] }, 0)
        return
      case 'pre': {
        const lines = textContent(n).replace(/\n$/, '').split(/\r?\n/)
        for (const line of lines) {
          this.blocks.push(new Paragraph({ children: [new TextRun({ text: line, font: MONO })], ...indentOpt }))
        }
        return
      }
      case 'blockquote':
        this.blocksFrom(n.children, { indent: (ctx.indent ?? 0) + 720 })
        return
      case 'hr':
        this.blocks.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'auto', space: 1 } } }))
        return
      case 'table':
      case 'thead':
      case 'tbody':
      case 'tfoot':
      case 'tr':
        this.table(n)
        return
      default:
        this.blocksFrom(n.children, ctx)
    }
  }

  list(listEl: ElementNode, level: number): void {
    const ordered = listEl.name === 'ol'
    const instance = ++this.listInstance
    const lvl = Math.min(level, 8)
    for (const item of listEl.children) {
      if (item.type !== 'element') continue
      if (item.name === 'ul' || item.name === 'ol') {
        this.list(item, level + 1)
        continue
      }
      if (item.name !== 'li') continue
      const inline: HtmlNode[] = []
      const nested: ElementNode[] = []
      const collect = (nodes: readonly HtmlNode[]): void => {
        for (const c of nodes) {
          if (c.type === 'element' && (c.name === 'ul' || c.name === 'ol')) nested.push(c)
          else if (c.type === 'element' && c.name === 'p') {
            if (inline.length > 0) inline.push({ type: 'element', name: 'br', attrs: {}, children: [] })
            collect(c.children)
          } else inline.push(c)
        }
      }
      collect(item.children)
      const opts = ordered ? { numbering: { reference: NUMBERING_REF, level: lvl, instance } } : { bullet: { level: lvl } }
      this.blocks.push(new this.d.Paragraph({ children: this.runs(inline), ...opts }))
      nested.forEach((l) => this.list(l, level + 1))
    }
  }

  table(n: ElementNode): void {
    const { Table, TableRow, TableCell, Paragraph, WidthType } = this.d
    const rows: ElementNode[] = []
    const collect = (el: ElementNode): void => {
      for (const c of el.children) {
        if (c.type !== 'element') continue
        if (c.name === 'tr') rows.push(c)
        else if (c.name === 'thead' || c.name === 'tbody' || c.name === 'tfoot') collect(c)
      }
    }
    if (n.name === 'tr') rows.push(n)
    else collect(n)
    const cellRows = rows
      .map((r) => r.children.filter((c): c is ElementNode => c.type === 'element' && (c.name === 'td' || c.name === 'th')))
      .filter((cells) => cells.length > 0)
    if (cellRows.length === 0) return
    const width = Math.max(...cellRows.map((r) => r.length))
    const docRows = cellRows.map(
      (cells) =>
        new TableRow({
          children: Array.from({ length: width }, (_, i) => {
            const c = cells[i]
            const children = c ? this.runs(c.children, c.name === 'th' ? { bold: true } : {}) : []
            return new TableCell({ children: [new Paragraph({ children })] })
          })
        })
    )
    this.blocks.push(new Table({ rows: docRows, width: { size: 100, type: WidthType.PERCENTAGE } }))
    this.blocks.push(new Paragraph({ children: [] }))
  }
}

/** Convert HTML to a .docx file. */
export async function htmlToDocx(html: string, title: string): Promise<Buffer> {
  const d = await import('docx')
  const root = parseHtml(html)
  const b = new Builder(d)
  b.blocksFrom(root.children)
  if (b.blocks.length === 0) b.blocks.push(new d.Paragraph({ children: [] }))
  const doc = new d.Document({
    title,
    creator: 'Let us drag!',
    numbering: {
      config: [
        {
          reference: NUMBERING_REF,
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: d.LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: d.AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } }
          }))
        }
      ]
    },
    sections: [{ children: b.blocks }]
  })
  return d.Packer.toBuffer(doc)
}

/** Plain text → DOCX: one paragraph per line. */
export function plainTextToDocxHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => (line.trim() === '' ? '<p><br></p>' : `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`))
    .join('\n')
}
