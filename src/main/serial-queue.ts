// Tiny helpers: run async tasks one at a time, and bound a promise by a timeout.

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

/** Resolve/reject like `p`, or reject with TimeoutError after `ms`. Calls `onTimeout` once on timeout. */
export function withTimeout<T>(p: Promise<T>, ms: number, message: string, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.()
      reject(new TimeoutError(message))
    }, ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    )
  })
}

/** Runs tasks strictly one after another; a failing task does not block the next ones. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve()
  private size = 0

  get pending(): number {
    return this.size
  }

  push<T>(task: () => Promise<T>): Promise<T> {
    this.size++
    const run = async (): Promise<T> => {
      try {
        return await task()
      } finally {
        this.size--
      }
    }
    const p = this.tail.then(run, run)
    this.tail = p.catch(() => undefined)
    return p
  }
}
