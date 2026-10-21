// Fake engine worker for platform smoke tests (used via LUD_E2E_ENGINE_WORKER, E2E only).
// Speaks the src/engine/api.ts protocol:
//   to-pdf  → asks the host to render HTML (htmlToPdf adapter) and writes <input>.pdf
//   zip with an input path containing "crash" → exits the process (crash/restart test)
//   zip with an input path containing "hang" → blocks the event loop forever (watchdog test:
//     like a synchronous parser that cannot see the cancel message)
//   anything else → writes <input>.out (a copy)
const { copyFileSync, writeFileSync } = require('node:fs')

const port = process.parentPort
const pendingPdf = new Map()
let counter = 0

function post(msg) {
  port.postMessage(msg)
}
function event(e) {
  post({ type: 'event', event: e })
}

port.on('message', (e) => {
  const msg = e.data
  if (msg.type === 'init') {
    post({ type: 'ready' })
  } else if (msg.type === 'run') {
    const { id, optionId, inputPaths } = msg.req
    event({ type: 'queued', jobId: id })
    event({ type: 'progress', jobId: id, progress: 0.5, stage: 'fake' })
    if (optionId === 'zip' && inputPaths.some((p) => p.includes('crash'))) process.exit(3)
    if (optionId === 'zip' && inputPaths.some((p) => p.includes('hang'))) {
      // Let the queued/progress events go out first, then never yield again.
      setTimeout(() => {
        for (;;) {
          // busy
        }
      }, 50)
      return
    }
    if (optionId === 'to-pdf') {
      const requestId = `r${++counter}`
      pendingPdf.set(requestId, { id, out: `${inputPaths[0]}.pdf` })
      post({ type: 'htmlToPdf', requestId, html: '<!doctype html><h1>Hello from the fake engine</h1><img src="https://example.com/x.png">' })
      return
    }
    const out = `${inputPaths[0]}.out`
    copyFileSync(inputPaths[0], out)
    event({ type: 'done', jobId: id, outputPaths: [out] })
  } else if (msg.type === 'cancel') {
    event({ type: 'error', jobId: msg.jobId, error: { code: 'CANCELLED', message: 'Cancelled.' } })
  } else if (msg.type === 'htmlToPdf:result') {
    const job = pendingPdf.get(msg.requestId)
    if (!job) return
    pendingPdf.delete(msg.requestId)
    if (msg.error) {
      event({ type: 'error', jobId: job.id, error: { code: 'TOOL_FAILED', message: msg.error } })
      return
    }
    writeFileSync(job.out, Buffer.from(msg.pdf))
    event({ type: 'done', jobId: job.id, outputPaths: [job.out] })
  }
})
