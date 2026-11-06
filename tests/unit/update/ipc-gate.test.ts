// D29: a forced update blocks startJob in main (before the licence gate); update channels are allow-listed;
// the tray shows the update item first.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../../src/shared/api'
import type { LicenceView } from '../../../src/shared/licence'
import type { UpdateView } from '../../../src/shared/update'
import { isAllowedChannel } from '../../../src/main/ipc-policy'
import type { IpcDeps } from '../../../src/main/ipc'
import type { RendererPage, RuntimeLayout } from '../../../src/main/paths'

type H = (event: unknown, ...args: unknown[]) => Promise<unknown>
const handlers = new Map<string, H>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: H) => handlers.set(ch, fn),
    removeHandler: (ch: string) => handlers.delete(ch)
  },
  ['shell']: { showItemInFolder: () => undefined, openExternal: async () => undefined },
  Menu: { buildFromTemplate: (t: unknown) => t },
  nativeImage: {},
  Tray: class {}
}))

const layout: RuntimeLayout = { mainDir: '/app/out/main', isPackaged: false, resourcesPath: '/res', appPath: '/repo' }
const pageUrl = (page: string): string => pathToFileURL(resolve(`/app/out/renderer/${page}/index.html`)).href
const event = (page: RendererPage) => {
  const frame = { url: pageUrl(page) }
  return { sender: { id: page === 'overlay' ? 1 : page === 'feed' ? 2 : 3, mainFrame: frame }, senderFrame: frame }
}
const pages: Record<number, RendererPage> = { 1: 'overlay', 2: 'feed', 3: 'settings' }
const dir = mkdtempSync(join(tmpdir(), 'lud-update-gate-'))
const input = join(dir, 'a.png')
writeFileSync(input, 'x')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const licence: LicenceView = { status: 'active', maskedKey: null, activatedAt: null, lastCheckedAt: null, environment: 'test', testMode: true, teamBuild: false }
const uview = (status: UpdateView['status']): UpdateView => ({
  status,
  currentVersion: '0.1.0',
  latestVersion: '0.2.0',
  releasedAt: null,
  notes: [],
  dismissed: false,
  hint: false,
  lastCheckedAt: null
})

async function setup(blocked: boolean, unlocked = true) {
  handlers.clear()
  const { registerIpc } = await import('../../../src/main/ipc')
  const started: string[] = []
  const calls: string[] = []
  const deps: IpcDeps = {
    layout,
    pageOfWebContents: (id) => pages[id] ?? null,
    getSettings: () => ({}) as never,
    updateSettings: async () => ({}) as never,
    startJob: (req) => void started.push(req.id),
    cancelJob: () => undefined,
    registry: { isRevealable: () => false } as never,
    platformStatus: () => ({ platform: 'linux', gestureAvailable: true }),
    requestAccessibility: () => false,
    overlay: { setInteractive: () => undefined, setClickThrough: () => undefined, done: () => undefined, engaged: () => undefined },
    openFeedWindow: async () => undefined,
    openSettingsWindow: async () => undefined,
    licence: {
      isUnlocked: () => unlocked,
      view: () => licence,
      activate: async () => ({ ok: true, message: 'x', view: licence }),
      deactivate: async () => ({ ok: true, message: 'x', view: licence }),
      openLink: async () => undefined,
      openActivation: async () => undefined
    },
    update: {
      isBlocked: () => blocked,
      view: () => uview(blocked ? 'required' : 'available'),
      check: async () => {
        calls.push('check')
        return { ok: true, view: uview('available') }
      },
      dismiss: async () => {
        calls.push('dismiss')
        return { ...uview('available'), dismissed: true }
      },
      openDownload: async () => void calls.push('download'),
      hintSeen: async () => void calls.push('hint')
    }
  }
  registerIpc(deps)
  return { started, calls }
}

describe('forced update gate in main (D29)', () => {
  it('startJob refuses with UPDATE_REQUIRED and starts nothing (no conversion, no Remove BG download)', async () => {
    const { started } = await setup(true)
    for (const optionId of ['to-jpg', 'remove-bg']) {
      const r = await handlers.get(IPC.startJob)!(event('overlay'), { id: `j-${optionId}`, optionId, inputPaths: [input] })
      expect(r).toEqual({ started: false, reason: 'UPDATE_REQUIRED' })
    }
    expect(started).toEqual([])
  })

  it('is checked before the licence', async () => {
    await setup(true, false)
    expect(await handlers.get(IPC.startJob)!(event('feed'), { id: 'j1', optionId: 'to-jpg', inputPaths: [input] })).toEqual({
      started: false,
      reason: 'UPDATE_REQUIRED'
    })
    await setup(false, false)
    expect(await handlers.get(IPC.startJob)!(event('feed'), { id: 'j2', optionId: 'to-jpg', inputPaths: [input] })).toEqual({
      started: false,
      reason: 'LICENCE_REQUIRED'
    })
  })

  it('a soft update never blocks', async () => {
    const { started } = await setup(false)
    expect(await handlers.get(IPC.startJob)!(event('overlay'), { id: 'j3', optionId: 'to-jpg', inputPaths: [input] })).toEqual({ started: true })
    expect(started).toEqual(['j3'])
  })
})

describe('update IPC (D29)', () => {
  it('allow-lists pages: Settings checks and says Later; every page reads and downloads; the Uncle pages report the hint', async () => {
    const { calls } = await setup(false)
    expect(isAllowedChannel(IPC.getUpdate, 'overlay')).toBe(true)
    expect(isAllowedChannel(IPC.openUpdateDownload, 'feed')).toBe(true)
    expect(isAllowedChannel(IPC.updateHintSeen, 'settings')).toBe(false)
    expect(isAllowedChannel(IPC.updateChanged, 'settings')).toBe(false)
    await expect(handlers.get(IPC.checkForUpdates)!(event('overlay'))).rejects.toThrow('Request rejected.')
    await expect(handlers.get(IPC.dismissUpdate)!(event('feed'))).rejects.toThrow('Request rejected.')
    await expect(handlers.get(IPC.updateHintSeen)!(event('settings'))).rejects.toThrow('Request rejected.')
    await handlers.get(IPC.checkForUpdates)!(event('settings'))
    await handlers.get(IPC.dismissUpdate)!(event('settings'))
    await handlers.get(IPC.openUpdateDownload)!(event('overlay'))
    await handlers.get(IPC.updateHintSeen)!(event('feed'))
    expect(calls).toEqual(['check', 'dismiss', 'download', 'hint'])
    // No arguments: a URL from the renderer is a malformed request.
    await expect(handlers.get(IPC.openUpdateDownload)!(event('overlay'), 'https://evil.example', 'x')).rejects.toThrow('Invalid request.')
    expect(await handlers.get(IPC.getUpdate)!(event('feed'))).toMatchObject({ status: 'available' })
  })

  it('tray: the update item comes first and opens Settings', async () => {
    const { trayMenuTemplate } = await import('../../../src/main/tray')
    const opened: string[] = []
    const deps = {
      openFeedWindow: () => undefined,
      openSettingsWindow: () => undefined,
      setPaused: () => undefined,
      quit: () => undefined,
      buyLicence: () => undefined,
      openActivation: () => undefined,
      openUpdate: () => void opened.push('update')
    }
    const menu = trayMenuTemplate({ paused: false, gestureUnavailable: null, licensed: true, update: 'Update available (v0.2.0)…' }, deps)
    expect(menu[0]!.label).toBe('Update available (v0.2.0)…')
    ;(menu[0]!.click as () => void)()
    expect(opened).toEqual(['update'])
    expect(trayMenuTemplate({ paused: false, gestureUnavailable: null, licensed: true, update: null }, deps)[0]!.label).toBe('Open Feed Window')
  })
})
