// D26: the paywall is enforced in main (startJob), and the licence channels are validated + allow-listed.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../../src/shared/api'
import type { LicenceActionResult, LicenceView } from '../../../src/shared/licence'
import { isAllowedChannel } from '../../../src/main/ipc-policy'
import type { IpcDeps } from '../../../src/main/ipc'
import type { RendererPage, RuntimeLayout } from '../../../src/main/paths'

type H = (event: unknown, ...args: unknown[]) => Promise<unknown>
const handlers = new Map<string, H>()
const opened: string[] = []
vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: H) => handlers.set(ch, fn),
    removeHandler: (ch: string) => handlers.delete(ch)
  },
  // Electron's `shell` module (string key: the SEC-146 lint rule matches a `shell` property name).
  ['shell']: { showItemInFolder: () => undefined, openExternal: async (u: string) => void opened.push(u) },
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
const dir = mkdtempSync(join(tmpdir(), 'lud-ipc-gate-'))
const input = join(dir, 'a.png')
writeFileSync(input, 'x')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const view: LicenceView = { status: 'unlicensed', maskedKey: null, activatedAt: null, lastCheckedAt: null, environment: 'test', testMode: true, teamBuild: false }

async function setup(unlocked: boolean) {
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
      view: () => view,
      activate: async (key) => {
        calls.push(`activate:${key}`)
        return { ok: false, code: 'NOT_FOUND', message: 'x', view } satisfies LicenceActionResult
      },
      deactivate: async () => ({ ok: false, code: 'NO_LICENCE', message: 'x', view }),
      openLink: async (link) => void calls.push(`link:${link}`),
      openActivation: async () => void calls.push('activation')
    }
  }
  registerIpc(deps)
  return { started, calls }
}

describe('paywall in main (D26)', () => {
  it('startJob refuses without a licence: typed result, no job started', async () => {
    const { started } = await setup(false)
    const r = await handlers.get(IPC.startJob)!(event('overlay'), { id: 'j1', optionId: 'remove-bg', inputPaths: [input] })
    expect(r).toEqual({ started: false, reason: 'LICENCE_REQUIRED' })
    expect(started).toEqual([])
  })

  it('startJob runs with a licence', async () => {
    const { started } = await setup(true)
    expect(await handlers.get(IPC.startJob)!(event('feed'), { id: 'j2', optionId: 'to-jpg', inputPaths: [input] })).toEqual({ started: true })
    expect(started).toEqual(['j2'])
  })

  it('invalid requests are still rejected before the licence check', async () => {
    await setup(false)
    await expect(handlers.get(IPC.startJob)!(event('overlay'), { id: '../x', optionId: 'to-png', inputPaths: [input] })).rejects.toThrow('Invalid job request.')
  })
})

describe('licence IPC (D26)', () => {
  it('validates payloads with zod', async () => {
    const { calls } = await setup(false)
    await handlers.get(IPC.activateLicence)!(event('settings'), ' KEY ')
    expect(calls).toEqual(['activate: KEY '])
    await expect(handlers.get(IPC.activateLicence)!(event('settings'), 42)).rejects.toThrow('Invalid licence key.')
    await expect(handlers.get(IPC.activateLicence)!(event('settings'), 'x'.repeat(5000))).rejects.toThrow('Invalid licence key.')
    await handlers.get(IPC.openLicenceLink)!(event('overlay'), 'checkout')
    await expect(handlers.get(IPC.openLicenceLink)!(event('overlay'), 'https://evil.example')).rejects.toThrow('Invalid link.')
    expect(calls).toContain('link:checkout')
  })

  it('allow-lists pages: only Settings activates / deactivates', async () => {
    await setup(false)
    await expect(handlers.get(IPC.activateLicence)!(event('overlay'), 'KEY')).rejects.toThrow('Request rejected.')
    await expect(handlers.get(IPC.deactivateLicence)!(event('feed'))).rejects.toThrow('Request rejected.')
    expect(isAllowedChannel(IPC.getLicence, 'overlay')).toBe(true)
    expect(isAllowedChannel(IPC.openActivation, 'feed')).toBe(true)
    expect(isAllowedChannel(IPC.openActivation, 'settings')).toBe(false)
    expect(isAllowedChannel(IPC.licenceChanged, 'settings')).toBe(false)
  })

  it('the renderer only gets the view (no key, no instance id)', async () => {
    await setup(false)
    expect(await handlers.get(IPC.getLicence)!(event('feed'))).toEqual(view)
  })
})

describe('tray menu (D26)', () => {
  it('offers Buy a licence… / Activate… only when unlicensed; the dev reset only when given', async () => {
    const { trayMenuTemplate } = await import('../../../src/main/tray')
    const deps = {
      openFeedWindow: () => undefined,
      openSettingsWindow: () => undefined,
      setPaused: () => undefined,
      quit: () => undefined,
      buyLicence: () => undefined,
      openActivation: () => undefined
    }
    const labels = (licensed: boolean, d: typeof deps & { resetLicence?: () => void } = deps) =>
      trayMenuTemplate({ paused: false, gestureUnavailable: null, licensed }, d).map((i) => i.label ?? `(${i.type})`)
    expect(labels(false).slice(0, 2)).toEqual(['Buy a licence…', 'Activate…'])
    expect(labels(true)).not.toContain('Buy a licence…')
    expect(labels(true)).not.toContain('Activate…')
    expect(labels(true).join(' ')).not.toContain('Reset licence')
    expect(labels(true, { ...deps, resetLicence: () => undefined })).toContain('Reset licence (development)')
    for (const l of labels(false)) expect(l).not.toContain('—')
  })
})
