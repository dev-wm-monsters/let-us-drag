// Progress helpers: throttling (≤ ~10 events/sec) and mapping sub-task progress into a range.

export type ProgressFn = (progress: number, stage?: string) => void

export const PROGRESS_INTERVAL_MS = 100

/** Clamp to 0..1; anything non-finite or negative means "unknown" (-1). */
export function normalizeProgress(p: number): number {
  if (!Number.isFinite(p) || p < 0) return -1
  return p > 1 ? 1 : p
}

/**
 * Throttle progress reports: emits at most once per `intervalMs`, except that stage changes and
 * the first report are always emitted. Values never go backwards (except to "unknown").
 */
export function createThrottledProgress(
  emit: (progress: number, stage?: string) => void,
  intervalMs = PROGRESS_INTERVAL_MS,
  now: () => number = Date.now
): ProgressFn {
  let lastAt = -Infinity
  let lastValue = -2
  let lastStage: string | undefined
  return (raw, stage) => {
    let p = normalizeProgress(raw)
    if (p !== -1 && lastValue > p) p = lastValue
    const t = now()
    const stageChanged = stage !== undefined && stage !== lastStage
    if (!stageChanged && t - lastAt < intervalMs) return
    if (!stageChanged && p === lastValue) return
    lastAt = t
    lastValue = p
    if (stage !== undefined) lastStage = stage
    emit(p, stage ?? lastStage)
  }
}

/** Map a 0..1 sub-progress into [start, end] of the parent. Unknown (-1) stays unknown. */
export function subProgress(parent: ProgressFn, start: number, end: number): ProgressFn {
  return (p, stage) => {
    const n = normalizeProgress(p)
    parent(n === -1 ? -1 : start + (end - start) * n, stage)
  }
}
