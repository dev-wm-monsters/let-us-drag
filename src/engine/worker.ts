// utilityProcess entry for the engine (spawned by src/main/engine-host.ts).
// Implements the HostToWorker / WorkerToHost protocol from ./api using process.parentPort only
// (no 'electron' import). The htmlToPdf adapter is forwarded to the host, which renders with
// Chromium, and awaited with a timeout.
import type { EngineAdapters, EngineOptions, HostToWorker, WorkerToHost } from './api'
import { createEngine } from './index'
import { createWorkerHandler, type WorkerPort } from './worker-protocol'

interface ParentPortLike {
  on(event: 'message', listener: (e: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort

if (parentPort) {
  const port: WorkerPort = {
    post: (msg: WorkerToHost) => parentPort.postMessage(msg),
    onMessage: (cb: (msg: HostToWorker) => void) => parentPort.on('message', (e) => cb(e.data as HostToWorker))
  }
  createWorkerHandler(port, (adapters: EngineAdapters, options: EngineOptions) => createEngine(adapters, options))
}
