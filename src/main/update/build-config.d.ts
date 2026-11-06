// Build-time constant injected by electron-vite `define` (electron.vite.config.ts, main only; TPM D29).
// Absent under vitest: src/main/update/config.ts falls back to the default manifest URL.
declare const __UPDATE_MANIFEST_URL__: string | undefined
