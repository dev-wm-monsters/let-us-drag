// Update notices configuration (TPM D29). Pure: no electron import.
//
// UPDATE_MANIFEST_URL is a build-time setting, injected by electron-vite `define`
// (electron.vite.config.ts; the build fails on a value that is not an https URL). Default: our website.

import { WEBSITE_URL } from '../../shared/licence'

export const DEFAULT_UPDATE_MANIFEST_URL = `${WEBSITE_URL}/update.json`

/** The only host download links may point to (anything else falls back to the download page). */
export const UPDATE_DOWNLOAD_HOST = new URL(WEBSITE_URL).hostname

/** Where "Download" goes when the manifest has no usable link for this computer. */
export const DOWNLOAD_PAGE_URL = `${WEBSITE_URL}/#download`

/** Installer keys in the manifest's `downloads` (OS + CPU of the running app). */
export const PLATFORM_KEYS = ['mac-arm64', 'mac-x64', 'win-x64', 'win-arm64', 'linux-x64', 'linux-arm64'] as const
export type PlatformKey = (typeof PLATFORM_KEYS)[number]

export function updatePlatformKey(platform: NodeJS.Platform, arch: string): PlatformKey | null {
  const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform === 'linux' ? 'linux' : null
  if (!os || (arch !== 'x64' && arch !== 'arm64')) return null
  const key = `${os}-${arch}`
  return (PLATFORM_KEYS as readonly string[]).includes(key) ? (key as PlatformKey) : null
}

/** An absolute https URL without credentials, or null. */
export function parseManifestUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > 2048) return null
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null
  return u.href
}

/** The manifest URL this build was made with. */
export function buildManifestUrl(): string {
  const raw = typeof __UPDATE_MANIFEST_URL__ === 'string' ? __UPDATE_MANIFEST_URL__ : undefined
  return parseManifestUrl(raw) ?? DEFAULT_UPDATE_MANIFEST_URL
}

/**
 * E2E only (LUD_E2E=1 and unpackaged; the caller checks that): the mock manifest server. Only loopback
 * http(s) URLs are accepted, so even a test run can never be pointed at another host.
 */
export function e2eManifestUrl(raw: string | undefined): string | null {
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost' && u.hostname !== '[::1]') return null
  return `${u.protocol}//${u.host}${u.pathname}`
}

/** Unroutable manifest URL used in E2E runs without a mock server: never reaches the website. */
export const E2E_NO_UPDATE_URL = 'http://127.0.0.1:9/update.json'
