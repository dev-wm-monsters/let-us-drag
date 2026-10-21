// Scaffold placeholder: utilityProcess entry. Owned by the Engine backend dev (docs/PLAN.md §7).
import type { WorkerToHost } from './api'

const ready: WorkerToHost = { type: 'ready' }
process.parentPort?.postMessage(ready)
