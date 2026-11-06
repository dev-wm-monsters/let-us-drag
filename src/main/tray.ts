// Tray / menu-bar icon: (update known: Update available (v…)…), (unlicensed: Buy a licence…, Activate…), Open Feed Window, Settings…, Pause gesture, Quit.

import { existsSync } from 'node:fs'
import { Menu, nativeImage, Tray, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import { trayIconCandidates, trayIconSize } from './paths'

export interface TrayDeps {
  platform: NodeJS.Platform
  resourcesDir: string
  openFeedWindow(): void
  openSettingsWindow(): void
  setPaused(paused: boolean): void
  quit(): void
  /** D26: open the checkout in the default browser. */
  buyLicence(): void
  /** D26: open Settings → Activate. */
  openActivation(): void
  /** Development builds only: forget the licence locally. */
  resetLicence?(): void
  /** D29: "Update available (v…)…" → Settings, where the Updates banner is. */
  openUpdate?(): void
  log?: (message: string) => void
}

export interface TrayState {
  paused: boolean
  /** null when the gesture works; otherwise a short reason shown in the menu. */
  gestureUnavailable: string | null
  /** An active licence: hides "Buy a licence…" / "Activate…". */
  licensed: boolean
  /** D29: "Update available (v0.2.0)…" / "Update required (v0.2.0)…", or null/absent. */
  update?: string | null
}

/** The menu template (pure; unit tested). */
export function trayMenuTemplate(state: TrayState, deps: Omit<TrayDeps, 'platform' | 'resourcesDir' | 'log'>): MenuItemConstructorOptions[] {
  const unavailable = state.gestureUnavailable
  const licence: MenuItemConstructorOptions[] = state.licensed
    ? []
    : [
        { label: 'Buy a licence…', click: () => deps.buyLicence() },
        { label: 'Activate…', click: () => deps.openActivation() },
        { type: 'separator' }
      ]
  // --- updates (D29): first item while an update is known
  const update: MenuItemConstructorOptions[] = state.update
    ? [{ label: state.update, click: () => deps.openUpdate?.() }, { type: 'separator' }]
    : []
  const dev: MenuItemConstructorOptions[] = deps.resetLicence ? [{ label: 'Reset licence (development)', click: () => deps.resetLicence?.() }] : []
  return [
    ...update,
    ...licence,
    { label: 'Open Feed Window', click: () => deps.openFeedWindow() },
    { label: 'Settings…', click: () => deps.openSettingsWindow() },
    { type: 'separator' },
    {
      label: unavailable ? `Pause gesture (${unavailable})` : 'Pause gesture',
      type: 'checkbox',
      checked: state.paused,
      enabled: unavailable === null,
      click: (item) => deps.setPaused(item.checked)
    },
    { type: 'separator' },
    ...dev,
    { label: 'Quit', click: () => deps.quit() }
  ]
}

/** Load the first existing tray icon; fall back to the app icon resized. */
export function loadTrayIcon(platform: NodeJS.Platform, resourcesDir: string): NativeImage {
  for (const c of trayIconCandidates(platform, resourcesDir)) {
    if (!existsSync(c.path)) continue
    // createFromPath also picks up @2x variants next to the file.
    let img = nativeImage.createFromPath(c.path)
    if (img.isEmpty()) continue
    if (c.resize) {
      const size = trayIconSize(platform)
      img = img.resize({ width: size, height: size, quality: 'best' })
    }
    if (c.template) img.setTemplateImage(true)
    return img
  }
  return nativeImage.createEmpty()
}

export class AppTray {
  private tray: Tray | null = null
  private state: TrayState = { paused: false, gestureUnavailable: null, licensed: false }

  constructor(private readonly deps: TrayDeps) {}

  create(): boolean {
    try {
      this.tray = new Tray(loadTrayIcon(this.deps.platform, this.deps.resourcesDir))
      this.tray.setToolTip("Let's Drag!")
      if (this.deps.platform === 'win32') {
        // Windows users expect a left click to do something.
        this.tray.on('click', () => this.tray?.popUpContextMenu())
      }
      this.render()
      this.deps.log?.('tray created')
      return true
    } catch (err) {
      this.deps.log?.(`tray creation failed: ${String(err)}`)
      this.tray = null
      return false
    }
  }

  get exists(): boolean {
    return this.tray !== null && !this.tray.isDestroyed()
  }

  update(patch: Partial<TrayState>): void {
    this.state = { ...this.state, ...patch }
    this.render()
  }

  destroy(): void {
    if (this.tray && !this.tray.isDestroyed()) this.tray.destroy()
    this.tray = null
  }

  private render(): void {
    if (!this.tray || this.tray.isDestroyed()) return
    this.tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(this.state, this.deps)))
  }
}
