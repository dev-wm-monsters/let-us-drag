// Real end-to-end check of the Dodo licence endpoints (TPM D26): activate → validate → deactivate
// against Dodo's TEST host, with the same request bodies the app sends. Run it once the sandbox /
// machine may reach test.dodopayments.com:
//
//   node scripts/dodo-smoke.mjs <test licence key>
//   DODO_SMOKE_KEY=<test licence key> node scripts/dodo-smoke.mjs
//
// The key is a LICENCE key from a test purchase (not an API key: these endpoints need none). It is
// read from argv / env only and never written anywhere; the output masks it. Options (env):
//   DODO_SMOKE_BASE      default https://test.dodopayments.com (live keys only work on https://live.dodopayments.com)
//   DODO_SMOKE_PRODUCT   expected product ID, default the test product pdt_0Nqn0nhO4z3NeUwcXy0n3
// The activation uses one seat for a few seconds and frees it again (also when a later step fails).
// Exit code 0 = every step behaved as documented.

const key = (process.argv[2] ?? process.env.DODO_SMOKE_KEY ?? '').trim()
const base = (process.env.DODO_SMOKE_BASE ?? 'https://test.dodopayments.com').replace(/\/+$/, '')
const product = process.env.DODO_SMOKE_PRODUCT ?? 'pdt_0Nqn0nhO4z3NeUwcXy0n3'
const label = `Smoke test · ${process.platform} · ${Math.random().toString(16).slice(2, 8)}`

if (!key) {
  console.error('usage: node scripts/dodo-smoke.mjs <test licence key>   (or DODO_SMOKE_KEY=…)')
  process.exit(2)
}
const masked = key.length > 8 ? `${key.slice(0, 4)}-…-${key.slice(-4)}` : '…'
let failures = 0
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures++
}

async function post(path, body) {
  const t0 = Date.now()
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(20_000)
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // not JSON
  }
  const shown = JSON.stringify(json ?? text).replaceAll(key, masked).slice(0, 600)
  console.log(`  POST ${path} → ${res.status} in ${Date.now() - t0} ms: ${shown}`)
  return { status: res.status, json }
}

console.log(`Dodo licence smoke test against ${base} with key ${masked}, label "${label}"\n`)
let instance = null
try {
  // 1. activate
  const a = await post('/licenses/activate', { license_key: key, name: label })
  check(a.status === 200, 'activate: HTTP 200')
  instance = typeof a.json?.id === 'string' ? a.json.id : null
  check(instance?.startsWith('lki_') === true, 'activate: response id starts with lki_')
  const productId = a.json?.product?.product_id ?? a.json?.product_id ?? null
  console.log(`  product in response: ${productId ?? '(none)'}`)
  if (productId !== null) check(productId === product, `activate: product is ${product}`)
  if (a.status === 422) console.log('  (422 = activation limit reached: deactivate a seat in the app or the dashboard first)')

  if (instance) {
    // 2. validate with the instance, and the key alone
    const v1 = await post('/licenses/validate', { license_key: key, license_key_instance_id: instance })
    check(v1.status === 200 && v1.json?.valid === true, 'validate (key + instance): 200 { valid: true }')
    const v2 = await post('/licenses/validate', { license_key: key })
    check(v2.status === 200 && v2.json?.valid === true, 'validate (key only): 200 { valid: true }')
  }
  // 3. unknown key → 404 (what the app shows as "We couldn't find that key")
  const bogus = await post('/licenses/validate', { license_key: `nope-${Date.now()}` })
  check(bogus.status === 404 || (bogus.status === 200 && bogus.json?.valid === false), 'validate (unknown key): 404 or { valid: false }')
} catch (err) {
  check(false, `request failed: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`)
} finally {
  if (instance) {
    try {
      // 4. deactivate frees the seat; a second validate with the instance must now fail definitely
      const d = await post('/licenses/deactivate', { license_key: key, license_key_instance_id: instance })
      check(d.status === 200, 'deactivate: HTTP 200')
      const v3 = await post('/licenses/validate', { license_key: key, license_key_instance_id: instance })
      check(
        v3.status === 404 || v3.status === 403 || (v3.status === 200 && v3.json?.valid === false),
        'validate after deactivate: definite "not valid" (404/403 or valid:false), which the app turns into "activate again"'
      )
    } catch (err) {
      check(false, `deactivate failed: ${String(err)}. Free the seat "${label}" in the Dodo dashboard.`)
    }
  }
}
console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`)
process.exit(failures === 0 ? 0 : 1)
