// A local stand-in for the website's update manifest (D29), for E2E. The app is pointed at it with
// LUD_E2E_UPDATE_URL (honoured only when LUD_E2E=1 and unpackaged; loopback only).
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

/** normal: serve `manifest` · down: 500 · bad: invalid JSON · drop: close the socket (offline) */
export type UpdateMockMode = 'normal' | 'down' | 'bad' | 'drop'

export interface UpdateMockRequest {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: string
}

export interface UpdateMock {
  /** Full manifest URL to pass as LUD_E2E_UPDATE_URL. */
  url: string
  manifest: unknown
  mode: UpdateMockMode
  requests: UpdateMockRequest[]
  close(): Promise<void>
}

export const SITE = 'https://letsdrag.wakeupmonster.com'

/** The documented manifest shape with per-OS installers on the website. */
export function makeManifest(latest: string, minimum: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const dl = (suffix: string) => `${SITE}/downloads/LetsDrag-${latest}-${suffix}`
  return {
    latest,
    minimum,
    releasedAt: '2026-11-10',
    notes: ['New: the Uncle learned to convert HEIC photos.', 'Fixed: long file names no longer make him hiccup.'],
    downloads: {
      'mac-arm64': dl('mac-arm64.dmg'),
      'mac-x64': dl('mac-x64.dmg'),
      'win-x64': dl('win-x64.exe'),
      'linux-x64': dl('linux-x64.AppImage'),
      page: `${SITE}/#download`
    },
    ...extra
  }
}

/** The download the app should open on this test machine. */
export function expectedDownload(manifest: Record<string, unknown>): string {
  const os = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'
  const downloads = manifest['downloads'] as Record<string, string>
  return downloads[`${os}-${process.arch}`] ?? downloads['page']!
}

export async function startUpdateMock(manifest: unknown = null, port = 0): Promise<UpdateMock> {
  const sockets = new Set<Socket>()
  const mock = { manifest, mode: 'normal' as UpdateMockMode, requests: [] as UpdateMockRequest[] } as UpdateMock
  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (c: Buffer) => (body += c.toString()))
    req.on('end', () => {
      mock.requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body })
      if (mock.mode === 'drop') return void req.socket.destroy()
      if (mock.mode === 'down') {
        res.writeHead(500, { 'content-type': 'text/plain' })
        return void res.end('oops')
      }
      if ((req.url ?? '').split('?')[0] !== '/update.json' || mock.manifest === null) {
        res.writeHead(404)
        return void res.end()
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(mock.mode === 'bad' ? '{"latest": "0.2.0", oops' : JSON.stringify(mock.manifest))
    })
  })
  server.on('connection', (s) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  mock.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/update.json`
  mock.close = () =>
    new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy()
      server.close(() => resolve())
    })
  return mock
}
