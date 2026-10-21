// Local "beacon" HTTP server for no-network assertions (QA, SEC-61 / SEC-82).
// Listens on 127.0.0.1 with an ephemeral port and records every request it receives. A test embeds
// `beacon.url('/some-tag')` in hostile input (remote <img>, HLS segment URL…) and then asserts that
// `beacon.hits` stays empty. Used by the engine tests (vitest) and the Electron E2E tests (Playwright).
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface BeaconHit {
  method: string
  url: string
  userAgent: string
}

export interface Beacon {
  /** Every request received so far (in arrival order). */
  readonly hits: readonly BeaconHit[]
  /** Base URL, e.g. "http://127.0.0.1:41234". */
  readonly origin: string
  /** Absolute URL for a path on this server (path must start with "/"). */
  url(path: string): string
  close(): Promise<void>
}

export async function startBeacon(): Promise<Beacon> {
  const hits: BeaconHit[] = []
  const server: Server = createServer((req, res) => {
    hits.push({ method: req.method ?? '?', url: req.url ?? '?', userAgent: String(req.headers['user-agent'] ?? '') })
    // Answer something plausible so a client that got through would not retry forever.
    res.writeHead(200, { 'content-type': 'text/plain', connection: 'close' })
    res.end('beacon')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${port}`
  return {
    hits,
    origin,
    url: (path) => `${origin}${path}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
