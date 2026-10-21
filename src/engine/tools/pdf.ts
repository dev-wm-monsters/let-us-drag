// PDF tools: pages → PNG/JPG, text extraction (pdfjs-dist legacy build), merging (pdf-lib).
// pdfjs runs in-process (Node has no web workers): we pre-load its worker module into
// globalThis.pdfjsWorker, which pdfjs uses as the "fake worker" handler.
//
// Electron caveats (verified with Electron 45 on Linux):
//  - @napi-rs/canvas crashes the process on require() (V8 memory cage / external buffers), so
//    inside Electron pages are rasterised by the host through EngineAdapters.renderPdfPages.
//  - pdfjs decides "am I Node?" once at import time and answers "no" in a utilityProcess
//    (process.type === 'utility'), then expects a DOM. We import it while presenting Node mode
//    and with @napi-rs/canvas blocked, which is enough for text extraction.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EngineAdapters, PdfRenderOptions } from '../api'
import { EngineError, errMessage, invalidInput, throwIfAborted } from '../errors'
import { packageDir } from '../resolve'
import { isPng } from './ico'

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type PdfDoc = Awaited<ReturnType<Pdfjs['getDocument']>['promise']>
type RenderParams = Parameters<Awaited<ReturnType<PdfDoc['getPage']>>['render']>[0]

/** Render scale: 2× of 72 dpi = 144 dpi. */
export const RENDER_SCALE = 2
/** Never allocate canvases beyond these limits (memory safety on huge pages). */
export const MAX_CANVAS_SIDE = 16_384
export const MAX_CANVAS_PIXELS = 50_000_000

export const PDF_RENDER_OPTIONS: PdfRenderOptions = { scale: RENDER_SCALE, maxSide: MAX_CANVAS_SIDE, maxPixels: MAX_CANVAS_PIXELS }

/** True inside any Electron process (main, utility, renderer). */
export function inElectron(): boolean {
  return typeof process.versions['electron'] === 'string'
}

let pdfjsPromise: Promise<Pdfjs> | undefined

async function importPdfjs(): Promise<Pdfjs> {
  const g = globalThis as { pdfjsWorker?: unknown }
  if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  return import('pdfjs-dist/legacy/build/pdf.mjs')
}

/** Import pdfjs in "Node mode" inside an Electron utilityProcess without loading @napi-rs/canvas. */
async function importPdfjsInElectron(): Promise<Pdfjs> {
  const typeDesc = Object.getOwnPropertyDescriptor(process, 'type')
  const getBuiltin = process.getBuiltinModule
  const consoleLog = console.log
  try {
    if (typeDesc?.configurable) Object.defineProperty(process, 'type', { value: 'browser', configurable: true, enumerable: typeDesc.enumerable ?? true })
    process.getBuiltinModule = ((id: string) => {
      const mod = getBuiltin.call(process, id)
      if (id !== 'module' && id !== 'node:module') return mod
      const real = mod as typeof import('node:module')
      return {
        ...real,
        createRequire(from: string | URL) {
          const req = real.createRequire(from)
          const guarded = ((request: string) => {
            if (request === '@napi-rs/canvas') throw new Error('@napi-rs/canvas is disabled inside Electron')
            return req(request)
          }) as NodeJS.Require
          return Object.assign(guarded, { resolve: req.resolve, cache: req.cache, main: req.main, extensions: req.extensions })
        }
      }
    }) as typeof process.getBuiltinModule
    console.log = () => undefined // pdfjs warns about the missing canvas polyfills at import time
    return await importPdfjs()
  } finally {
    console.log = consoleLog
    process.getBuiltinModule = getBuiltin
    if (typeDesc) Object.defineProperty(process, 'type', typeDesc)
  }
}

async function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= inElectron() ? importPdfjsInElectron() : importPdfjs()
  return pdfjsPromise
}

function assetDir(sub: string): string {
  // pdfjs reads these with fs in Node; it concatenates file names, so a trailing separator is required.
  return join(packageDir('pdfjs-dist'), sub) + (process.platform === 'win32' ? '\\' : '/')
}

/** Scale for a page so the canvas stays within the limits. */
export function fitScale(width: number, height: number, scale = RENDER_SCALE): number {
  let s = scale
  if (width * s > MAX_CANVAS_SIDE) s = MAX_CANVAS_SIDE / width
  if (height * s > MAX_CANVAS_SIDE) s = Math.min(s, MAX_CANVAS_SIDE / height)
  const px = width * s * height * s
  if (px > MAX_CANVAS_PIXELS) s *= Math.sqrt(MAX_CANVAS_PIXELS / px)
  return s
}

async function openPdf(path: string): Promise<PdfDoc> {
  const pdfjs = await loadPdfjs()
  const data = new Uint8Array(await readFile(path))
  const task = pdfjs.getDocument({
    data,
    standardFontDataUrl: assetDir('standard_fonts'),
    cMapUrl: assetDir('cmaps'),
    cMapPacked: true,
    wasmUrl: assetDir('wasm'),
    iccUrl: assetDir('iccs'),
    useSystemFonts: false,
    verbosity: 0
  })
  try {
    return await task.promise
  } catch (err) {
    await task.destroy().catch(() => undefined)
    const name = (err as { name?: string }).name
    if (name === 'PasswordException') throw invalidInput('This PDF is password-protected, so I cannot open it.', err)
    throw invalidInput("I couldn't open this PDF. It may be damaged.", err)
  }
}

export interface RenderedPage {
  index: number
  png: Buffer
}

/** Render every page to PNG, one at a time (low memory). */
export async function renderPdfPages(
  path: string,
  signal: AbortSignal,
  onPage: (page: RenderedPage, total: number) => Promise<void>,
  hostRender?: EngineAdapters['renderPdfPages']
): Promise<number> {
  if (hostRender) return renderWithHost(path, signal, onPage, hostRender)
  if (inElectron()) {
    throw new EngineError('TOOL_MISSING', "Turning PDF pages into pictures isn't available in this version yet.", 'no renderPdfPages adapter inside Electron')
  }
  const { createCanvas } = await import('@napi-rs/canvas')
  const doc = await openPdf(path)
  try {
    const total = doc.numPages
    for (let i = 1; i <= total; i++) {
      throwIfAborted(signal)
      const page = await doc.getPage(i)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: fitScale(base.width, base.height) })
      const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      try {
        await page.render({
          canvas: canvas as unknown as RenderParams['canvas'],
          canvasContext: ctx as unknown as RenderParams['canvasContext'],
          viewport
        }).promise
      } catch (err) {
        throw new EngineError('TOOL_FAILED', `I couldn't draw page ${i} of this PDF.`, errMessage(err))
      }
      const png = await canvas.encode('png')
      page.cleanup()
      await onPage({ index: i, png }, total)
    }
    return total
  } finally {
    await doc.loadingTask.destroy().catch(() => undefined)
  }
}

async function renderWithHost(
  path: string,
  signal: AbortSignal,
  onPage: (page: RenderedPage, total: number) => Promise<void>,
  hostRender: NonNullable<EngineAdapters['renderPdfPages']>
): Promise<number> {
  const bytes = new Uint8Array(await readFile(path))
  if (!/^%PDF-/.test(Buffer.from(bytes.subarray(0, 1024)).toString('latin1').trimStart())) {
    throw invalidInput("I couldn't open this PDF. It may be damaged.")
  }
  const pages = await hostRender(bytes, PDF_RENDER_OPTIONS)
  throwIfAborted(signal)
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every((p) => p instanceof Uint8Array && isPng(p))) {
    throw new EngineError('TOOL_FAILED', "I couldn't draw the pages of this PDF.", 'renderPdfPages returned no PNG pages')
  }
  for (let i = 0; i < pages.length; i++) {
    throwIfAborted(signal)
    const p = pages[i]!
    await onPage({ index: i + 1, png: Buffer.from(p.buffer, p.byteOffset, p.byteLength) }, pages.length)
  }
  return pages.length
}

/** Extract text, one block per page separated by a blank line. */
export async function pdfToText(path: string, signal: AbortSignal, onProgress?: (p: number) => void): Promise<string> {
  const doc = await openPdf(path)
  try {
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      throwIfAborted(signal)
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items) {
        if ('str' in item) {
          text += item.str
          if (item.hasEOL) text += '\n'
        }
      }
      pages.push(text.replace(/[ \t]+\n/g, '\n').trim())
      page.cleanup()
      onProgress?.(i / doc.numPages)
    }
    return pages.join('\n\n') + '\n'
  } finally {
    await doc.loadingTask.destroy().catch(() => undefined)
  }
}

/** Merge PDFs in the given order. */
export async function mergePdfs(paths: readonly string[], signal: AbortSignal, onEach?: (i: number) => void): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib')
  const out = await PDFDocument.create()
  out.setProducer('Let us drag!')
  for (let i = 0; i < paths.length; i++) {
    throwIfAborted(signal)
    onEach?.(i)
    let src
    try {
      src = await PDFDocument.load(await readFile(paths[i]!), { updateMetadata: false })
    } catch (err) {
      if ((err as { name?: string }).name === 'EncryptedPDFError' || /encrypted/i.test(errMessage(err))) {
        throw invalidInput('One of these PDFs is password-protected, so I cannot merge it.', err)
      }
      throw invalidInput("I couldn't open one of these PDFs. It may be damaged.", err)
    }
    const pages = await out.copyPages(src, src.getPageIndices())
    pages.forEach((p) => out.addPage(p))
  }
  return out.save()
}

