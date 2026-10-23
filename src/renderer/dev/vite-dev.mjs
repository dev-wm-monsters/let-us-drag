// Shared helper: a programmatic Vite dev server rooted at src/renderer (dev tooling only).
// Uses only installed packages (vite, @vitejs/plugin-react).
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { characterSvgPlugin } from '../../../scripts/lib/character-svg.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const rendererRoot = resolve(here, '..')
export const repoRoot = resolve(here, '../../..')

/** Start a Vite dev server for the renderer. `port: 0` picks a free port. */
export async function startRendererServer({ port = 5199, ssrOnly = false } = {}) {
  const server = await createServer({
    configFile: false,
    root: rendererRoot,
    plugins: [react(), characterSvgPlugin()],
    logLevel: 'warn',
    server: ssrOnly ? { middlewareMode: true, hmr: false } : { port, strictPort: false, host: '127.0.0.1', hmr: false },
    appType: ssrOnly ? 'custom' : 'mpa',
    // React ships CommonJS: pre-bundle it so the browser gets ESM.
    optimizeDeps: ssrOnly
      ? { noDiscovery: true, include: [] }
      : { entries: ['dev/harness.html'], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    cacheDir: resolve(repoRoot, 'node_modules/.vite-lud-harness')
  })
  if (!ssrOnly) await server.listen()
  return server
}

export function serverUrl(server) {
  const addr = server.resolvedUrls?.local?.[0]
  if (!addr) throw new Error('Vite server did not report a URL')
  return addr.replace(/\/$/, '')
}
