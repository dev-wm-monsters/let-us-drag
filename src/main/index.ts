// Main process entry: privileged scheme registration, single-instance lock, then app wiring (app.ts).

import { app, dialog, protocol } from 'electron'
import { startApp, type RunningApp } from './app'
import { forbiddenDebugSwitch } from './debug-switches'
import { isE2E } from './e2e-mode'
import { createLogger } from './logger'
import { SANDBOX_PRIVILEGES, SANDBOX_SCHEME } from './sandbox-protocol'

// E2E mode needs LUD_E2E=1 AND an unpackaged app (TPM D12, SEC-18).
const e2e = isE2E(process.env, app.isPackaged)
const log = createLogger(!app.isPackaged || process.env['LUD_DEBUG'] === '1')

// userData: never overridden here (TPM D5). E2E isolates it with the Chromium switch
// --user-data-dir=<dir>, which app.getPath('userData') honours.

// Custom scheme for the hidden PDF helper windows; must happen before 'ready'.
protocol.registerSchemesAsPrivileged([{ scheme: SANDBOX_SCHEME, privileges: { ...SANDBOX_PRIVILEGES } }])

// TPM D22 / F-23: a packaged build never runs with a remote-debugging (CDP) endpoint. Quit before
// any window, the single-instance lock or the hook exist. Unpackaged runs (dev, E2E) keep it.
const debugSwitch = app.isPackaged ? forbiddenDebugSwitch(process.argv, (name) => app.commandLine.hasSwitch(name), process.platform) : null

if (debugSwitch !== null) {
  try {
    process.stderr.write(`[lud] refusing to start with --${debugSwitch}\n`)
  } catch {
    // no console (Windows GUI app): nothing to report to
  }
  app.exit(1)
} else if (!app.requestSingleInstanceLock()) {
  // Another instance owns this profile: it shows its settings window (below); we just leave.
  app.quit()
} else {
  let running: RunningApp | null = null
  let showSettingsWhenReady = false
  app.on('second-instance', () => {
    // Launching the app again shows the settings window (the app lives in the tray). If we are
    // still starting up, do it as soon as startup has finished.
    if (running) void running.openSettingsWindow()
    else showSettingsWhenReady = true
  })
  // macOS: launching the app again from Finder/Launchpad/Spotlight does NOT start a second
  // process (so no 'second-instance'): LaunchServices sends the running app a "reopen" event,
  // which Electron reports as 'activate'. Treat it like a second launch. Ignored while we are
  // still starting up (the first-run onboarding window opens on its own then).
  app.on('activate', () => {
    if (running) void running.openSettingsWindow()
  })
  app
    .whenReady()
    .then(async () => {
      running = await startApp({ e2e, log })
      if (showSettingsWhenReady) void running.openSettingsWindow()
    })
    .catch((err: unknown) => {
      log(`startup failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
      dialog.showErrorBox('Let us drag!', "Let us drag! couldn't start. Please try again, or reinstall the app if this keeps happening.")
      app.exit(1)
    })
}
