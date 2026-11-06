// Per-page IPC channel allowlist (SEC-12) and the pure sender check (SEC-11). No electron import.

import { IPC } from '../shared/api'
import { rendererPageOf, type RendererPage, type RuntimeLayout } from './paths'

type InvokeChannel =
  | typeof IPC.describePaths
  | typeof IPC.startJob
  | typeof IPC.cancelJob
  | typeof IPC.revealPath
  | typeof IPC.getSettings
  | typeof IPC.setSettings
  | typeof IPC.getPlatformStatus
  | typeof IPC.requestAccessibility
  | typeof IPC.overlayInteractive
  | typeof IPC.overlayClickThrough
  | typeof IPC.overlayDone
  | typeof IPC.overlayEngaged
  | typeof IPC.openFeedWindow
  | typeof IPC.openSettingsWindow
  | typeof IPC.getLicence
  | typeof IPC.activateLicence
  | typeof IPC.deactivateLicence
  | typeof IPC.openLicenceLink
  | typeof IPC.openActivation
  | typeof IPC.getUpdate
  | typeof IPC.checkForUpdates
  | typeof IPC.dismissUpdate
  | typeof IPC.openUpdateDownload
  | typeof IPC.updateHintSeen
  | typeof IPC.openReportProblem

const ALL: readonly RendererPage[] = ['overlay', 'feed', 'settings']
const CONVERTERS: readonly RendererPage[] = ['overlay', 'feed']

/**
 * Which pages may call which renderer → main channel. Anything not listed here is refused.
 * - Conversions (describe/start/cancel/reveal): the two pages that host the Uncle.
 * - Settings changes: the settings window, and the feed window (it may offer quick toggles).
 * - Accessibility prompt: settings/onboarding only.
 * - Overlay lifecycle: the overlay only.
 * - Licence (D26): every page reads the state and may open the checkout / website links; only
 *   Settings activates or deactivates; the two Uncle pages may open Settings → Activate.
 */
export const IPC_ALLOWLIST: Readonly<Record<InvokeChannel, readonly RendererPage[]>> = {
  [IPC.describePaths]: CONVERTERS,
  [IPC.startJob]: CONVERTERS,
  [IPC.cancelJob]: CONVERTERS,
  [IPC.revealPath]: CONVERTERS,
  [IPC.getSettings]: ALL,
  [IPC.setSettings]: ['settings', 'feed'],
  [IPC.getPlatformStatus]: ALL,
  [IPC.requestAccessibility]: ['settings'],
  [IPC.overlayInteractive]: ['overlay'],
  [IPC.overlayClickThrough]: ['overlay'],
  [IPC.overlayDone]: ['overlay'],
  [IPC.overlayEngaged]: ['overlay'],
  [IPC.openFeedWindow]: ['settings'],
  [IPC.openSettingsWindow]: ['feed'],
  [IPC.getLicence]: ALL,
  [IPC.activateLicence]: ['settings'],
  [IPC.deactivateLicence]: ['settings'],
  [IPC.openLicenceLink]: ALL,
  [IPC.openActivation]: CONVERTERS,
  // Updates (D29): every page reads the state and may open the download; only Settings checks or
  // says "Later"; the two Uncle pages report the once-per-version bubble.
  [IPC.getUpdate]: ALL,
  [IPC.checkForUpdates]: ['settings'],
  [IPC.dismissUpdate]: ['settings'],
  [IPC.openUpdateDownload]: ALL,
  [IPC.updateHintSeen]: CONVERTERS,
  [IPC.openReportProblem]: ['settings'] // D28
}

export function isAllowedChannel(channel: string, page: RendererPage): boolean {
  const pages = (IPC_ALLOWLIST as Record<string, readonly RendererPage[] | undefined>)[channel]
  return pages !== undefined && pages.includes(page)
}

/** What we know about the sender of an ipcMain.handle call. */
export interface SenderInfo {
  /** Page main loaded into this webContents, or null when the webContents is not one of ours. */
  registeredPage: RendererPage | null
  /** event.senderFrame is the webContents' main frame (not a sub-frame, not gone). */
  isMainFrame: boolean
  /** URL of the sending frame. */
  frameUrl: string
}

/**
 * SEC-11 + SEC-12: the sender must be one of our windows, from its main frame, still showing the
 * page main loaded into it (same page, parsed URL), and that page must be allowed on `channel`.
 */
export function isTrustedSender(channel: string, sender: SenderInfo, layout: RuntimeLayout): boolean {
  if (!sender.registeredPage || !sender.isMainFrame) return false
  const page = rendererPageOf(sender.frameUrl, layout)
  if (page === null || page !== sender.registeredPage) return false
  return isAllowedChannel(channel, page)
}
