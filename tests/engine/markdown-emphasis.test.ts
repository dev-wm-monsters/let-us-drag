// B-054 / QA3-09: HTML → Markdown keeps word boundaries between emphasis runs, and every emphasis
// span renders as emphasis again (checked by parsing the Markdown back with marked, CommonMark/GFM).
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { marked } from 'marked'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { htmlToMarkdown, parseHtml, textContent } from '../../src/engine/tools/html'
import { docxFile, makeTempDir } from '../helpers/fixtures'
import { convertOk } from '../helpers/engine'

/** Markdown → inline HTML (one paragraph). */
const render = (md: string): string => marked.parseInline(md.trim(), { async: false })
/** Visible text of rendered HTML. */
const visible = (html: string): string => textContent(parseHtml(html))

describe('emphasis keeps word boundaries (QA3-09)', () => {
  const cases: [html: string, md: string, rendered: string][] = [
    // the QA repro: mammoth puts the space at the start of the italic run
    ['<p>Revenue was <strong>great</strong><em> this time.</em></p>', 'Revenue was **great** *this time.*', 'Revenue was <strong>great</strong> <em>this time.</em>'],
    // the space at the end of the bold run
    ['<p>Revenue was <strong>great </strong><em>this time.</em></p>', 'Revenue was **great** *this time.*', 'Revenue was <strong>great</strong> <em>this time.</em>'],
    ['<p>a <strong> b </strong> c</p>', 'a **b** c', 'a <strong>b</strong> c'],
    ['<p>a<em> </em>b</p>', 'a b', 'a b'],
    ['<p>x<del> gone</del>y</p>', 'x ~~gone~~y', 'x <del>gone</del>y']
  ]
  it.each(cases)('%s', (html, md, rendered) => {
    expect(htmlToMarkdown(html)).toBe(`${md}\n`)
    expect(render(md)).toBe(rendered)
  })
})

describe('emphasis that Markdown delimiters cannot express falls back to inline HTML', () => {
  const cases: [html: string, rendered: string][] = [
    // runs that touch without a space (formatting change inside a word)
    ['<p><strong>great</strong><em>this</em></p>', '<strong>great</strong><em>this</em>'],
    ['<p><del>gone</del><strong>bold</strong></p>', '<del>gone</del><strong>bold</strong>'],
    // punctuation at the edge next to a letter: "**great!**word" is not emphasis in CommonMark
    ['<p><strong>great!</strong>word</p>', '<strong>great!</strong>word'],
    ['<p>x<em>!wow</em></p>', 'x<em>!wow</em>'],
    ['<p>say<strong>"hi"</strong>now</p>', 'say<strong>&quot;hi&quot;</strong>now'],
    // nesting
    ['<p><strong><em>x</em></strong>y</p>', '<strong><em>x</em></strong>y'],
    ['<p>a <strong>b <em>c</em></strong> d</p>', 'a <strong>b <em>c</em></strong> d']
  ]
  it.each(cases)('%s', (html, rendered) => {
    const md = htmlToMarkdown(html)
    expect(visible(render(md))).toBe(visible(rendered))
    // same emphasis structure: compare the tags in order
    const tags = (h: string): string[] => h.match(/<\/?(strong|em|del)>/g) ?? []
    expect(tags(render(md)), md).toEqual(tags(rendered))
  })

  it('ordinary emphasis still uses Markdown delimiters', () => {
    expect(htmlToMarkdown('<p>Some <strong>bold</strong>, <em>italic</em> and <del>old</del>.</p>')).toBe('Some **bold**, *italic* and ~~old~~.\n')
    expect(htmlToMarkdown('<p>in<strong>word</strong>bold</p>')).toBe('in**word**bold\n')
  })
})

describe('DOCX → Markdown end to end (QA CAT-DOC-MD)', () => {
  let dir = ''
  let cleanup: () => Promise<void> = async () => undefined
  beforeAll(async () => {
    ;({ dir, cleanup } = await makeTempDir('lud-md-emph-'))
  })
  afterAll(() => cleanup())

  it('"Revenue was great this time." keeps its spaces', async () => {
    const docx = await docxFile(join(dir, 'report.docx'))
    const [out] = await convertOk('to-md', [docx])
    const md = await readFile(out!, 'utf8')
    expect(md).toContain('Revenue was **great** *this time.*')
    const line = md.split('\n').find((l) => l.startsWith('Revenue'))!
    expect(visible(render(line))).toBe('Revenue was great this time.')
  })
})
