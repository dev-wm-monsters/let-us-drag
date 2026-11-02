// A local mock of Dodo Payments' public licence endpoints (D26), for E2E. The app is pointed at it
// with LUD_E2E_DODO_URL (honoured only when LUD_E2E=1 and unpackaged). Behaviour follows the
// documented contract (docs/TPM_DECISIONS.md D26):
//   POST /licenses/activate   → 200 instance { id: lki_…, product: { product_id } } | 404 | 403 | 422
//   POST /licenses/validate   → 200 { valid } | 404 (unknown key, or an instance that is not this key's)
//   POST /licenses/deactivate → 200 (empty) | 404 unknown key | 403 instance not of this key
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export const TEST_PRODUCT = 'pdt_0Nqn0nhO4z3NeUwcXy0n3'

export interface MockKey {
  status: 'active' | 'disabled'
  limit: number
  product: string
  instances: Map<string, string> // id → name
}

/** normal: follow the contract · down: 503 · drop: close the socket (offline) · hang: answer after 6 s (timeout) */
export type MockMode = 'normal' | 'down' | 'drop' | 'hang'

export interface MockRequest {
  path: string
  body: Record<string, unknown>
  headers: IncomingMessage['headers']
}

export interface DodoMock {
  url: string
  keys: Map<string, MockKey>
  requests: MockRequest[]
  mode: MockMode
  addKey(key: string, extra?: Partial<Omit<MockKey, 'instances'>> & { instances?: string[] }): MockKey
  close(): Promise<void>
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

export async function startDodoMock(): Promise<DodoMock> {
  const keys = new Map<string, MockKey>()
  const requests: MockRequest[] = []
  const sockets = new Set<import('node:net').Socket>()
  const mock = { keys, requests, mode: 'normal' as MockMode } as DodoMock

  const handle = (path: string, body: Record<string, unknown>, res: ServerResponse): void => {
    const keyName = typeof body['license_key'] === 'string' ? body['license_key'] : ''
    const key = keys.get(keyName)
    const instance = typeof body['license_key_instance_id'] === 'string' ? body['license_key_instance_id'] : null
    if (path === '/licenses/activate') {
      if (!key) return send(res, 404, { code: 'LICENSE_KEY_NOT_FOUND', message: 'License key not found' })
      if (key.status !== 'active') return send(res, 403, { code: 'INACTIVE_LICENSE_KEY', message: 'License key is not active' })
      if (key.instances.size >= key.limit) return send(res, 422, { code: 'LICENSE_KEY_LIMIT_REACHED', message: 'License key activation limit reached' })
      const id = `lki_${randomBytes(8).toString('hex')}`
      key.instances.set(id, String(body['name'] ?? ''))
      return send(res, 200, {
        id,
        business_id: 'bus_mock',
        created_at: new Date().toISOString(),
        license_key_id: 'lic_mock',
        name: body['name'],
        customer: { customer_id: 'cus_mock', email: 'buyer@example.com', name: 'Buyer' },
        product: { product_id: key.product, name: "Let's Drag!" }
      })
    }
    if (path === '/licenses/validate') {
      if (!key) return send(res, 404, { code: 'LICENSE_KEY_NOT_FOUND', message: 'License key not found' })
      if (instance !== null && !key.instances.has(instance)) {
        return send(res, 404, { code: 'LICENSE_KEY_NOT_FOUND', message: 'License key instance not found' })
      }
      return send(res, 200, { valid: key.status === 'active' })
    }
    if (path === '/licenses/deactivate') {
      if (!key) return send(res, 404, { code: 'LICENSE_KEY_NOT_FOUND', message: 'License key not found' })
      if (!instance || !key.instances.has(instance)) return send(res, 403, { code: 'FORBIDDEN', message: 'Instance does not belong to this key' })
      key.instances.delete(instance)
      res.writeHead(200)
      return void res.end()
    }
    send(res, 404, { code: 'NOT_FOUND', message: null })
  }

  const server: Server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c: Buffer) => (raw += c.toString()))
    req.on('end', () => {
      let body: Record<string, unknown> = {}
      try {
        body = JSON.parse(raw) as Record<string, unknown>
      } catch {
        // keep {}
      }
      const path = (req.url ?? '').split('?')[0] ?? ''
      requests.push({ path, body, headers: req.headers })
      switch (mock.mode) {
        case 'drop':
          return void req.socket.destroy()
        case 'down':
          return send(res, 503, { code: 'SERVICE_UNAVAILABLE', message: null })
        case 'hang':
          return void setTimeout(() => {
            if (!res.writableEnded) handle(path, body, res)
          }, 6_000)
        default:
          handle(path, body, res)
      }
    })
  })
  server.on('connection', (s) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  mock.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  mock.addKey = (key, extra = {}) => {
    const k: MockKey = {
      status: extra.status ?? 'active',
      limit: extra.limit ?? 2,
      product: extra.product ?? TEST_PRODUCT,
      instances: new Map((extra.instances ?? []).map((id) => [id, 'other computer']))
    }
    keys.set(key, k)
    return k
  }
  mock.close = () =>
    new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy()
      server.close(() => resolve())
    })
  return mock
}
