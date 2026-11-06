// Update notices contract shared by main, preload and renderers (TPM D29). Pure: no electron, no DOM.
// There is no auto-update: main reads a small JSON manifest from our website and tells the user;
// "Download" opens the website download in the default browser and the user installs by hand.
// Renderers only ever see an UpdateView. Download URLs stay in main (the renderer asks main to open
// "the download for this computer", never a URL of its own).

/**
 * - current: up to date, or nothing known yet (no manifest ever fetched) → never blocks.
 * - available: a newer version exists (soft update). Nothing is blocked.
 * - required: this version is below the manifest's `minimum` (force update). Conversions are refused
 *   in main (`startJob` → UPDATE_REQUIRED) until the user installs a newer version.
 */
export type UpdateStatus = 'current' | 'available' | 'required'

export interface UpdateView {
  status: UpdateStatus
  /** This app's version, e.g. "0.1.0". */
  currentVersion: string
  /** The newest version from the manifest (null when no manifest is known). */
  latestVersion: string | null
  /** Release date from the manifest, "YYYY-MM-DD", or null. */
  releasedAt: string | null
  /** Short release notes from the manifest (plain text, already length-limited by main). */
  notes: string[]
  /** "Later" was pressed for this latest version (soft update only): no banner, no bubble. */
  dismissed: boolean
  /** Soft update the Uncle has not announced yet: show the "I learned new tricks!" bubble once. */
  hint: boolean
  /** ISO time of the last successful check (manifest fetched and valid), or null. */
  lastCheckedAt: string | null
}

/** Result of Settings → "Check for updates". `ok: false`: the check failed (offline, 5xx, bad JSON). */
export interface UpdateCheckResult {
  ok: boolean
  view: UpdateView
}

export function isUpdateRequired(view: Pick<UpdateView, 'status'> | null | undefined): boolean {
  return view?.status === 'required'
}

/** Settings shows the banner at the top: a forced update, or a soft one the user has not put off. */
export function showsUpdateBanner(view: Pick<UpdateView, 'status' | 'dismissed'> | null | undefined): boolean {
  if (!view) return false
  return view.status === 'required' || (view.status === 'available' && !view.dismissed)
}

export function versionLabel(version: string | null | undefined): string {
  return version ? `v${version}` : ''
}

/** Tray menu item, or null when there is nothing to say. */
export function updateTrayLabel(view: Pick<UpdateView, 'status' | 'latestVersion'> | null | undefined): string | null {
  if (!view || view.status === 'current') return null
  const v = view.latestVersion ? ` (${versionLabel(view.latestVersion)})` : ''
  return view.status === 'required' ? `Update required${v}…` : `Update available${v}…`
}

/** Friendly copy (no em dashes; the app's voice). */
export const UPDATE_MESSAGES = {
  hint: 'I learned new tricks! Update in Settings.',
  requiredTitle: 'Please update me',
  requiredBubble: (latest: string | null) =>
    `This version can't cook anymore. Get the free update${latest ? ` (${versionLabel(latest)})` : ''} from our website and install it.`,
  requiredBanner: (current: string, latest: string | null) =>
    `This version (${versionLabel(current)}) can't convert files anymore. Download ${latest ? versionLabel(latest) : 'the new version'}, it's free, then install it over this one.`,
  availableTitle: (latest: string | null) => `Update available${latest ? `: ${versionLabel(latest)}` : ''}`,
  howTo: 'Download it, then install it over this version. Your settings and licence stay.',
  upToDate: (current: string) => `You're up to date (${versionLabel(current)}).`,
  availableLine: (latest: string | null) => `${latest ? versionLabel(latest) : 'A new version'} is available.`,
  checkFailed: "Couldn't reach our website. Try again later.",
  checking: 'Checking…'
} as const

/** "2026-11-10" → "Nov 10, 2026" (fixed English month names: same text on every computer). */
export function formatReleaseDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]
  if (!month) return null
  return `${month} ${Number(m[3])}, ${m[1]}`
}
