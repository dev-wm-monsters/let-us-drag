// Pure text helpers for the Settings window (unit tested).
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
        text: "On Wayland, apps can't watch global drags. Use the Feed Window instead — it works the same way."
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
