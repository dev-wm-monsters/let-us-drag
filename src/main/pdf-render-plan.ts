// Pure helpers for the renderPdfPages host adapter (pdf-render.ts). No electron import.

import type { PdfRenderOptions } from '../engine/api'

/** Hard host-side caps, applied on top of the engine's PdfRenderOptions. */
export const PDF_MAX_PAGES = 1_000
/** Total PNG bytes returned for one document (everything is sent to the engine in one message). */
export const PDF_MAX_TOTAL_BYTES = 1024 * 1024 * 1024
/** Absolute ceilings in case the engine asks for more (Chromium's own canvas limits are higher). */
export const PDF_ABS_MAX_SIDE = 16_384
export const PDF_ABS_MAX_PIXELS = 100_000_000
/** Images inside the PDF larger than this (pixels) are not decoded by pdf.js. */
export const PDF_MAX_IMAGE_PIXELS = 100_000_000

export interface PagePlan {
  scale: number
  width: number
  height: number
}

/** Clamp the engine's options to sane values (never trust numbers that crossed a process boundary). */
export function clampRenderOptions(o: PdfRenderOptions): PdfRenderOptions {
  const num = (v: unknown, fallback: number, max: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, max) : fallback
  return {
    scale: num(o.scale, 2, 8),
    maxSide: Math.floor(num(o.maxSide, PDF_ABS_MAX_SIDE, PDF_ABS_MAX_SIDE)),
    maxPixels: Math.floor(num(o.maxPixels, 50_000_000, PDF_ABS_MAX_PIXELS))
  }
}

/**
 * Scale + canvas size for a page of `width`×`height` PDF points (at scale 1), so the canvas stays
 * within maxSide (each side) and maxPixels (area). Returns null for nonsense sizes.
 */
export function planPage(width: number, height: number, opts: PdfRenderOptions): PagePlan | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const o = clampRenderOptions(opts)
  let s = o.scale
  if (width * s > o.maxSide) s = o.maxSide / width
  if (height * s > o.maxSide) s = Math.min(s, o.maxSide / height)
  const px = width * s * height * s
  if (px > o.maxPixels) s *= Math.sqrt(o.maxPixels / px)
  const w = Math.min(o.maxSide, Math.max(1, Math.floor(width * s)))
  const h = Math.min(o.maxSide, Math.max(1, Math.floor(height * s)))
  if (!Number.isFinite(s) || s <= 0) return null
  return { scale: s, width: w, height: h }
}

/** One short line from whatever executeJavaScript rejected with (Error, or a cloned plain object). */
export function describeError(err: unknown): string {
  let msg = ''
  if (err instanceof Error) msg = err.message
  else if (err && typeof err === 'object') {
    const o = err as { name?: unknown; message?: unknown }
    msg = [o.name, o.message].filter((x) => typeof x === 'string' && x !== '').join(': ')
  } else msg = String(err)
  return (msg.split('\n')[0] ?? '').slice(0, 160) || 'unknown error'
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function isPngBytes(v: unknown): v is Uint8Array {
  return v instanceof Uint8Array && v.length > PNG_MAGIC.length && PNG_MAGIC.every((b, i) => v[i] === b)
}

/**
 * CSP for every response of the render window. pdf.js runs (scripts from our origin only), the
 * PDF never gets to run code: no eval (pdf.js 6 no longer has an eval path; CSP enforces it),
 * WebAssembly allowed for pdf.js's image decoders, no network beyond our own origin.
 */
export const PDF_RENDER_CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' blob: data:; font-src 'self' blob: data:; style-src 'unsafe-inline'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"

export const PDF_RENDER_HOST = 'pdf'

/** The page that hosts pdf.js. */
export const PDF_RENDER_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PDF_RENDER_CSP}"><title>pdf</title><script type="module" src="./render.mjs"></script></head><body></body></html>`

/**
 * The page script. It exposes `globalThis.__ludPdf` to main (called with executeJavaScript).
 * The document bytes are fetched from our own origin (main serves them only during the job).
 * pdf.js options: no XFA, no system fonts, local font/cmap/wasm data, a cap on embedded image size,
 * no annotation scripting (we only call page.render, never the annotation/scripting layers).
 */
export const PDF_RENDER_SCRIPT = `
import * as pdfjs from './pdfjs/build/pdf.mjs'
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdfjs/build/pdf.worker.mjs', import.meta.url).href
const base = new URL('./pdfjs/', import.meta.url).href
let task = null
let doc = null
async function close() {
  const t = task
  task = null
  doc = null
  if (t) await t.destroy().catch(() => undefined)
}
async function open(url, maxImageSize) {
  await close()
  const res = await fetch(url)
  if (!res.ok) throw new Error('document not available')
  const data = new Uint8Array(await res.arrayBuffer())
  task = pdfjs.getDocument({
    data,
    cMapUrl: base + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: base + 'standard_fonts/',
    wasmUrl: base + 'wasm/',
    iccUrl: base + 'iccs/',
    useSystemFonts: false,
    enableXfa: false,
    isEvalSupported: false,
    maxImageSize,
    stopAtErrors: false,
    verbosity: 0
  })
  doc = await task.promise
  return doc.numPages
}
async function size(n) {
  const page = await doc.getPage(n)
  const v = page.getViewport({ scale: 1 })
  return { width: v.width, height: v.height }
}
async function render(n, scale, width, height) {
  const page = await doc.getPage(n)
  const canvas = document.createElement('canvas')
  try {
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { alpha: false })
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    const viewport = page.getViewport({ scale })
    await page.render({ canvas, viewport, background: '#ffffff' }).promise
    const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/png'))
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    canvas.width = 0
    canvas.height = 0
    page.cleanup()
  }
}
// executeJavaScript turns non-Error rejections (pdf.js exceptions) into "[object Object]".
const safe = (fn) => async (...args) => {
  try {
    return await fn(...args)
  } catch (e) {
    throw new Error(String((e && e.name) || 'Error') + ': ' + String((e && e.message) || e).slice(0, 200))
  }
}
globalThis.__ludPdf = Object.freeze({ open: safe(open), size: safe(size), render: safe(render), close: safe(close) })
`
