// D26: Dodo client (against a local HTTP server), build config / checkout URL, encrypted storage.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_DODO_PRODUCT_ID,
  checkoutUrl,
  e2eDodoBaseUrl,
  licenceLinkUrl,
  makeLicenceConfig,
  parseProductId
} from '../../../src/main/licence/config'
import { DodoClient } from '../../../src/main/licence/dodo-client'
import { isAllowedLicenceRequest } from '../../../src/main/security'
import { INSTALL_ID_FILE, LICENCE_FILE_ENCRYPTED, LICENCE_FILE_PLAIN, LicenceStore, loadInstallId, type Encryptor, type StoredLicence } from '../../../src/main/licence/store'

// ——— local mock server ————————————————————————————————————————————————————————————————
type Reply = { status: number; body?: string; delayMs?: number; headers?: Record<string, string> }
let server: Server
let base = ''
let next: Reply[] = []
const seen: { path: string; headers: IncomingMessage['headers']; body: unknown }[] = []

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', (c: Buffer) => (raw += c.toString()))
    req.on('end', () => {
      let body: unknown = raw
      try {
        body = JSON.parse(raw)
      } catch {
        // keep raw
      }
      seen.push({ path: req.url ?? '', headers: req.headers, body })
      const r = next.shift() ?? { status: 500, body: '{"code":"NO_SCRIPT","message":null}' }
      setTimeout(() => {
        res.writeHead(r.status, { 'content-type': 'application/json', ...r.headers })
        res.end(r.body ?? '')
      }, r.delayMs ?? 0)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  base = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : ''
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))
afterEach(() => {
  next = []
  seen.length = 0
})

describe('DodoClient', () => {
  it('activate sends only license_key + name to /licenses/activate and reads the lki_ id + product', async () => {
    next = [{ status: 200, body: JSON.stringify({ id: 'lki_abc', license_key_id: 'lic_1', name: 'x', product: { product_id: 'pdt_xyz123', name: 'P' }, business_id: 'b' }) }]
    const c = new DodoClient({ baseUrl: base })
    const r = await c.activate('KEY-1', 'Linux · x64 · 3f9a2c')
    expect(r).toEqual({ kind: 'ok', data: { instanceId: 'lki_abc', productId: 'pdt_xyz123' } })
    expect(seen[0]!.path).toBe('/licenses/activate')
    expect(seen[0]!.body).toEqual({ license_key: 'KEY-1', name: 'Linux · x64 · 3f9a2c' })
    // No API key, no cookies, nothing identifying in the headers.
    expect(seen[0]!.headers['authorization']).toBeUndefined()
    expect(seen[0]!.headers['cookie']).toBeUndefined()
  })

  it('maps error statuses and Dodo error codes', async () => {
    next = [{ status: 422, body: '{"code":"LICENSE_KEY_LIMIT_REACHED","message":"License key activation limit reached"}' }]
    expect(await new DodoClient({ baseUrl: base }).activate('K', 'n')).toEqual({ kind: 'http', status: 422, code: 'LICENSE_KEY_LIMIT_REACHED' })
    next = [{ status: 404, body: 'not json' }]
    expect(await new DodoClient({ baseUrl: base }).activate('K', 'n')).toEqual({ kind: 'http', status: 404, code: null })
  })

  it('validate sends the instance id when known, omits it otherwise', async () => {
    next = [{ status: 200, body: '{"valid":true}' }, { status: 200, body: '{"valid":false}' }]
    const c = new DodoClient({ baseUrl: base })
    expect(await c.validate('K', 'lki_1')).toEqual({ kind: 'ok', data: { valid: true, productId: null } })
    expect(await c.validate('K', null)).toEqual({ kind: 'ok', data: { valid: false, productId: null } })
    expect(seen.map((s) => [s.path, s.body])).toEqual([
      ['/licenses/validate', { license_key: 'K', license_key_instance_id: 'lki_1' }],
      ['/licenses/validate', { license_key: 'K' }]
    ])
  })

  it('deactivate accepts an empty 200 body', async () => {
    next = [{ status: 200, body: '' }]
    expect(await new DodoClient({ baseUrl: base }).deactivate('K', 'lki_1')).toEqual({ kind: 'ok', data: true })
    expect(seen[0]!.body).toEqual({ license_key: 'K', license_key_instance_id: 'lki_1' })
  })

  it('timeouts, captive portals (redirects, HTML) and unreachable hosts are "network"', async () => {
    next = [{ status: 200, body: '{"valid":true}', delayMs: 400 }]
    expect(await new DodoClient({ baseUrl: base, timeoutMs: 100 }).validate('K', 'i')).toEqual({ kind: 'network', reason: 'timeout' })
    next = [{ status: 302, headers: { location: 'http://portal.example/' } }]
    expect((await new DodoClient({ baseUrl: base }).validate('K', 'i')).kind).toBe('network')
    next = [{ status: 200, body: '<html>Hotel wifi login</html>' }]
    expect(await new DodoClient({ baseUrl: base }).validate('K', 'i')).toEqual({ kind: 'network', reason: 'unexpected response' })
    next = [{ status: 200, body: '{"valid":"yes"}' }]
    expect((await new DodoClient({ baseUrl: base }).validate('K', 'i')).kind).toBe('network')
    expect((await new DodoClient({ baseUrl: 'http://127.0.0.1:9', timeoutMs: 2000 }).validate('K', 'i')).kind).toBe('network')
  })
})

describe('licence build config', () => {
  it('defaults to test mode with the test product', () => {
    const c = makeLicenceConfig(undefined, undefined)
    expect(c).toEqual({
      environment: 'test',
      productId: 'pdt_0Nqn0nhO4z3NeUwcXy0n3',
      apiBaseUrl: 'https://test.dodopayments.com',
      checkoutUrl:
        'https://test.checkout.dodopayments.com/buy/pdt_0Nqn0nhO4z3NeUwcXy0n3?quantity=1&redirect_url=https%3A%2F%2Fletsdrag.wakeupmonster.com%2Fthanks%2F'
    })
  })
  it('live uses the live hosts', () => {
    const c = makeLicenceConfig('live', 'pdt_LiveProduct42')
    expect(c.apiBaseUrl).toBe('https://live.dodopayments.com')
    expect(c.checkoutUrl).toBe(
      'https://checkout.dodopayments.com/buy/pdt_LiveProduct42?quantity=1&redirect_url=https%3A%2F%2Fletsdrag.wakeupmonster.com%2Fthanks%2F'
    )
    expect(checkoutUrl('test', 'pdt_abcdef')).toMatch(/^https:\/\/test\.checkout\.dodopayments\.com\/buy\/pdt_abcdef\?/)
  })
  it('ignores malformed values', () => {
    expect(makeLicenceConfig('staging', 'x').environment).toBe('test')
    expect(parseProductId('pdt_../../evil')).toBe(DEFAULT_DODO_PRODUCT_ID)
  })
  it('only opens known links', () => {
    const c = makeLicenceConfig('test', undefined)
    expect(licenceLinkUrl('checkout', c)).toBe(c.checkoutUrl)
    expect(licenceLinkUrl('pricing', c)).toBe('https://letsdrag.wakeupmonster.com/#pricing')
    expect(licenceLinkUrl('terms', c)).toBe('https://letsdrag.wakeupmonster.com/terms/')
    expect(licenceLinkUrl('refund', c)).toBe('https://letsdrag.wakeupmonster.com/refund/')
    expect(licenceLinkUrl('privacy', c)).toBe('https://letsdrag.wakeupmonster.com/privacy/')
  })
  it('the licence session reaches only the Dodo origin', () => {
    expect(isAllowedLicenceRequest('https://test.dodopayments.com/licenses/validate', 'https://test.dodopayments.com')).toBe(true)
    expect(isAllowedLicenceRequest('https://live.dodopayments.com/licenses/validate', 'https://test.dodopayments.com')).toBe(false)
    expect(isAllowedLicenceRequest('https://test.dodopayments.com.evil.example/x', 'https://test.dodopayments.com')).toBe(false)
    expect(isAllowedLicenceRequest('http://test.dodopayments.com/x', 'https://test.dodopayments.com')).toBe(false)
    expect(isAllowedLicenceRequest('not a url', 'https://test.dodopayments.com')).toBe(false)
  })
  it('the E2E mock URL must be loopback', () => {
    expect(e2eDodoBaseUrl('http://127.0.0.1:4567')).toBe('http://127.0.0.1:4567')
    expect(e2eDodoBaseUrl('http://localhost:4567/x')).toBe('http://localhost:4567')
    expect(e2eDodoBaseUrl('https://test.dodopayments.com')).toBeNull()
    expect(e2eDodoBaseUrl('http://10.0.0.5:80')).toBeNull()
    expect(e2eDodoBaseUrl('file:///etc/passwd')).toBeNull()
    expect(e2eDodoBaseUrl(undefined)).toBeNull()
  })
})

// ——— storage ———————————————————————————————————————————————————————————————————————————
const rec: StoredLicence = {
  v: 1,
  licenseKey: 'LD7Q-29XK-PM3A-1A2B',
  instanceId: 'lki_1',
  environment: 'test',
  activatedAt: '2026-11-01T10:00:00.000Z',
  lastCheckedAt: '2026-11-01T10:00:00.000Z',
  lastResult: 'activated',
  status: 'active'
}

/** Reversible fake "encryption" (XOR) that never stores the key in clear. */
function fakeEncryptor(available: boolean, failDecrypt = false): Encryptor {
  const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a))
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => xor(Buffer.from(s, 'utf8')),
    decryptString: (b) => {
      if (failDecrypt) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
      return xor(b).toString('utf8')
    }
  }
}

describe('LicenceStore', () => {
  const dirs: string[] = []
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'lud-licence-'))
    dirs.push(d)
    return d
  }
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  })

  it('encrypts with safeStorage when available (no key in clear on disk), mode 0600', async () => {
    const dir = tmp()
    const store = new LicenceStore({ dir, encryptor: fakeEncryptor(true) })
    await store.save(rec)
    const file = join(dir, LICENCE_FILE_ENCRYPTED)
    expect(readFileSync(file).toString('latin1')).not.toContain(rec.licenseKey)
    expect(existsSync(join(dir, LICENCE_FILE_PLAIN))).toBe(false)
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(await store.load()).toEqual(rec)
  })

  it('falls back to a 0600 JSON file when encryption is unavailable, and logs it once', async () => {
    const dir = tmp()
    const logs: string[] = []
    const store = new LicenceStore({ dir, encryptor: fakeEncryptor(false), log: (m) => logs.push(m) })
    await store.save(rec)
    await store.save({ ...rec, lastResult: 'valid' })
    const file = join(dir, LICENCE_FILE_PLAIN)
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    expect((await store.load())?.lastResult).toBe('valid')
    expect(logs.filter((l) => l.includes('not available'))).toHaveLength(1)
  })

  it('ignores a hand-written plain file when encryption is available', async () => {
    const dir = tmp()
    writeFileSync(join(dir, LICENCE_FILE_PLAIN), JSON.stringify(rec))
    expect(await new LicenceStore({ dir, encryptor: fakeEncryptor(true) }).load()).toBeNull()
  })

  it('corrupt, undecryptable or invalid data reads as no licence (never throws)', async () => {
    const dir = tmp()
    writeFileSync(join(dir, LICENCE_FILE_ENCRYPTED), Buffer.from('garbage'))
    expect(await new LicenceStore({ dir, encryptor: fakeEncryptor(true) }).load()).toBeNull()
    await new LicenceStore({ dir, encryptor: fakeEncryptor(true) }).save(rec)
    expect(await new LicenceStore({ dir, encryptor: fakeEncryptor(true, true) }).load()).toBeNull()
    const dir2 = tmp()
    writeFileSync(join(dir2, LICENCE_FILE_PLAIN), JSON.stringify({ ...rec, status: 'forever' }))
    expect(await new LicenceStore({ dir: dir2, encryptor: fakeEncryptor(false) }).load()).toBeNull()
    const throwing: Encryptor = { ...fakeEncryptor(true), isEncryptionAvailable: () => { throw new Error('not ready') } }
    expect(await new LicenceStore({ dir: tmp(), encryptor: throwing }).load()).toBeNull()
  })

  it('clear removes both files', async () => {
    const dir = tmp()
    const store = new LicenceStore({ dir, encryptor: fakeEncryptor(true) })
    await store.save(rec)
    writeFileSync(join(dir, LICENCE_FILE_PLAIN), '{}')
    await store.clear()
    expect(existsSync(join(dir, LICENCE_FILE_ENCRYPTED))).toBe(false)
    expect(existsSync(join(dir, LICENCE_FILE_PLAIN))).toBe(false)
  })

  it('install ID: random UUID v4, created once and kept', async () => {
    const dir = tmp()
    const a = await loadInstallId(dir)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(await loadInstallId(dir)).toBe(a)
    writeFileSync(join(dir, INSTALL_ID_FILE), 'my-hostname\n')
    const b = await loadInstallId(dir)
    expect(b).not.toBe('my-hostname')
    expect(b).not.toBe(a)
  })
})
