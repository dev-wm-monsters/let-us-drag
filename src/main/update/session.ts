// The network session used only for the update manifest (TPM D29): an in-memory partition (no cookies
// kept, no cache), hardened like every session, where every request to another origin than the
// manifest's is cancelled. Same pattern as the licence session (security.ts restrictLicenceSession).

import type { Session } from 'electron'
import { hardenSession, isAllowedLicenceRequest } from '../security'
import type { UpdateFetchLike } from './checker'

export const UPDATE_PARTITION = 'lud-update'

export function restrictUpdateSession(ses: Session, manifestUrl: string, userAgent: string, log?: (message: string) => void): UpdateFetchLike {
  hardenSession(ses)
  ses.webRequest.onBeforeRequest((details, callback) => {
    const ok = isAllowedLicenceRequest(details.url, manifestUrl)
    if (!ok) log?.(`update session: blocked request: ${details.url.slice(0, 120)}`)
    callback({ cancel: !ok })
  })
  // Privacy: a generic user agent (no OS / Chromium details) and no Accept-Language.
  ses.setUserAgent(userAgent, '')
  return (url, init) => ses.fetch(url, { ...init, credentials: 'omit' })
}
