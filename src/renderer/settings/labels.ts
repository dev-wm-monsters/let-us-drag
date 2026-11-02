// Pure text helpers for the Settings window (unit tested).
import { LICENCE_SEATS, type LicenceStatus, type LicenceView } from '../../shared/licence'
import type { PlatformStatus, TriggerKey } from '../../shared/types'

export type Platform = PlatformStatus['platform']

export function triggerKeyLabels(platform: Platform): Record<TriggerKey, string> {
  if (platform === 'darwin') return { shift: 'Shift ⇧', alt: 'Option ⌥', ctrl: 'Control ⌃', meta: 'Command ⌘' }
  if (platform === 'win32') return { shift: 'Shift', alt: 'Alt', ctrl: 'Ctrl', meta: 'Windows key' }
  return { shift: 'Shift', alt: 'Alt', ctrl: 'Ctrl', meta: 'Super' }
}

export function gestureMessage(status: PlatformStatus | null): { ok: boolean; text: string } {
  if (!status) return { ok: false, text: 'Checking…' }
  if (status.gestureAvailable) return { ok: true, text: 'Drag gesture is ready. Drag a file and hold the trigger key.' }
  switch (status.gestureUnavailableReason) {
    case 'wayland':
      return {
        ok: false,
        text: "On Wayland, apps can't watch global drags. Use the Feed Window instead: it works the same way."
      }
    case 'mac-permission':
      return {
        ok: false,
        text: 'macOS needs your OK (Accessibility) before I can notice drags. Until then, the Feed Window works.'
      }
    case 'hook-failed':
      return { ok: false, text: "I couldn't start the global gesture listener. The Feed Window still works." }
    default:
      return { ok: false, text: 'The global drag gesture is not available. The Feed Window still works.' }
  }
}

/** Settings → Licence: the status pill (D26). */
export function licenceStatusLabel(status: LicenceStatus): { text: string; tone: 'ok' | 'warn' | 'bad' } {
  switch (status) {
    case 'active':
      return { text: 'Active', tone: 'ok' }
    case 'disabled':
      return { text: 'Disabled', tone: 'bad' }
    case 'reactivate':
      return { text: 'Needs activating again', tone: 'warn' }
    case 'unlicensed':
      return { text: 'Not activated', tone: 'warn' }
  }
}

/** "30 Oct 2026" (locale-aware); '' for a missing / invalid date. */
export function shortDate(iso: string | null | undefined, locale?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** One line under the status: what the licence covers, or where the key came from. */
export function licenceSummary(view: Pick<LicenceView, 'status' | 'maskedKey' | 'activatedAt'>, locale?: string): string {
  if (view.status === 'active') {
    const when = shortDate(view.activatedAt, locale)
    return `Activated on this computer${when ? ` on ${when}` : ''}. Works on ${LICENCE_SEATS} computers, all v1.x updates included.`
  }
  if (view.status === 'unlicensed') return `One-time purchase, no subscription. Works on ${LICENCE_SEATS} computers.`
  return ''
}
