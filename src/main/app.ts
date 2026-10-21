// Application wiring: windows, tray, engine, gesture, IPC, settings. Called once the app is ready
// and the single-instance lock is held (see index.ts).

import { app, BrowserWindow, Menu, screen, session, utilityProcess } from 'electron'
import { isAbsolute, join } from 'node:path'
import { IPC } from '../shared/api'
import type { JobEvent, JobRequest, PlatformStatus, Settings } from '../shared/types'
import { launchCommand, linuxAutostartPath, setLinuxAutostart } from './autostart'
import { EngineHost, type WorkerLike } from './engine-host'
import { HtmlToPdf } from './html-to-pdf'
import { parseOrThrow } from './ipc-validation'
import { registerIpc } from './ipc'
import { JobRegistry } from './job-registry'
import { engineWorkerPath, resourcesDir, type RuntimeLayout } from './paths'
import { GestureManager } from './platform/gesture'
import { AccessibilityPermission } from './platform/permissions'
import { hardenSession, hardenWebContents } from './security'
import { SettingsStore, settingsPatchSchema } from './settings-store'
import { createTestHooks, installTestHooks } from './test-hooks'
import { AppTray } from './tray'
import type { WindowContext } from './windows/common'
import { createFeedWindow } from './windows/feed'
import { OverlayController } from './windows/overlay'
import { rectCenter } from './windows/overlay-geometry'
import { createSettingsWindow } from './windows/settings'

export interface AppOptions {
  e2e: boolean
  log: (message: string) => void
}

export interface RunningApp {
  openSettingsWindow(): Promise<unknown>
}

function forkEngine(modulePath: string): WorkerLike {
  const child = utilityProcess.fork(modulePath, [], { serviceName: 'Let us drag! engine' })
  return {
    postMessage: (m) => child.postMessage(m),
    on(event: 'message' | 'exit', listener: ((m: unknown) => void) | ((code: number) => void)) {
      if (event === 'message') child.on('message', listener as (m: unknown) => void)
      else child.on('exit', listener as (code: number) => void)
    },
    kill: () => child.kill()
  }
}

export async function startApp(opts: AppOptions): Promise<RunningApp> {
  const { e2e, log } = opts
  const platform = process.platform
  // Quit can be requested at any time, even while we are still starting up: register the
  // handler first and give every component a cleanup as soon as it exists.
  let quitting = false
  const cleanups: (() => void)[] = []
  app.on('before-quit', () => {
    quitting = true
    for (const c of cleanups.splice(0).reverse()) {
      try {
        c()
      } catch (err) {
        log(`cleanup failed: ${String(err)}`)
      }
    }
  })
  const stub: RunningApp = { openSettingsWindow: async () => undefined }

  const layout: RuntimeLayout = {
    mainDir: __dirname,
    devServerUrl: process.env['ELECTRON_RENDERER_URL'],
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath()
  }

  // --- process-wide hardening -------------------------------------------------------------
  if (platform === 'darwin') app.dock?.hide()
  Menu.setApplicationMenu(platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]) : null)
  hardenSession(session.defaultSession)
  app.on('web-contents-created', (_e, wc) => hardenWebContents(wc))

  // --- settings ---------------------------------------------------------------------------
  const userData = app.getPath('userData')
  const settings = new SettingsStore(userData)
  await settings.load()
  if (quitting) return stub

  // --- windows ----------------------------------------------------------------------------
  const ownWebContents = new Set<number>()
  const ctx: WindowContext = {
    layout,
    e2e,
    register(win: BrowserWindow) {
      const id = win.webContents.id
      ownWebContents.add(id)
      win.on('closed', () => ownWebContents.delete(id))
    }
  }

  const overlay = new OverlayController({ ctx, getSettings: () => settings.get(), isQuitting: () => quitting, log })
  cleanups.push(() => overlay.dispose())
  const feedWin = createFeedWindow(ctx)
  const settingsWin = createSettingsWindow(ctx)

  const ownWindows = (): BrowserWindow[] =>
    BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && ownWebContents.has(w.webContents.id))
  const broadcast = (channel: string, payload: unknown, targets: (BrowserWindow | null)[] = ownWindows()): void => {
    for (const w of targets) if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }

  // --- engine -----------------------------------------------------------------------------
  const registry = new JobRegistry(e2e)
  const pdf = new HtmlToPdf(log)
  cleanups.push(() => pdf.dispose())
  // E2E only: QA may substitute a fake engine worker (absolute path) to test platform flows.
  const workerOverride = e2e ? process.env['LUD_E2E_ENGINE_WORKER'] : undefined
  const workerPath = workerOverride && isAbsolute(workerOverride) ? workerOverride : engineWorkerPath(layout)
  const engine = new EngineHost({
    fork: () => forkEngine(workerPath),
    options: { cacheDir: join(userData, 'models'), resourcesDir: resourcesDir(layout) },
    htmlToPdf: (html) => pdf.convert(html),
    onEvent: (event: JobEvent) => {
      registry.record(event)
      broadcast(IPC.jobEvent, event, [overlay.win, feedWin.window])
      if (event.type === 'done' || event.type === 'error') overlay.jobFinished(event.jobId)
    },
    log
  })
  engine.start()
  cleanups.push(() => engine.stop())

  const startJob = (req: JobRequest, fromOverlay: boolean): void => {
    if (fromOverlay) overlay.jobStarted(req.id)
    try {
      engine.run(req)
    } catch (err) {
      if (fromOverlay) overlay.jobFinished(req.id)
      throw err
    }
  }

  // --- gesture + permissions --------------------------------------------------------------
  const permission = new AccessibilityPermission({
    platform,
    onTrusted: () => void gesture.refresh()
  })
  const gesture: GestureManager = new GestureManager({
    platform,
    env: process.env,
    neverStartHook: e2e,
    isAccessibilityTrusted: () => permission.isTrusted(),
    triggerKey: settings.get().triggerKey,
    onArm: () => overlay.arm(),
    onDisarm: () => overlay.disarm(),
    onStatusChanged: (status: PlatformStatus) => {
      broadcast(IPC.platformStatusChanged, status)
      tray.update({ gestureUnavailable: unavailableLabel(status) })
    },
    log
  })

  // --- tray -------------------------------------------------------------------------------
  const tray = new AppTray({
    platform,
    resourcesDir: resourcesDir(layout),
    openFeedWindow: () => void feedWin.open(),
    openSettingsWindow: () => void settingsWin.open(),
    setPaused: (paused) => {
      void gesture.setPaused(paused).then(() => tray.update({ paused }))
    },
    quit: () => app.quit(),
    log
  })
  cleanups.push(() => permission.stopPolling(), () => gesture.stop())
  tray.create()
  cleanups.push(() => tray.destroy())
  const initialStatus = await gesture.refresh()
  if (quitting) {
    gesture.stop() // the hook may have started after the cleanups ran
    return stub
  }
  tray.update({ gestureUnavailable: unavailableLabel(initialStatus) })

  // --- settings side effects --------------------------------------------------------------
  settings.onChange((next: Settings, prev: Settings) => {
    broadcast(IPC.settingsChanged, next)
    if (next.triggerKey !== prev.triggerKey) gesture.setTriggerKey(next.triggerKey)
    if (next.launchAtLogin !== prev.launchAtLogin) {
      applyLaunchAtLogin(next.launchAtLogin).catch((err: unknown) => log(`launch at login failed: ${String(err)}`))
    }
  })

  async function applyLaunchAtLogin(enabled: boolean): Promise<void> {
    if (platform === 'linux') {
      const cmd = launchCommand({
        execPath: process.execPath,
        appImage: process.env['APPIMAGE'],
        isPackaged: app.isPackaged,
        appPath: app.getAppPath()
      })
      await setLinuxAutostart(enabled, linuxAutostartPath(process.env), cmd)
      return
    }
    const portable = platform === 'win32' ? process.env['PORTABLE_EXECUTABLE_FILE'] : undefined
    app.setLoginItemSettings(portable ? { openAtLogin: enabled, path: portable } : { openAtLogin: enabled })
  }

  // --- IPC --------------------------------------------------------------------------------
  registerIpc({
    layout,
    isOwnWebContents: (id) => ownWebContents.has(id),
    overlayWebContentsId: () => overlay.webContentsId,
    getSettings: () => settings.get(),
    updateSettings: (patch) => settings.update(parseOrThrow(settingsPatchSchema, patch, 'settings')),
    startJob,
    cancelJob: (jobId) => engine.cancel(jobId),
    registry,
    platformStatus: () => gesture.getStatus(),
    requestAccessibility: () => {
      const trusted = permission.request()
      void gesture.refresh()
      return trusted
    },
    overlay,
    openFeedWindow: () => feedWin.open(),
    openSettingsWindow: () => settingsWin.open()
  })

  // --- E2E hooks --------------------------------------------------------------------------
  if (e2e) {
    installTestHooks(
      createTestHooks({
        primaryCenter: () => rectCenter(screen.getPrimaryDisplay().workArea),
        overlay,
        jobEvents: () => registry.recordedEvents(),
        openFeedWindow: () => feedWin.open(),
        openSettingsWindow: () => settingsWin.open()
      })
    )
  }

  // --- lifecycle --------------------------------------------------------------------------
  // A tray app keeps running with no windows open.
  app.on('window-all-closed', () => undefined)

  // First run: onboarding in the settings window (not under E2E, to keep boots deterministic).
  if (!settings.get().firstRunDone && !e2e && !quitting) {
    await settingsWin.open().catch((err: unknown) => log(`onboarding window failed: ${String(err)}`))
    await settings.update({ firstRunDone: true }).catch((err: unknown) => log(`saving settings failed: ${String(err)}`))
  }

  return { openSettingsWindow: () => settingsWin.open() }
}

function unavailableLabel(status: PlatformStatus): string | null {
  if (status.gestureAvailable) return null
  switch (status.gestureUnavailableReason) {
    case 'wayland':
      return 'not available on Wayland'
    case 'mac-permission':
      return 'needs Accessibility permission'
    case 'hook-failed':
    default:
      return 'unavailable'
  }
}
