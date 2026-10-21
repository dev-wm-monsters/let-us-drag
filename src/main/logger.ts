// Diagnostics: silent in production; printed to stderr in development or with LUD_DEBUG=1.

export function createLogger(enabled: boolean): (message: string) => void {
  if (!enabled) return () => undefined
  return (message: string) => {
    process.stderr.write(`[lud] ${message}\n`)
  }
}
