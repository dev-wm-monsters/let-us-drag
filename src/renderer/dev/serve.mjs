// Serve the visual harness for manual poking in a browser:
//   node src/renderer/dev/serve.mjs   → prints http://127.0.0.1:5199/dev/harness.html?view=overlay
import { serverUrl, startRendererServer } from './vite-dev.mjs'

const server = await startRendererServer({ port: Number(process.env.LUD_HARNESS_PORT ?? 5199) })
const url = serverUrl(server)
console.log(`Harness ready:
  ${url}/dev/harness.html?view=overlay
  ${url}/dev/harness.html?view=feed&jobs=auto
  ${url}/dev/harness.html?view=settings&platform=darwin&reason=mac-permission&firstRun=1
Press Ctrl+C to stop.`)
