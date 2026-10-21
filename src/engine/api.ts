// Engine contract. Contract owner: TPM. The engine is pure Node (no `electron` import).
import type { JobEvent, JobRequest } from '../shared/types'

/** Limits and scale for rasterising PDF pages (see EngineAdapters.renderPdfPages). */
export interface PdfRenderOptions {
  /** Scale relative to 72 dpi (the engine asks for 2). */
  scale: number
  /** Never produce a page wider/taller than this many pixels (scale down that page instead). */
  maxSide: number
  /** Never produce a page with more pixels than this (scale down that page instead). */
  maxPixels: number
}

export interface EngineAdapters {
  /** Render an HTML document to PDF bytes (provided by main via Chromium printToPDF). */
  htmlToPdf(html: string): Promise<Uint8Array>
  /**
   * ADDITIVE (engine dev, 2026-10-21) — optional: rasterise every page of a PDF to PNG with
   * Chromium (e.g. pdf.js in a hidden, sandboxed window), one PNG per page, in page order, on a
   * white background. Needed inside Electron: @napi-rs/canvas crashes Electron's V8 memory cage
   * (verified: SIGTRAP on require() in Electron 45), so the engine can only rasterise PDFs by
   * itself in plain Node (tests). Without this adapter, PDF → PNG/JPG fails with TOOL_MISSING in the app.
   */
  renderPdfPages?(pdf: Uint8Array, opts: PdfRenderOptions): Promise<Uint8Array[]>
}

export interface EngineOptions {
  /** Directory for downloaded models/caches (app.getPath('userData')/models in the app). */
  cacheDir: string
  /** Absolute path to ffmpeg, if known. Otherwise the engine resolves it (see PLAN §3.8). */
  ffmpegPath?: string
  /** Directory with packaged resources (process.resourcesPath in the app). */
  resourcesDir?: string
}

export interface Engine {
  /** Run one job. Emits events through onEvent; resolves when the job is done/failed/cancelled. */
  run(req: JobRequest, onEvent: (e: JobEvent) => void, signal: AbortSignal): Promise<void>
}

/** Optional host-side adapters a host can declare in 'init' (ADDITIVE). htmlToPdf is always assumed. */
export type HostAdapterName = 'renderPdfPages'

/** Messages between main (engine-host) and the utilityProcess (engine worker). */
export type HostToWorker =
  | { type: 'init'; options: EngineOptions; /** ADDITIVE: optional adapters the host serves. */ hostAdapters?: HostAdapterName[] }
  | { type: 'run'; req: JobRequest }
  | { type: 'cancel'; jobId: string }
  | { type: 'htmlToPdf:result'; requestId: string; pdf?: Uint8Array; error?: string }
  /** ADDITIVE: answer to a 'renderPdf' request (one PNG per page). */
  | { type: 'renderPdf:result'; requestId: string; pages?: Uint8Array[]; error?: string }

export type WorkerToHost =
  | { type: 'ready' }
  | { type: 'event'; event: JobEvent }
  | { type: 'htmlToPdf'; requestId: string; html: string }
  /** ADDITIVE: only sent when the host declared 'renderPdfPages' in init.hostAdapters. */
  | { type: 'renderPdf'; requestId: string; pdf: Uint8Array; options: PdfRenderOptions }
