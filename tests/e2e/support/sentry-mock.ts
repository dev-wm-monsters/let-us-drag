// A local mock of Sentry's envelope ingest endpoint (TPM D28), for E2E. The app is pointed at it with
// LUD_E2E_SENTRY_URL (honoured only when LUD_E2E=1 and unpackaged; loopback only). Every request is
// recorded, whatever its path, so a spec can also assert that NOTHING was sent.
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gunzipSync } from 'node:zlib'

export interface EnvelopeItem {
  headers: Record<string, unknown>
  payload: unknown
}

export interface IngestRequest {
  method: string
  url: string
  headers: IncomingMessage['headers']
  /** Raw body (decompressed), as sent. */
  body: string
  envelope: { headers: Record<string, unknown>; items: EnvelopeItem[] } | null
}

export interface SentryMock {
  url: string
  requests: IngestRequest[]
  /** Event payloads of every envelope received so far. */
  events(): Record<string, unknown>[]
  close(): Promise<void>
}

/** Parse a Sentry envelope: header line, then (item header line, payload) pairs. */
export function parseEnvelope(body: string): IngestRequest['envelope'] {
  const lines = body.split('\n')
  try {
    const headers = JSON.parse(lines[0] ?? '') as Record<string, unknown>
    const items: EnvelopeItem[] = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      const itemHeaders = JSON.parse(line) as Record<string, unknown>
      const raw = lines[++i] ?? ''
      let payload: unknown = raw
      try {
        payload = JSON.parse(raw)
      } catch {
        // binary attachment: keep the text
      }
      items.push({ headers: itemHeaders, payload })
    }
    return { headers, items }
  } catch {
    return null
  }
}

export async function startSentryMock(): Promise<SentryMock> {
  const requests: IngestRequest[] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      let buf = Buffer.concat(chunks)
      if (req.headers['content-encoding'] === 'gzip') buf = gunzipSync(buf)
      const body = buf.toString('utf8')
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body, envelope: parseEnvelope(body) })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    events: () =>
      requests.flatMap((r) => (r.envelope?.items ?? []).filter((i) => i.headers['type'] === 'event').map((i) => i.payload as Record<string, unknown>)),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
