// Integration: document (DOCX) and text (md/txt/html) options.
// PDF output uses the FAKE htmlToPdf adapter (tests/helpers/engine.ts); these tests check what
// the engine sends to it (sanitized, self-contained HTML) and that the bytes are saved. Real
// Chromium rendering is exercised by the Electron E2E suite.
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RENDER_CSP } from '../../src/engine/tools/html'
import { MAGIC, SAMPLE_HTML, SAMPLE_MD, docxFile, makeTempDir, startsWith, textFile } from '../helpers/fixtures'
import { convertOk, fakeHtmlToPdf, runOption } from '../helpers/engine'

let dir = ''
let cleanup: () => Promise<void> = async () => undefined

beforeAll(async () => {
  ;({ dir, cleanup } = await makeTempDir('lud-doc-'))
})
afterAll(() => cleanup())

type Mammoth = { extractRawText(i: { path: string }): Promise<{ value: string }> }
async function docxText(path: string): Promise<string> {
  const mod = (await import('mammoth')) as unknown as Mammoth & { default?: Mammoth }
  return (mod.default ?? mod).extractRawText({ path }).then((r) => r.value)
}

describe('document (docx)', () => {
  let docx = ''
  beforeAll(async () => {
    docx = await docxFile(join(dir, 'report.docx'))
  })

  it('PDF via the htmlToPdf adapter', async () => {
    const adapter = fakeHtmlToPdf()
    const [out] = await convertOk('to-pdf', [docx], { adapters: adapter })
    expect(basename(out!)).toBe('report.pdf')
    expect(startsWith(await readFile(out!), MAGIC.pdf)).toBe(true)
    expect(adapter.calls).toHaveLength(1)
    const html = adapter.calls[0]!
    expect(html).toContain('Quarterly Report')
    expect(html).toContain('<strong>great</strong>')
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain('@page')
  })

  it('HTML', async () => {
    const [out] = await convertOk('to-html', [docx])
    expect(basename(out!)).toBe('report.html')
    const html = await readFile(out!, 'utf8')
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('<h1>Quarterly Report</h1>')
    expect(html).toContain('<table>')
  })

  it('Markdown', async () => {
    const [out] = await convertOk('to-md', [docx])
    expect(basename(out!)).toBe('report.md')
    const md = await readFile(out!, 'utf8')
    expect(md).toContain('# Quarterly Report')
    expect(md).toContain('**great**')
    expect(md).toContain('- First point')
    expect(md).toContain('| Region | Sales |')
  })

  it('TXT', async () => {
    const [out] = await convertOk('to-txt', [docx])
    const txt = await readFile(out!, 'utf8')
    expect(txt).toContain('Quarterly Report')
    expect(txt).toContain('Second point')
  })

  it('several DOCX → one merged PDF (to-pdf is a merge option)', async () => {
    const other = await docxFile(join(dir, 'other.docx'))
    const [out] = await convertOk('to-pdf', [docx, other])
    expect(basename(out!)).toBe('report (merged).pdf')
    expect((await PDFDocument.load(await readFile(out!))).getPageCount()).toBe(2)
  })

  it('a damaged DOCX → INPUT_INVALID', async () => {
    const bad = await textFile(join(dir, 'bad.docx'), 'not a zip')
    expect((await runOption('to-html', [bad])).error?.code).toBe('INPUT_INVALID')
  })

  it('adapter failure → TOOL_FAILED, no output left behind', async () => {
    const res = await runOption('to-pdf', [docx], { adapters: { htmlToPdf: () => Promise.reject(new Error('boom')) } })
    expect(res.error?.code).toBe('TOOL_FAILED')
  })
})

describe('text (md / txt / html)', () => {
  it('Markdown → HTML / DOCX / TXT / PDF', async () => {
    const md = await textFile(join(dir, 'notes.md'), SAMPLE_MD)
    const [html] = await convertOk('to-html', [md])
    expect(basename(html!)).toBe('notes.html')
    const h = await readFile(html!, 'utf8')
    expect(h).toContain('<h1>Title</h1>')
    expect(h).toContain('<strong>bold</strong>')
    expect(h).toContain('<table>')

    const [docx] = await convertOk('to-docx', [md])
    expect(basename(docx!)).toBe('notes.docx')
    expect(startsWith(await readFile(docx!), MAGIC.zip)).toBe(true)
    const text = await docxText(docx!)
    expect(text).toContain('Title')
    expect(text).toContain('nested')
    expect(text).toContain('const x = 1')

    const [txt] = await convertOk('to-txt', [md])
    const t = await readFile(txt!, 'utf8')
    expect(t).toContain('Title')
    expect(t).toContain('- one')
    expect(t).not.toContain('**')

    const adapter = fakeHtmlToPdf()
    const [pdf] = await convertOk('to-pdf', [md], { adapters: adapter })
    expect(basename(pdf!)).toBe('notes.pdf')
    expect(adapter.calls[0]).toContain('<h1>Title</h1>')
  })

  it('TXT → HTML / DOCX / PDF keeps line breaks', async () => {
    const src = await textFile(join(dir, 'plain.txt'), 'line one\nline <two> & more\n\nafter blank\n')
    const [html] = await convertOk('to-html', [src])
    expect(await readFile(html!, 'utf8')).toContain('<pre class="lud-plain">line one\nline &lt;two&gt; &amp; more')
    const [docx] = await convertOk('to-docx', [src])
    expect(await docxText(docx!)).toContain('line <two> & more')
    const adapter = fakeHtmlToPdf()
    await convertOk('to-pdf', [src], { adapters: adapter })
    expect(adapter.calls[0]).toContain('line &lt;two&gt;')
    expect((await runOption('to-txt', [src])).error?.code).toBe('UNSUPPORTED')
  })

  it('HTML → PDF: untrusted markup is sanitized before it reaches the renderer', async () => {
    const src = await textFile(join(dir, 'page.html'), SAMPLE_HTML)
    const adapter = fakeHtmlToPdf()
    const [pdf] = await convertOk('to-pdf', [src], { adapters: adapter })
    expect(basename(pdf!)).toBe('page.pdf')
    const sent = adapter.calls[0]!
    expect(sent).toContain('<h1>Hello HTML</h1>')
    expect(sent).not.toMatch(/<script/i)
    expect(sent).not.toMatch(/onload/i)
    expect(sent).not.toContain('evil.example')
    expect(sent).not.toMatch(/javascript:/i)
    expect(sent).toContain(`content="${RENDER_CSP}"`)
  })

  it('HTML → TXT / DOCX', async () => {
    const src = await textFile(join(dir, 'page2.htm'), SAMPLE_HTML)
    const [txt] = await convertOk('to-txt', [src])
    const t = await readFile(txt!, 'utf8')
    expect(t).toContain('Hello HTML')
    expect(t).toContain('- apple')
    expect(t).not.toContain('alert')
    const [docx] = await convertOk('to-docx', [src])
    const d = await docxText(docx!)
    expect(d).toContain('Hello HTML')
    expect(d).toContain('banana')
    expect(d).not.toContain('alert(1)')
    expect((await runOption('to-html', [src])).error?.code).toBe('UNSUPPORTED')
  })

  it('Markdown → HTML: hostile markup is sanitized and the file carries the no-network/no-script CSP (D17, F-17)', async () => {
    const hostile = [
      '# Safe heading',
      '',
      '<script>alert("md")</script>',
      '',
      '<img src="x" onerror="alert(2)"> and <IMG SRC=x ONERROR=alert(3)>',
      '',
      '<img src="https://evil.example/track.png" alt="tracker">',
      '',
      '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
      '',
      '<iframe src="https://evil.example/frame"></iframe>',
      '',
      '<p style="background:url(https://evil.example/bg.png)">styled</p>',
      '',
      '[click](javascript:alert(4)) and [web](https://example.com/ok)',
      '',
      '![remote](https://evil.example/md-image.png)',
      '',
      '<a href="#top" onclick="alert(5)">anchor</a>',
      ''
    ].join('\n')
    const md = await textFile(join(dir, 'hostile.md'), hostile)
    const [out] = await convertOk('to-html', [md])
    expect(basename(out!)).toBe('hostile.html')
    const h = await readFile(out!, 'utf8')
    expect(h).toContain('<h1>Safe heading</h1>')
    expect(h).toContain(`<meta http-equiv="Content-Security-Policy" content="${RENDER_CSP}">`)
    // the CSP meta must come before anything that could load (it only applies to later content)
    expect(h.indexOf('Content-Security-Policy')).toBeLessThan(h.indexOf('<body>'))
    expect(h).not.toMatch(/<script/i)
    expect(h).not.toMatch(/\son[a-z]+\s*=/i)
    expect(h).not.toMatch(/javascript:/i)
    expect(h).not.toContain('evil.example')
    expect(h).not.toMatch(/<iframe/i)
    expect(h).not.toMatch(/http-equiv="refresh"/i)
    expect(h.match(/http-equiv=/gi)).toHaveLength(1) // only our CSP
    expect(h).toContain('styled')
    expect(h).toContain('href="https://example.com/ok"') // plain web links stay clickable
    expect(h).toContain('href="#top"')
  })

  it('DOCX → HTML is sanitized the same way and carries the CSP (D17, F-17)', async () => {
    const d = await import('docx')
    const doc = new d.Document({
      sections: [
        {
          children: [
            new d.Paragraph({ children: [new d.TextRun('<script>alert("docx")</script> literal text')] }),
            new d.Paragraph({ children: [new d.ExternalHyperlink({ link: 'javascript:alert(6)', children: [new d.TextRun('bad link')] })] }),
            new d.Paragraph({ children: [new d.ExternalHyperlink({ link: 'https://example.com/ok', children: [new d.TextRun('good link')] })] })
          ]
        }
      ]
    })
    const src = join(dir, 'hostile.docx')
    await writeFile(src, await d.Packer.toBuffer(doc))
    const [out] = await convertOk('to-html', [src])
    const h = await readFile(out!, 'utf8')
    expect(h).toContain(`<meta http-equiv="Content-Security-Policy" content="${RENDER_CSP}">`)
    expect(h).not.toMatch(/<script/i)
    expect(h).toContain('&lt;script&gt;') // the document's TEXT is kept, escaped
    expect(h).not.toMatch(/javascript:/i)
    expect(h).toContain('bad link')
    expect(h).toContain('href="https://example.com/ok"')
  })

  it('several text files → one merged PDF', async () => {
    const a = await textFile(join(dir, 'm1.md'), '# one')
    const b = await textFile(join(dir, 'm2.txt'), 'two')
    const [out] = await convertOk('to-pdf', [a, b])
    expect(basename(out!)).toBe('m1 (merged).pdf')
  })
})
