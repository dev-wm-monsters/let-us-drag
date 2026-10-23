// macOS Accessibility permission (needed by the global input hook).
// - isTrusted(): systemPreferences.isTrustedAccessibilityClient(false) (no prompt)
// - request(): isTrustedAccessibilityClient(true) shows the system prompt, then we poll every
//   2 s for up to 2 minutes and call onTrusted() once the user grants it.
// On other platforms there is nothing to grant: isTrusted() is true.

import { systemPreferences } from 'electron'

export const POLL_INTERVAL_MS = 2_000
export const POLL_MAX_MS = 120_000

export interface PermissionsDeps {
  platform: NodeJS.Platform
  onTrusted(): void
  /** Field diagnostics only: every isTrustedAccessibilityClient result. */
  debug?: (message: string) => void
}

export class AccessibilityPermission {
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private pollStarted = 0

  constructor(private readonly deps: PermissionsDeps) {}

  isTrusted(): boolean {
    if (this.deps.platform !== 'darwin') return true
    const trusted = systemPreferences.isTrustedAccessibilityClient(false)
    this.deps.debug?.(`isTrustedAccessibilityClient(false) = ${trusted}`)
    return trusted
  }

  /** Prompt (macOS) and start polling. Returns whether the app is trusted right now. */
  request(): boolean {
    if (this.deps.platform !== 'darwin') return true
    const trusted = systemPreferences.isTrustedAccessibilityClient(true)
    this.deps.debug?.(`isTrustedAccessibilityClient(true) = ${trusted}`)
    if (trusted) {
      this.stopPolling()
      this.deps.onTrusted()
      return true
    }
    this.startPolling()
    return false
  }

  stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private startPolling(): void {
    this.pollStarted = Date.now()
    if (this.pollTimer) return // already polling; the window was extended above
    this.pollTimer = setInterval(() => {
      if (this.isTrusted()) {
        this.stopPolling()
        this.deps.onTrusted()
      } else if (Date.now() - this.pollStarted > POLL_MAX_MS) {
        this.stopPolling()
      }
    }, POLL_INTERVAL_MS)
  }
}
