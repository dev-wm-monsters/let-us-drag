// Shared paths for the E2E suite. Pure module (no Electron, no Playwright).
import { join, resolve } from 'node:path'

/** Repository root (tests/e2e/support → ../../..). */
export const REPO_ROOT = resolve(__dirname, '..', '..', '..')

/** Built main entry; the suite runs against `npm run build` output, never the dev server. */
export const BUILT_MAIN = join(REPO_ROOT, 'out', 'main', 'index.js')

/** Every Uncle state screenshot lands here (uploaded by CI as part of test-results/). */
export const SCREENS_DIR = join(REPO_ROOT, 'test-results', 'screens')
