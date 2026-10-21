// Tray / menu-bar icon: Open Feed Window, Settings…, Pause gesture, Quit.

import { existsSync } from 'node:fs'
import { Menu, nativeImage, Tray, type NativeImage } from 'electron'
import { trayIconCandidates, trayIconSize } from './paths'

export interface TrayDeps {
  platform: NodeJS.Platform
  resourcesDir: string
  openFeedWindow(): void
  openSettingsWindow(): void
  setPaused(paused: boolean): void
  quit(): void
  log?: (message: string) => void
}

export interface TrayState {
  paused: boolean
  /** null when the gesture works; otherwise a short reason shown in the menu. */
  gestureUnavailable: string | null
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
  private state: TrayState = { paused: false, gestureUnavailable: null }

  constructor(private readonly deps: TrayDeps) {}

  create(): boolean {
    try {
      this.tray = new Tray(loadTrayIcon(this.deps.platform, this.deps.resourcesDir))
      this.tray.setToolTip('Let us drag!')
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
    const unavailable = this.state.gestureUnavailable
    const menu = Menu.buildFromTemplate([
      { label: 'Open Feed Window', click: () => this.deps.openFeedWindow() },
      { label: 'Settings…', click: () => this.deps.openSettingsWindow() },
      { type: 'separator' },
      {
        label: unavailable ? `Pause gesture (${unavailable})` : 'Pause gesture',
        type: 'checkbox',
        checked: this.state.paused,
        enabled: unavailable === null,
        click: (item) => this.deps.setPaused(item.checked)
      },
      { type: 'separator' },
      { label: 'Quit', click: () => this.deps.quit() }
    ])
    this.tray.setContextMenu(menu)
  }
}
