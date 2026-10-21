// Scaffold placeholder. Owned by the Platform backend dev (docs/PLAN.md §7).
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 420,
    height: 420,
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), sandbox: true, contextIsolation: true }
  })
  if (process.env['ELECTRON_RENDERER_URL']) await win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/feed/index.html`)
  else await win.loadFile(join(__dirname, '../renderer/feed/index.html'))
  win.show()
})

app.on('window-all-closed', () => app.quit())
