// Main process entry: single-instance lock, E2E setup, then app wiring (app.ts).

import { app, dialog } from 'electron'
import { isAbsolute } from 'node:path'
import { startApp, type RunningApp } from './app'
import { createLogger } from './logger'
import { isE2E } from './test-hooks'

const e2e = isE2E()
const log = createLogger(!app.isPackaged || process.env['LUD_DEBUG'] === '1')

// E2E isolation: tests may point userData at a temp dir (only honoured when LUD_E2E=1).
const e2eUserData = process.env['LUD_E2E_USER_DATA']
if (e2e && e2eUserData && isAbsolute(e2eUserData)) app.setPath('userData', e2eUserData)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let running: RunningApp | null = null
  app.on('second-instance', () => {
    // Launching the app again shows the settings window (the app lives in the tray).
    void running?.openSettingsWindow()
  })
  app
    .whenReady()
    .then(async () => {
      running = await startApp({ e2e, log })
    })
    .catch((err: unknown) => {
      log(`startup failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
      dialog.showErrorBox('Let us drag!', "Let us drag! couldn't start. Please try again, or reinstall the app if this keeps happening.")
      app.exit(1)
    })
}
