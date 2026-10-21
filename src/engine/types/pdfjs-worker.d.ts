// pdfjs-dist ships no typings for the worker module; we only need it to run the "fake worker"
// in-process under Node (see src/engine/tools/pdf.ts).
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
