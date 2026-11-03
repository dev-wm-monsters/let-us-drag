// Licence build configuration (TPM D26). Pure: no electron import.
//
// DODO_ENV (test | live) and DODO_PRODUCT_ID are build-time settings, injected by electron-vite
// `define` from the build environment (CI: repository variables vars.DODO_ENV / vars.DODO_PRODUCT_ID,
// see .github/workflows/package.yml). Nothing here is a secret: the licence endpoints are public
// and the app never holds a Dodo API key.

import { WEBSITE_URL, type DodoEnvironment, type LicenceLink } from '../../shared/licence'

export const DEFAULT_DODO_ENV: DodoEnvironment = 'test'
/** Test-mode product (Dodo dashboard, 2026). The live product ID is set per build once it exists. */
export const DEFAULT_DODO_PRODUCT_ID = 'pdt_0Nqn0nhO4z3NeUwcXy0n3'

/** Licence API hosts (docs.dodopayments.com/api-reference/introduction). Test keys only work on test. */
export const DODO_API_BASE: Readonly<Record<DodoEnvironment, string>> = {
  test: 'https://test.dodopayments.com',
  live: 'https://live.dodopayments.com'
}

/** Hosted checkout hosts. */
export const DODO_CHECKOUT_BASE: Readonly<Record<DodoEnvironment, string>> = {
  test: 'https://test.checkout.dodopayments.com',
  live: 'https://checkout.dodopayments.com'
}

export const THANKS_URL = `${WEBSITE_URL}/thanks/`

export interface LicenceConfig {
  environment: DodoEnvironment
  productId: string
  apiBaseUrl: string
  checkoutUrl: string
}

const PRODUCT_ID_RE = /^pdt_[A-Za-z0-9]{6,64}$/

export function parseDodoEnv(raw: unknown): DodoEnvironment {
  return raw === 'live' ? 'live' : DEFAULT_DODO_ENV
}

export function parseProductId(raw: unknown): string {
  return typeof raw === 'string' && PRODUCT_ID_RE.test(raw.trim()) ? raw.trim() : DEFAULT_DODO_PRODUCT_ID
}

/** `https://<checkout host>/buy/<product>?quantity=1&redirect_url=<thanks page>` */
export function checkoutUrl(environment: DodoEnvironment, productId: string): string {
  const q = new URLSearchParams({ quantity: '1', redirect_url: THANKS_URL })
  return `${DODO_CHECKOUT_BASE[environment]}/buy/${encodeURIComponent(productId)}?${q.toString()}`
}

export function makeLicenceConfig(env: unknown, productId: unknown): LicenceConfig {
  const environment = parseDodoEnv(env)
  const product = parseProductId(productId)
  return { environment, productId: product, apiBaseUrl: DODO_API_BASE[environment], checkoutUrl: checkoutUrl(environment, product) }
}

/** The configuration this build was made with. */
export function buildLicenceConfig(): LicenceConfig {
  const env = typeof __DODO_ENV__ === 'string' ? __DODO_ENV__ : undefined
  const product = typeof __DODO_PRODUCT_ID__ === 'string' ? __DODO_PRODUCT_ID__ : undefined
  return makeLicenceConfig(env, product)
}

/** False only in team / demo builds made with LUD_LICENSING=off (everything unlocked, no licence calls). */
export function buildLicensingEnabled(): boolean {
  return !(typeof __LUD_LICENSING__ === 'string' && __LUD_LICENSING__ === 'off')
}

/** Every URL the app may open in the default browser (the renderer only names one). */
export function licenceLinkUrl(link: LicenceLink, config: Pick<LicenceConfig, 'checkoutUrl'>): string {
  switch (link) {
    case 'checkout':
      return config.checkoutUrl
    case 'pricing':
      return `${WEBSITE_URL}/#pricing`
    case 'terms':
      return `${WEBSITE_URL}/terms/`
    case 'refund':
      return `${WEBSITE_URL}/refund/`
    case 'privacy':
      return `${WEBSITE_URL}/privacy/`
  }
}

/**
 * E2E only (LUD_E2E=1 and unpackaged; the caller checks that): the mock Dodo server URL. Only
 * loopback http(s) URLs are accepted, so even a test run can never be pointed at another host.
 */
export function e2eDodoBaseUrl(raw: string | undefined): string | null {
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost' && u.hostname !== '[::1]') return null
  return `${u.protocol}//${u.host}`
}

/** Unroutable base used in E2E runs without a mock server: never reaches the real Dodo hosts. */
export const E2E_NO_NETWORK_BASE = 'http://127.0.0.1:9'
