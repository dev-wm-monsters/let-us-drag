import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { characterSvgPlugin } from './scripts/lib/character-svg.mjs'

/**
 * Licensing build settings (TPM D26). Not secrets: the licence endpoints are public and the app holds
 * no Dodo API key. Empty / unset → test mode with the test product. An explicit but invalid value,
 * or a live build that still names the test product, fails the build instead of shipping silently.
 */
const TEST_PRODUCT_ID = 'pdt_0Nqn0nhO4z3NeUwcXy0n3'
function dodoBuildSettings(env: NodeJS.ProcessEnv): { dodoEnv: 'test' | 'live'; productId: string } {
  const rawEnv = (env['DODO_ENV'] ?? '').trim()
  const rawProduct = (env['DODO_PRODUCT_ID'] ?? '').trim()
  if (rawEnv !== '' && rawEnv !== 'test' && rawEnv !== 'live') throw new Error(`DODO_ENV must be "test" or "live", got "${rawEnv}"`)
  if (rawProduct !== '' && !/^pdt_[A-Za-z0-9]{6,64}$/.test(rawProduct)) throw new Error(`DODO_PRODUCT_ID is not a Dodo product ID: "${rawProduct}"`)
  const dodoEnv = rawEnv === 'live' ? 'live' : 'test'
  const productId = rawProduct || TEST_PRODUCT_ID
  if (dodoEnv === 'live' && productId === TEST_PRODUCT_ID) throw new Error('DODO_ENV=live needs the live DODO_PRODUCT_ID (the test product only exists in test mode)')
  return { dodoEnv, productId }
}
const dodo = dodoBuildSettings(process.env)
/** LUD_LICENSING=off: team / demo build, everything unlocked, no licence network calls (D26 addendum). */
const rawLicensing = (process.env['LUD_LICENSING'] ?? '').trim()
if (rawLicensing !== '' && rawLicensing !== 'on' && rawLicensing !== 'off') throw new Error(`LUD_LICENSING must be "on" or "off", got "${rawLicensing}"`)
const licensing = rawLicensing === 'off' ? 'off' : 'on'

export default defineConfig({
  main: {
    define: {
      __DODO_ENV__: JSON.stringify(dodo.dodoEnv),
      __DODO_PRODUCT_ID__: JSON.stringify(dodo.productId),
      __LUD_LICENSING__: JSON.stringify(licensing)
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'engine-worker': resolve(__dirname, 'src/engine/worker.ts')
        }
      }
    }
  },
  preload: {
    build: {
      // Sandboxed preload: bundle everything into one CommonJS file.
      externalizeDeps: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), characterSvgPlugin()],
    build: {
      rollupOptions: {
        input: {
          overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
          feed: resolve(__dirname, 'src/renderer/feed/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings/index.html')
        }
      }
    }
  }
})
