// Application wiring: windows, tray, engine, gesture, IPC, settings. Called once the app is ready
// and the single-instance lock is held (see index.ts).

import { app, BrowserWindow, ipcMain, Menu, powerMonitor, safeStorage, screen, session, shell, utilityProcess } from 'electron'
import { readFileSync } from 'node:fs'
import { release } from 'node:os'
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
import { buildLicenceConfig, buildLicensingEnabled, e2eDodoBaseUrl, E2E_NO_NETWORK_BASE, licenceLinkUrl } from './licence/config'
import { DodoClient, type FetchLike } from './licence/dodo-client'
import { deviceLabel } from './licence/logic'
import { LicenceManager } from './licence/manager'
import { LicenceStore, loadInstallId } from './licence/store'
import { devServerOrigin, engineWorkerPath, modifierHelperPath, resourcesDir, type RendererPage, type RuntimeLayout } from './paths'
import { PdfRenderer } from './pdf-render'
import { GestureManager } from './platform/gesture'
import { AccessibilityPermission } from './platform/permissions'
import { blockRemoteRequests, hardenSession, hardenWebContents, restrictLicenceSession } from './security'
import { SettingsStore, settingsPatchSchema } from './settings-store'
import { AppTray } from './tray'
import { buildManifestUrl, e2eManifestUrl, E2E_NO_UPDATE_URL, updatePlatformKey } from './update/config'
import { UpdateManager } from './update/manager'
import { restrictUpdateSession, UPDATE_PARTITION } from './update/session'
import { UpdateStore } from './update/store'
import { updateTrayLabel } from '../shared/update'
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
  const parsed = parseOverlayOverrides(process.env, file, process.platform)
  return { ...parsed, warnings: [...warnings, ...parsed.warnings] }
}

export interface RunningApp {
  openSettingsWindow(): Promise<unknown>
}

function forkEngine(modulePath: string, env: Record<string, string> | undefined): WorkerLike {
  // env undefined → inherit process.env (unpackaged); packaged → no LUD_* keys (F-16, D18).
  const child = utilityProcess.fork(modulePath, [], env ? { serviceName: "Let's Drag! engine", env } : { serviceName: "Let's Drag! engine" })
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

  // --- licence (TPM D26) --------------------------------------------------------------------
  // Network: only the three public Dodo licence endpoints, from main (never a renderer), and never
  // during start-up itself (the background re-check runs after a random delay; D22 exception).
  // E2E (LUD_E2E=1 AND unpackaged only, D12/D18): LUD_E2E_DODO_URL points the client at a local mock
  // server (loopback only), otherwise at an unroutable address, so tests never reach Dodo.
  const licenceConfig = buildLicenceConfig()
  const e2eLicence = e2e && !app.isPackaged
  const dodoBase = e2eLicence ? (e2eDodoBaseUrl(process.env['LUD_E2E_DODO_URL']) ?? E2E_NO_NETWORK_BASE) : licenceConfig.apiBaseUrl
  const installId = await loadInstallId(userData, log)
  // A separate in-memory session: Chromium's network stack (system proxy settings apply), only the
  // Dodo origin is reachable from it, and the app windows' session keeps blocking every remote request.
  const licenceSession = session.fromPartition('lud-licence', { cache: false })
  restrictLicenceSession(licenceSession, dodoBase, log)
  // Privacy (website promise): a generic user agent (no OS / Chromium details) and no Accept-Language.
  licenceSession.setUserAgent(`LetsDrag/${app.getVersion()}`, '')
  const licenceFetch: FetchLike = (url, init) => licenceSession.fetch(url, { ...init, credentials: 'omit' })
  const licence = new LicenceManager({
    config: licenceConfig,
    client: new DodoClient({ baseUrl: dodoBase, fetchImpl: licenceFetch, ...(e2eLicence ? { timeoutMs: E2E_DODO_TIMEOUT_MS } : {}) }),
    store: new LicenceStore({ dir: userData, encryptor: safeStorage, log }),
    deviceLabel: deviceLabel(platform, process.arch, release(), installId),
    ...(e2eLicence ? { confirmDelayMs: E2E_CONFIRM_DELAY_MS } : {}),
    log
  })
  await licence.init()
  if (e2eLicence && process.env['LUD_E2E_LICENSE'] === 'active') licence.seedActive()
  // Team / demo builds (LUD_LICENSING=off at build time): everything unlocked, no licence calls.
  if (!buildLicensingEnabled()) licence.enableTeamBuild()
  log(`licence: ${licenceConfig.environment} environment, ${licence.status}`)
  cleanups.push(() => licence.stop())
  /** URLs "opened" in E2E runs (no browser is started then). */
  const openedUrls: string[] = []
  const openLicenceLink = async (link: Parameters<typeof licenceLinkUrl>[0]): Promise<void> => {
    const url = licenceLinkUrl(link, licenceConfig)
    if (e2eLicence) {
      openedUrls.push(url)
      return
    }
    await shell.openExternal(url)
  }
  if (quitting) return stub

  // --- updates (TPM D29) begin ---------------------------------------------------------------
  // Soft / force update notices, no auto-install. Network: one plain GET of the manifest, from main
  // only, through its own in-memory session restricted to the manifest's origin, never during
  // start-up itself (first check after a random 20–60 s delay; D22 exception, like the licence).
  // E2E (LUD_E2E=1 AND unpackaged only, D12/D18): LUD_E2E_UPDATE_URL points at a loopback mock,
  // otherwise at an unroutable address, so E2E runs start with no update state.
  const e2eUpdate = e2e && !app.isPackaged
  const manifestUrl = e2eUpdate ? (e2eManifestUrl(process.env['LUD_E2E_UPDATE_URL']) ?? E2E_NO_UPDATE_URL) : buildManifestUrl()
  const updates = new UpdateManager({
    currentVersion: app.getVersion(),
    manifestUrl,
    fetchImpl: restrictUpdateSession(session.fromPartition(UPDATE_PARTITION, { cache: false }), manifestUrl, `LetsDrag/${app.getVersion()}`, log),
    store: new UpdateStore({ dir: userData, log }),
    platformKey: updatePlatformKey(platform, process.arch),
    ...(e2eUpdate ? { timeoutMs: E2E_UPDATE_TIMEOUT_MS } : {}),
    log
  })
  await updates.init()
  cleanups.push(() => updates.stop())
  const openUpdateDownload = async (): Promise<void> => {
    const url = updates.downloadUrl()
    if (e2eUpdate) {
      openedUrls.push(url) // E2E: recorded, no browser starts
      return
    }
    await shell.openExternal(url)
  }
  // --- updates (TPM D29) end
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

  licence.onChange((view) => {
    broadcast(IPC.licenceChanged, view)
    tray.update({ licensed: view.status === 'active' })
  })

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
    // D26, second line of defence (ipc.ts already answers LICENCE_REQUIRED): no licence, no engine job.
    if (!licence.isUnlocked()) throw new Error('No active licence.')
    // D29, same: a forced update blocks every job (ipc.ts answers UPDATE_REQUIRED first).
    if (updates.isBlocked()) throw new Error('Update required.')
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
    modifierHelperPath: modifierHelperPath(layout, process.arch),
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
    buyLicence: () => void openLicenceLink('checkout').catch((err: unknown) => log(`open checkout failed: ${String(err)}`)),
    openActivation: () => void settingsWin.open(),
    openUpdate: () => void settingsWin.open(), // D29
    // Hidden developer action (unpackaged builds only): forget the licence locally, no network.
    ...(app.isPackaged ? {} : { resetLicence: () => void licence.resetLocal() }),
    log
  })
  cleanups.push(() => permission.stopPolling(), () => gesture.stop())
  tray.create()
  tray.update({ licensed: licence.isUnlocked() })
  cleanups.push(() => tray.destroy())
  // --- updates (D29): renderers and the tray follow the update state
  tray.update({ update: updateTrayLabel(updates.view()) })
  updates.onChange((view) => {
    broadcast(IPC.updateChanged, view)
    tray.update({ update: updateTrayLabel(view) })
  })
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
    openSettingsWindow: () => settingsWin.open(),
    licence: {
      isUnlocked: () => licence.isUnlocked(),
      view: () => licence.view(),
      activate: (key) => licence.activate(key),
      deactivate: () => licence.deactivate(),
      openLink: openLicenceLink,
      openActivation: () => settingsWin.open()
    },
    update: {
      isBlocked: () => updates.isBlocked(),
      view: () => updates.view(),
      check: () => updates.checkForUpdates(),
      dismiss: () => updates.dismiss(),
      openDownload: openUpdateDownload,
      hintSeen: () => updates.hintSeen()
    }
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
        sendCancel: () => broadcast(TEST_CANCEL_CHANNEL, undefined, [overlay.win, feedWin.window]),
        licence: {
          view: () => licence.view(),
          recheckNow: () => licence.recheckNow(),
          resume: () => licence.onResume(),
          openedUrls: () => [...openedUrls]
        },
        update: {
          view: () => updates.view(),
          checkNow: () => updates.checkNow(),
          resume: () => updates.onResume()
        }
      })
    )
    log('e2e hooks installed')
  }

  // --- privacy / safety -------------------------------------------------------------------
  // SEC-36: never leave the overlay on screen over a locked screen or across a suspend.
  const hideOverlay = (): void => overlay.forceHide()
  powerMonitor.on('lock-screen', hideOverlay)
  powerMonitor.on('suspend', hideOverlay)
  // D26: after waking from sleep, re-check the licence (later, silently) if the 24 h are over.
  const licenceResume = (): void => licence.onResume()
  powerMonitor.on('resume', licenceResume)
  cleanups.push(() => {
    powerMonitor.removeListener('lock-screen', hideOverlay)
    powerMonitor.removeListener('suspend', hideOverlay)
    powerMonitor.removeListener('resume', licenceResume)
  })
  // B-078 (Windows): key-ups that happen on the lock screen never reach the low-level hook (Win+L
  // leaves the Windows key "held"); restarting the hook re-reads the real modifier state.
  if (platform === 'win32') {
    const resyncHook = (): void => void gesture.restartHook()
    powerMonitor.on('unlock-screen', resyncHook)
    powerMonitor.on('resume', resyncHook)
    cleanups.push(() => {
      powerMonitor.removeListener('unlock-screen', resyncHook)
      powerMonitor.removeListener('resume', resyncHook)
    })
  }
  // SEC-34: stop the hook when macOS Accessibility is revoked while we run (refresh() stops it).
  if (platform === 'darwin') {
    const lossTimer = setInterval(() => {
      if (gesture.isHookRunning && !permission.isTrusted()) void gesture.refresh()
    }, PERMISSION_LOSS_POLL_MS)
    lossTimer.unref()
    cleanups.push(() => clearInterval(lossTimer))
  }

  // Background licence re-check (D26): scheduled, never during start-up itself.
  licence.start()
  // --- updates (D29): background checks (first after 20–60 s, then every 6 h, and after a long sleep)
  updates.start()
  const updateResume = (): void => updates.onResume()
  powerMonitor.on('resume', updateResume)
  cleanups.push(() => powerMonitor.removeListener('resume', updateResume))

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

/** E2E only: short Dodo request timeout and confirm delay, so the re-check specs run in seconds. */
const E2E_DODO_TIMEOUT_MS = 1_500
const E2E_CONFIRM_DELAY_MS = 200
/** E2E only: short manifest request timeout (D29). */
const E2E_UPDATE_TIMEOUT_MS = 1_500

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
