// Application wiring: windows, tray, engine, gesture, IPC, settings. Called once the app is ready
// and the single-instance lock is held (see index.ts).

import { app, BrowserWindow, ipcMain, Menu, powerMonitor, screen, session, utilityProcess } from 'electron'
import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { IPC } from '../shared/api'
import { DEBUG_DRAG_CHANNEL, DEBUG_REPORT_MAX } from '../shared/debug'
import { TEST_CANCEL_CHANNEL, type TestDropPayload } from '../shared/test-hooks'
import type { JobEvent, JobRequest, PlatformStatus, Settings } from '../shared/types'
import { OVERRIDES_FILE_NAME, parseOverlayOverrides, type ParsedOverrides } from './debug-overrides'
import { launchCommand, linuxAutostartPath, loginItemSettings, setLinuxAutostart } from './autostart'
import { EngineHost, type WorkerLike } from './engine-host'
import { HtmlToPdf } from './html-to-pdf'
import { parseOrThrow } from './ipc-validation'
import { registerIpc } from './ipc'
import { JobRegistry } from './job-registry'
import { devServerOrigin, engineWorkerPath, resourcesDir, type RendererPage, type RuntimeLayout } from './paths'
import { PdfRenderer } from './pdf-render'
import { GestureManager } from './platform/gesture'
import { AccessibilityPermission } from './platform/permissions'
import { blockRemoteRequests, hardenSession, hardenWebContents } from './security'
import { SettingsStore, settingsPatchSchema } from './settings-store'
import { AppTray } from './tray'
import { engineWorkerEnv } from './worker-env'
import type { WindowContext } from './windows/common'
import { createFeedWindow } from './windows/feed'
import { OverlayController } from './windows/overlay'
import { rectCenter } from './windows/overlay-geometry'
import { createSettingsWindow } from './windows/settings'

export interface AppOptions {
  e2e: boolean
  log: (message: string) => void
  /** Field diagnostics (LUD_DEBUG=1 or userData/debug.flag); undefined = off. */
  debug?: (message: string) => void
}

/** Overlay variants from the environment and userData/debug-overrides.json (README "Field diagnostics"). */
function readOverlayOverrides(userData: string): ParsedOverrides {
  let file: unknown
  const warnings: string[] = []
  try {
    file = JSON.parse(readFileSync(join(userData, OVERRIDES_FILE_NAME), 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(`${OVERRIDES_FILE_NAME}: ${String(err)}`)
  }
  const parsed = parseOverlayOverrides(process.env, file)
  return { ...parsed, warnings: [...warnings, ...parsed.warnings] }
}

export interface RunningApp {
  openSettingsWindow(): Promise<unknown>
}

function forkEngine(modulePath: string, env: Record<string, string> | undefined): WorkerLike {
  // env undefined → inherit process.env (unpackaged); packaged → no LUD_* keys (F-16, D18).
  const child = utilityProcess.fork(modulePath, [], env ? { serviceName: 'Let us drag! engine', env } : { serviceName: 'Let us drag! engine' })
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
  const { e2e, log, debug } = opts
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
    // F-09 / SEC-07: a packaged app never loads a dev server URL (paths.ts checks it again).
    devServerUrl: app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'],
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath()
  }

  // --- process-wide hardening -------------------------------------------------------------
  if (platform === 'darwin') app.dock?.hide()
  Menu.setApplicationMenu(platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]) : null)
  hardenSession(session.defaultSession)
  // SEC-150: our app windows never talk to the network (the dev server is allowed in development).
  blockRemoteRequests(session.defaultSession, devServerOrigin(layout), log)
  // SEC-05/06: every webContents (app windows, hidden helper windows, anything created later):
  // no navigation, no new windows, no <webview>, no permissions.
  app.on('web-contents-created', (_e, wc) => {
    hardenWebContents(wc)
    hardenSession(wc.session)
  })

  // --- settings ---------------------------------------------------------------------------
  const userData = app.getPath('userData')
  const settings = new SettingsStore(userData)
  await settings.load()
  if (quitting) return stub

  // --- windows ----------------------------------------------------------------------------
  /** webContents id → the page main loads into it (IPC trusts only these, for that page only). */
  const ownWebContents = new Map<number, RendererPage>()
  const ctx: WindowContext = {
    layout,
    e2e,
    register(win: BrowserWindow, page: RendererPage) {
      const id = win.webContents.id
      ownWebContents.set(id, page)
      win.on('closed', () => ownWebContents.delete(id))
    }
  }

  const variants = readOverlayOverrides(userData)
  for (const w of variants.warnings) log(`debug overrides: ${w}`)
  if (debug) {
    debug(`overlay overrides ${JSON.stringify(variants.overrides)} sources ${JSON.stringify(variants.sources)}`)
    const displays = screen.getAllDisplays().map((d) => `${d.id}:${d.bounds.width}x${d.bounds.height}@${d.scaleFactor}`)
    debug(`displays [${displays.join(' ')}]`)
  }
  const overlay = new OverlayController({
    ctx,
    getSettings: () => settings.get(),
    isQuitting: () => quitting,
    log,
    overrides: variants.overrides,
    debug
  })
  if (debug) watchOverlayRenderer(overlay, debug)
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
  const pdfPages = new PdfRenderer({ log })
  cleanups.push(() => pdfPages.dispose())
  // E2E only: QA may substitute a fake engine worker (absolute path) to test platform flows.
  const workerOverride = e2e ? process.env['LUD_E2E_ENGINE_WORKER'] : undefined
  const workerPath = workerOverride && isAbsolute(workerOverride) ? workerOverride : engineWorkerPath(layout)
  const engine = new EngineHost({
    // Computed per fork so a restarted worker gets the same filtered environment.
    fork: () => forkEngine(workerPath, engineWorkerEnv(process.env, app.isPackaged)),
    options: { cacheDir: join(userData, 'models'), resourcesDir: resourcesDir(layout) },
    htmlToPdf: (html) => pdf.convert(html),
    renderPdfPages: (bytes, options, signal) => pdfPages.render(bytes, options, signal),
    onEvent: (event: JobEvent) => {
      registry.record(event)
      broadcast(IPC.jobEvent, event, [overlay.win, feedWin.window])
      if (event.type === 'done' || event.type === 'error') overlay.jobFinished(event.jobId)
    },
    log
  })
  engine.start()
  cleanups.push(() => engine.stop())

  const startJob = (req: JobRequest, from: { page: RendererPage }): void => {
    const fromOverlay = from.page === 'overlay'
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
    onTrusted: () => void gesture.refresh(),
    debug
  })
  const gesture: GestureManager = new GestureManager({
    platform,
    env: process.env,
    neverStartHook: e2e,
    isAccessibilityTrusted: () => permission.isTrusted(),
    triggerKey: settings.get().triggerKey,
    onArm: () => overlay.arm(),
    onDisarm: () => overlay.disarm(),
    debug,
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
    app.setLoginItemSettings(
      loginItemSettings({
        platform,
        enabled,
        isPackaged: app.isPackaged,
        execPath: process.execPath,
        appPath: app.getAppPath(),
        portableExecutable: process.env['PORTABLE_EXECUTABLE_FILE']
      })
    )
  }

  // --- IPC --------------------------------------------------------------------------------
  registerIpc({
    layout,
    pageOfWebContents: (id) => ownWebContents.get(id) ?? null,
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
  // Only in E2E mode (LUD_E2E=1 and NOT packaged, see e2e-mode.ts); loaded lazily so the hook
  // code is not even evaluated in normal runs.
  if (e2e && !app.isPackaged) {
    const { createTestHooks, deliverFeedDrop, installTestHooks } = await import('./test-hooks')
    installTestHooks(
      createTestHooks({
        primaryCenter: () => rectCenter(screen.getPrimaryDisplay().workArea),
        overlay,
        jobEvents: () => registry.recordedEvents(),
        openFeedWindow: () => feedWin.open(),
        openSettingsWindow: () => settingsWin.open(),
        // Opens the Feed Window if needed (open() resolves once its page has loaded), then waits
        // for the renderer to subscribe before sending (B-055).
        sendFeedDrop: async (payload: TestDropPayload) => deliverFeedDrop(await feedWin.open(), payload),
        sendCancel: () => broadcast(TEST_CANCEL_CHANNEL, undefined, [overlay.win, feedWin.window])
      })
    )
    log('e2e hooks installed')
  }

  // --- privacy / safety -------------------------------------------------------------------
  // SEC-36: never leave the overlay on screen over a locked screen or across a suspend.
  const hideOverlay = (): void => overlay.forceHide()
  powerMonitor.on('lock-screen', hideOverlay)
  powerMonitor.on('suspend', hideOverlay)
  cleanups.push(() => {
    powerMonitor.removeListener('lock-screen', hideOverlay)
    powerMonitor.removeListener('suspend', hideOverlay)
  })
  // SEC-34: stop the hook when macOS Accessibility is revoked while we run (refresh() stops it).
  if (platform === 'darwin') {
    const lossTimer = setInterval(() => {
      if (gesture.isHookRunning && !permission.isTrusted()) void gesture.refresh()
    }, PERMISSION_LOSS_POLL_MS)
    lossTimer.unref()
    cleanups.push(() => clearInterval(lossTimer))
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

/**
 * Field diagnostics only: the overlay renderer's drag report (preload, DEBUG_DRAG_CHANNEL; sent only
 * when main started it with DEBUG_RENDERER_ARG), its console warnings/errors and load events.
 * Reports from any other sender are ignored.
 */
function watchOverlayRenderer(overlay: OverlayController, debug: (message: string) => void): void {
  const wc = overlay.win.webContents
  ipcMain.on(DEBUG_DRAG_CHANNEL, (event, text: unknown) => {
    if (event.sender.id !== wc.id || typeof text !== 'string') return
    debug(`overlay renderer: ${text.slice(0, DEBUG_REPORT_MAX)}`)
  })
  wc.on('console-message', (details) => {
    if (details.level === 'warning' || details.level === 'error') {
      debug(`overlay console ${details.level}: ${details.message.slice(0, DEBUG_REPORT_MAX)}`)
    }
  })
  wc.on('did-finish-load', () => debug('overlay page loaded'))
  wc.on('did-fail-load', (_e, code, description) => debug(`overlay page failed to load: ${code} ${description}`))
  wc.on('render-process-gone', (_e, details) => debug(`overlay renderer gone: ${details.reason}`))
}

/** How often (macOS) we check that the Accessibility grant is still there while the hook runs. */
const PERMISSION_LOSS_POLL_MS = 5_000

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
