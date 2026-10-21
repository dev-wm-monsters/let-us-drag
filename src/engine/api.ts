// Engine contract. Contract owner: TPM. The engine is pure Node (no `electron` import).
import type { JobEvent, JobRequest } from '../shared/types'

export interface EngineAdapters {
  /** Render an HTML document to PDF bytes (provided by main via Chromium printToPDF). */
  htmlToPdf(html: string): Promise<Uint8Array>
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

/** Messages between main (engine-host) and the utilityProcess (engine worker). */
export type HostToWorker =
  | { type: 'init'; options: EngineOptions }
  | { type: 'run'; req: JobRequest }
  | { type: 'cancel'; jobId: string }
  | { type: 'htmlToPdf:result'; requestId: string; pdf?: Uint8Array; error?: string }

export type WorkerToHost =
  | { type: 'ready' }
  | { type: 'event'; event: JobEvent }
  | { type: 'htmlToPdf'; requestId: string; html: string }
