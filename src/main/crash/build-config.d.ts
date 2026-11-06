// Build-time constant injected by electron-vite `define` (electron.vite.config.ts, main only; D28).
// Absent under vitest: src/main/crash/config.ts falls back to DEFAULT_SENTRY_DSN.
declare const __SENTRY_DSN__: string | undefined
