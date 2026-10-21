// Integration: PDF options (pdfjs-dist + @napi-rs/canvas rendering, text extraction, pdf-lib merge).
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { fitScale, MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE, PDFJS_DOCUMENT_OPTIONS, pdfjsAssetOptions, pdfjsAssetUrl } from '../../src/engine/tools/pdf'
import { MAGIC, makeTempDir, pdfFile, startsWith } from '../helpers/fixtures'
import { convertOk, runOption } from '../helpers/engine'

let dir = ''
let cleanup: () => Promise<void> = async () => undefined

beforeAll(async () => {
  ;({ dir, cleanup } = await makeTempDir('lud-pdf-'))
})
afterAll(() => cleanup())

describe('fitScale', () => {
  it('keeps 2x for normal pages and caps huge ones', () => {
    expect(fitScale(612, 792)).toBe(2)
    const s = fitScale(14_400, 14_400)
    expect(14_400 * s).toBeLessThanOrEqual(MAX_CANVAS_SIDE)
    expect((14_400 * s) ** 2).toBeLessThanOrEqual(MAX_CANVAS_PIXELS * 1.0001)
  })
})

describe('pdf.js data-folder URLs (B-016, B-017)', () => {
  const WIN_ROOT = 'D:\\a\\let-us-drag\\let-us-drag\\node_modules\\pdfjs-dist'

  it('win32: backslashes become "/", always a trailing "/", extended-length prefixes dropped', () => {
    expect(pdfjsAssetUrl(`${WIN_ROOT}\\cmaps`, 'win32')).toBe('D:/a/let-us-drag/let-us-drag/node_modules/pdfjs-dist/cmaps/')
    expect(pdfjsAssetUrl(`${WIN_ROOT}\\cmaps\\`, 'win32')).toBe('D:/a/let-us-drag/let-us-drag/node_modules/pdfjs-dist/cmaps/')
    expect(pdfjsAssetUrl('\\\\server\\share\\app\\cmaps', 'win32')).toBe('//server/share/app/cmaps/')
    expect(pdfjsAssetUrl('\\\\?\\C:\\Program Files\\App\\cmaps', 'win32')).toBe('C:/Program Files/App/cmaps/')
    expect(pdfjsAssetUrl('\\\\?\\UNC\\server\\share\\cmaps', 'win32')).toBe('//server/share/cmaps/')
  })

  it('POSIX: unchanged apart from the trailing "/" (a backslash is a normal file-name character there)', () => {
    expect(pdfjsAssetUrl('/opt/app/node_modules/pdfjs-dist/cmaps', 'linux')).toBe('/opt/app/node_modules/pdfjs-dist/cmaps/')
    expect(pdfjsAssetUrl('/Applications/Let us drag!.app/x\\y/wasm/', 'darwin')).toBe('/Applications/Let us drag!.app/x\\y/wasm/')
  })

  it('every option for a Windows install is a forward-slash path ending in "/"', () => {
    const opts = pdfjsAssetOptions(WIN_ROOT, 'win32')
    expect(opts).toEqual({
      standardFontDataUrl: 'D:/a/let-us-drag/let-us-drag/node_modules/pdfjs-dist/standard_fonts/',
      cMapUrl: 'D:/a/let-us-drag/let-us-drag/node_modules/pdfjs-dist/cmaps/',
      wasmUrl: 'D:/a/let-us-drag/let-us-drag/node_modules/pdfjs-dist/wasm/',
      iccUrl: 'D:/a/let-us-drag/let-us-drag/node_modules/pdfjs-dist/iccs/'
    })
  })

  it('on this machine, base + file name points at the real pdf.js data files (how pdf.js reads them in Node)', () => {
    const opts = pdfjsAssetOptions()
    for (const v of Object.values(opts)) expect(v.endsWith('/')).toBe(true)
    expect(existsSync(`${opts.cMapUrl}78-H.bcmap`)).toBe(true)
    expect(existsSync(`${opts.standardFontDataUrl}FoxitDingbats.pfb`)).toBe(true)
    expect(existsSync(`${opts.wasmUrl}openjpeg.wasm`)).toBe(true)
    expect(existsSync(`${opts.iccUrl}CGATS001Compat-v2-micro.icc`)).toBe(true)
  })

  it('pdf.js accepts the win32 options; the old backslash form is what CI rejected', async () => {
    const g = globalThis as { pdfjsWorker?: unknown }
    g.pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const winOpts = pdfjsAssetOptions(WIN_ROOT, 'win32')
    // The pre-fix value (join() + "\\") throws synchronously inside getDocument(): that was B-016,
    // and because it happened before the loading task existed it surfaced as INTERNAL (B-017).
    expect(() => pdfjs.getDocument({ data: new Uint8Array([1]), ...winOpts, cMapUrl: `${WIN_ROOT}\\cmaps\\` })).toThrow(/must include trailing slash/)

    const good = await readFile(await pdfFile(join(dir, 'win-opts.pdf'), 1))
    const task = pdfjs.getDocument({ data: new Uint8Array(good), ...PDFJS_DOCUMENT_OPTIONS, ...winOpts })
    expect((await task.promise).numPages).toBe(1)
    await task.destroy()

    // With the same options, a damaged PDF fails in the loading task (→ INPUT_INVALID), not in getDocument().
    const bad = pdfjs.getDocument({ data: new TextEncoder().encode('%PDF-1.7\nthis is garbage'), ...PDFJS_DOCUMENT_OPTIONS, ...winOpts })
    await expect(bad.promise).rejects.toMatchObject({ name: 'InvalidPDFException' })
    await bad.destroy()
  })
})

describe('pdf options', () => {
  it('PNG pages: multi-page → folder "name (pages)" with page-01.png …, rendered at 2x', async () => {
    const src = await pdfFile(join(dir, 'report.pdf'), 3)
    const [out] = await convertOk('pdf-to-png', [src])
    expect(basename(out!)).toBe('report (pages)')
    const files = (await readdir(out!)).sort()
    expect(files).toEqual(['page-01.png', 'page-02.png', 'page-03.png'])
    const buf = await readFile(join(out!, 'page-01.png'))
    expect(startsWith(buf, MAGIC.png)).toBe(true)
    const m = await sharp(buf).metadata()
    expect([m.width, m.height]).toEqual([600, 400])
    // text was actually drawn: the page is not blank white
    const stats = await sharp(buf).stats()
    expect(stats.channels[0]!.min).toBeLessThan(100)
  })

  it('JPG pages: single page → a single file next to the PDF', async () => {
    const src = await pdfFile(join(dir, 'one.pdf'), 1)
    const [out] = await convertOk('pdf-to-jpg', [src])
    expect(basename(out!)).toBe('one.jpg')
    const buf = await readFile(out!)
    expect(startsWith(buf, MAGIC.jpg)).toBe(true)
    expect((await sharp(buf).metadata()).format).toBe('jpeg')
    expect((await readdir(dir)).filter((f) => f.startsWith('.lud-'))).toEqual([])
  })

  it('TXT: extracts text per page', async () => {
    const src = await pdfFile(join(dir, 'text.pdf'), 2, 'Hello page')
    const [out] = await convertOk('to-txt', [src])
    expect(basename(out!)).toBe('text.txt')
    const txt = await readFile(out!, 'utf8')
    expect(txt).toContain('Hello page 1')
    expect(txt).toContain('Hello page 2')
    expect(txt.indexOf('Hello page 1')).toBeLessThan(txt.indexOf('Hello page 2'))
  })

  it('Merge: ≥ 2 PDFs → "first (merged).pdf" with all pages in order', async () => {
    const a = await pdfFile(join(dir, 'a.pdf'), 2, 'A')
    const b = await pdfFile(join(dir, 'b.pdf'), 3, 'B')
    const [out] = await convertOk('pdf-merge', [a, b])
    expect(basename(out!)).toBe('a (merged).pdf')
    const doc = await PDFDocument.load(await readFile(out!))
    expect(doc.getPageCount()).toBe(5)
  })

  it('Merge needs at least 2 inputs (UNSUPPORTED otherwise)', async () => {
    const a = await pdfFile(join(dir, 'solo.pdf'), 1)
    const res = await runOption('pdf-merge', [a])
    expect(res.error?.code).toBe('UNSUPPORTED')
  })

  it('uses the host renderPdfPages adapter when provided (how the Electron app rasterises)', async () => {
    const src = await pdfFile(join(dir, 'hosted.pdf'), 2)
    const calls: { bytes: number; scale: number }[] = []
    const page = await sharp({ create: { width: 10, height: 20, channels: 3, background: '#123456' } }).png().toBuffer()
    const adapters = {
      htmlToPdf: () => Promise.reject(new Error('unused')),
      renderPdfPages: async (pdf: Uint8Array, opts: { scale: number }) => {
        calls.push({ bytes: pdf.byteLength, scale: opts.scale })
        return [page, page]
      }
    }
    const [out] = await convertOk('pdf-to-jpg', [src], { adapters })
    expect(calls).toEqual([{ bytes: (await readFile(src)).byteLength, scale: 2 }])
    expect(basename(out!)).toBe('hosted (pages)')
    const files = (await readdir(out!)).sort()
    expect(files).toEqual(['page-01.jpg', 'page-02.jpg'])
    expect((await sharp(join(out!, 'page-02.jpg')).metadata()).format).toBe('jpeg')
    const bad = { ...adapters, renderPdfPages: async () => [new Uint8Array([1, 2, 3])] }
    expect((await runOption('pdf-to-png', [src], { adapters: bad })).error?.code).toBe('TOOL_FAILED')
  })

  it('a damaged PDF → INPUT_INVALID', async () => {
    const bad = join(dir, 'bad.pdf')
    await writeFile(bad, '%PDF-1.7\nthis is garbage')
    expect((await runOption('pdf-to-png', [bad])).error?.code).toBe('INPUT_INVALID')
    expect((await runOption('to-txt', [bad])).error?.code).toBe('INPUT_INVALID')
  })
})
