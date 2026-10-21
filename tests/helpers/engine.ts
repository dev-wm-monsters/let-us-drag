// Helpers to drive the engine in tests.
//
// NOTE: htmlToPdf is a FAKE here (pdf-lib generated, one page per call). It only proves the
// engine hands sanitized HTML to the adapter and stores the returned bytes. Real Chromium
// rendering (printToPDF) is covered by the Electron E2E tests (tests/e2e), not by these tests.
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EngineAdapters } from '../../src/engine/api'
import { createEngine, type EngineRuntimeOptions } from '../../src/engine/index'
import type { JobError, JobEvent, OptionId } from '../../src/shared/types'

export interface FakePdfAdapter extends EngineAdapters {
  calls: string[]
}

export function fakeHtmlToPdf(): FakePdfAdapter {
  const calls: string[] = []
  return {
    calls,
    async htmlToPdf(html: string): Promise<Uint8Array> {
      calls.push(html)
      const { PDFDocument, StandardFonts } = await import('pdf-lib')
      const doc = await PDFDocument.create()
      const page = doc.addPage([595, 842])
      const font = await doc.embedFont(StandardFonts.Helvetica)
      page.drawText(`fake render: ${html.length} chars`, { x: 40, y: 800, size: 12, font })
      return doc.save()
    }
  }
}

export interface JobOutcome {
  events: JobEvent[]
  outputPaths: string[]
  error: JobError | undefined
}

export async function runOption(
  optionId: OptionId,
  inputPaths: string[],
  opts: { options?: Partial<EngineRuntimeOptions>; adapters?: EngineAdapters; signal?: AbortSignal; onEvent?: (e: JobEvent) => void } = {}
): Promise<JobOutcome> {
  const engine = createEngine(opts.adapters ?? fakeHtmlToPdf(), { cacheDir: opts.options?.cacheDir ?? join(tmpdir(), 'lud-test-model-cache'), ...opts.options })
  const events: JobEvent[] = []
  await engine.run(
    { id: randomUUID(), optionId, inputPaths },
    (e) => {
      events.push(e)
      opts.onEvent?.(e)
    },
    opts.signal ?? new AbortController().signal
  )
  const last = events[events.length - 1]
  return {
    events,
    outputPaths: last?.type === 'done' ? last.outputPaths : [],
    error: last?.type === 'error' ? last.error : undefined
  }
}

/** Run and expect success; throws a readable error otherwise. */
export async function convertOk(optionId: OptionId, inputPaths: string[], opts: Parameters<typeof runOption>[2] = {}): Promise<string[]> {
  const res = await runOption(optionId, inputPaths, opts)
  if (res.error) throw new Error(`${optionId} failed: ${res.error.code} ${res.error.message} ${res.error.detail ?? ''}`)
  return res.outputPaths
}
