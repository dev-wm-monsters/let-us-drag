// Is this run an E2E test run? (TPM D12, SEC-18). Pure; no electron import.
//
// Test hooks (globalThis.__ludTest), the E2E renderer flag and the E2E-only environment overrides
// are enabled only when BOTH hold:
//   - env LUD_E2E === '1', and
//   - the app is NOT packaged (QA runs E2E against the unpackaged build: `npx electron .`).
// A packaged build therefore ignores LUD_E2E entirely (defence in depth: an env var must never
// change what a shipped app exposes).

export function isE2E(env: Readonly<Record<string, string | undefined>>, isPackaged: boolean): boolean {
  return !isPackaged && env['LUD_E2E'] === '1'
}
