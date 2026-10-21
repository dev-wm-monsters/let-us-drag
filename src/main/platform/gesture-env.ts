// Pure decision: may the global input hook (uiohook) be started on this system?

import type { PlatformStatus } from '../../shared/types'

export interface GestureEnvInput {
  platform: NodeJS.Platform
  env: Readonly<Record<string, string | undefined>>
  /** macOS only: result of systemPreferences.isTrustedAccessibilityClient(false). */
  accessibilityTrusted?: boolean
}

export type GestureEnvDecision =
  | { canStart: true }
  | { canStart: false; reason: NonNullable<PlatformStatus['gestureUnavailableReason']> }

/** True when the Linux session is Wayland (global hooks only see XWayland apps there). */
export function isWaylandSession(env: Readonly<Record<string, string | undefined>>): boolean {
  const type = (env['XDG_SESSION_TYPE'] ?? '').toLowerCase()
  if (type === 'wayland') return true
  if (type === 'x11') return false
  return Boolean(env['WAYLAND_DISPLAY']) && !env['DISPLAY']
}

export function decideGestureEnv(input: GestureEnvInput): GestureEnvDecision {
  if (input.platform === 'darwin' && input.accessibilityTrusted !== true) {
    return { canStart: false, reason: 'mac-permission' }
  }
  if (input.platform === 'linux' && isWaylandSession(input.env)) {
    return { canStart: false, reason: 'wayland' }
  }
  return { canStart: true }
}

export function normalizePlatform(p: NodeJS.Platform): PlatformStatus['platform'] {
  if (p === 'darwin' || p === 'win32') return p
  return 'linux'
}
