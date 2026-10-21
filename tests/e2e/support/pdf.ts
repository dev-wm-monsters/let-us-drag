// PDF inspection for E2E assertions, run in the Playwright (plain Node) process — never inside
// Electron. Uses the pdfjs-dist legacy build, like the engine does for PDF → TXT.
import { readFileSync } from 'node:fs'

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let pdfjsPromise: Promise<Pdfjs> | undefined

async function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= (async () => {
    const g = globalThis as { pdfjsWorker?: unknown }
    // In Node, pdfjs runs its worker in-process when the worker module is pre-loaded here.
    if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
    return import('pdfjs-dist/legacy/build/pdf.mjs')
  })()
  return pdfjsPromise
}

/** Text of every page (items joined with spaces, whitespace collapsed), in page order. */
export async function pdfPageTexts(path: string): Promise<string[]> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 })
  try {
    const doc = await task.promise
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent()
      const text = content.items.map((it) => ('str' in it ? it.str : '')).join(' ')
      pages.push(text.replace(/\s+/g, ' ').trim())
    }
    return pages
  } finally {
    await task.destroy()
  }
}
