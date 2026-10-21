import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildDesktopEntry, launchCommand, linuxAutostartPath, quoteExecArg, setLinuxAutostart } from '../../../src/main/autostart'
import { decideGestureEnv, isWaylandSession, normalizePlatform } from '../../../src/main/platform/gesture-env'
import { describePaths, validateJobRequest } from '../../../src/main/ipc-validation'
import { JobRegistry } from '../../../src/main/job-registry'
import {
  engineWorkerPath,
  isTrustedRendererUrl,
  preloadPath,
  rendererTarget,
  resourcesDir,
  safeDevServerUrl,
  trayIconCandidates,
  type RuntimeLayout
} from '../../../src/main/paths'
import { injectCsp, PDF_CSP } from '../../../src/main/pdf-csp'
import { SerialQueue, TimeoutError, withTimeout } from '../../../src/main/serial-queue'
import { overlayBounds, rectCenter, toWindowPoint } from '../../../src/main/windows/overlay-geometry'

describe('overlay geometry', () => {
  const wa = { x: 0, y: 25, width: 1440, height: 875 }
  it('centres on the cursor', () => {
    expect(overlayBounds({ x: 700, y: 400 }, wa)).toEqual({ x: 420, y: 120, width: 560, height: 560 })
  })
  it('clamps to the work area edges', () => {
    expect(overlayBounds({ x: 5, y: 30 }, wa)).toEqual({ x: 0, y: 25, width: 560, height: 560 })
    expect(overlayBounds({ x: 1439, y: 899 }, wa)).toEqual({ x: 880, y: 340, width: 560, height: 560 })
  })
  it('works on displays with negative origins', () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1040 }
    expect(overlayBounds({ x: -10, y: 500 }, left)).toEqual({ x: -560, y: 220, width: 560, height: 560 })
  })
  it('shrinks when the work area is smaller than the overlay', () => {
    expect(overlayBounds({ x: 100, y: 100 }, { x: 0, y: 0, width: 400, height: 300 })).toEqual({ x: 0, y: 0, width: 400, height: 300 })
  })
  it('converts screen to window coordinates', () => {
    expect(toWindowPoint({ x: 700, y: 400 }, { x: 420, y: 120, width: 560, height: 560 })).toEqual({ x: 280, y: 280 })
    expect(rectCenter({ x: 0, y: 0, width: 1024, height: 768 })).toEqual({ x: 512, y: 384 })
  })
})

describe('gesture environment', () => {
  it('detects Wayland', () => {
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'wayland' })).toBe(true)
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: 'wayland-0' })).toBe(false)
    expect(isWaylandSession({ WAYLAND_DISPLAY: 'wayland-0' })).toBe(true)
    expect(isWaylandSession({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' })).toBe(false)
    expect(isWaylandSession({ DISPLAY: ':99' })).toBe(false)
  })
  it('decides per platform', () => {
    expect(decideGestureEnv({ platform: 'darwin', env: {}, accessibilityTrusted: false })).toEqual({ canStart: false, reason: 'mac-permission' })
    expect(decideGestureEnv({ platform: 'darwin', env: {} })).toEqual({ canStart: false, reason: 'mac-permission' })
    expect(decideGestureEnv({ platform: 'darwin', env: {}, accessibilityTrusted: true })).toEqual({ canStart: true })
    expect(decideGestureEnv({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' } })).toEqual({ canStart: false, reason: 'wayland' })
    expect(decideGestureEnv({ platform: 'linux', env: { DISPLAY: ':0' } })).toEqual({ canStart: true })
    expect(decideGestureEnv({ platform: 'win32', env: { XDG_SESSION_TYPE: 'wayland' } })).toEqual({ canStart: true })
    expect(normalizePlatform('freebsd')).toBe('linux')
  })
})

describe('autostart (Linux)', () => {
  it('quotes Exec arguments per the Desktop Entry spec', () => {
    expect(quoteExecArg('/usr/bin/let-us-drag')).toBe('/usr/bin/let-us-drag')
    expect(quoteExecArg('/home/me/My Apps/Let.AppImage')).toBe('"/home/me/My Apps/Let.AppImage"')
    expect(quoteExecArg('/tmp/a"b$c`d\\e')).toBe('"/tmp/a\\"b\\$c\\`d\\\\e"')
    expect(quoteExecArg('/tmp/100%')).toBe('/tmp/100%%')
  })
  it('builds a desktop entry and rejects newlines', () => {
    const entry = buildDesktopEntry(['/opt/Let us drag!/let-us-drag'])
    expect(entry).toContain('[Desktop Entry]')
    expect(entry).toContain('Exec="/opt/Let us drag!/let-us-drag"')
    expect(() => buildDesktopEntry(['/x\nExec=evil'])).toThrow()
    expect(() => buildDesktopEntry([])).toThrow()
  })
  it('resolves the autostart path', () => {
    expect(linuxAutostartPath({ XDG_CONFIG_HOME: '/cfg' }, '/home/u')).toBe(join('/cfg', 'autostart', 'let-us-drag.desktop'))
    expect(linuxAutostartPath({ XDG_CONFIG_HOME: 'relative' }, '/home/u')).toBe(join('/home/u', '.config', 'autostart', 'let-us-drag.desktop'))
  })
  it('chooses the launch command', () => {
    expect(launchCommand({ execPath: '/e', appImage: '/a/L.AppImage', isPackaged: true, appPath: '/app' })).toEqual(['/a/L.AppImage'])
    expect(launchCommand({ execPath: '/e', isPackaged: true, appPath: '/app' })).toEqual(['/e'])
    expect(launchCommand({ execPath: '/e', isPackaged: false, appPath: '/app' })).toEqual(['/e', '/app'])
  })
  it('writes and removes the entry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lud-autostart-'))
    const file = join(dir, 'autostart', 'let-us-drag.desktop')
    await setLinuxAutostart(true, file, ['/usr/bin/let-us-drag'])
    expect(await readFile(file, 'utf8')).toContain('Exec=/usr/bin/let-us-drag')
    await setLinuxAutostart(false, file, ['/usr/bin/let-us-drag'])
    await expect(stat(file)).rejects.toThrow()
    await setLinuxAutostart(false, file, []) // removing twice is fine
    await rm(dir, { recursive: true, force: true })
  })
})

describe('paths', () => {
  const layout: RuntimeLayout = { mainDir: '/app/out/main', isPackaged: false, resourcesPath: '/res', appPath: '/repo' }
  it('resolves renderer targets', () => {
    expect(rendererTarget('overlay', layout)).toEqual({ kind: 'file', path: resolve('/app/out/renderer/overlay/index.html') })
    expect(rendererTarget('feed', { ...layout, devServerUrl: 'http://localhost:5173/' })).toEqual({ kind: 'url', url: 'http://localhost:5173/feed/index.html' })
    // a non-loopback dev server URL is ignored
    expect(rendererTarget('feed', { ...layout, devServerUrl: 'https://evil.example' }).kind).toBe('file')
    expect(safeDevServerUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeDevServerUrl('not a url')).toBeUndefined()
  })
  it('resolves preload, worker and resources', () => {
    expect(preloadPath(layout)).toBe(resolve('/app/out/preload/index.cjs'))
    expect(engineWorkerPath(layout)).toBe(join('/app/out/main', 'engine-worker.js'))
    expect(resourcesDir(layout)).toBe(join('/repo', 'resources'))
    expect(resourcesDir({ ...layout, isPackaged: true })).toBe('/res')
  })
  it('lists tray icon candidates with the app icon as fallback', () => {
    expect(trayIconCandidates('darwin', '/r').map((c) => [c.path, c.template, c.resize])).toEqual([
      [join('/r', 'tray', 'trayTemplate.png'), true, false],
      [join('/r', 'icon.png'), false, true]
    ])
    expect(trayIconCandidates('win32', '/r')[0]!.path).toBe(join('/r', 'tray', 'tray.png'))
  })
  it('trusts only our renderer pages', () => {
    const ok = pathToFileURL(resolve('/app/out/renderer/overlay/index.html')).href
    expect(isTrustedRendererUrl(ok, layout)).toBe(true)
    expect(isTrustedRendererUrl(pathToFileURL(resolve('/app/out/main/index.js')).href, layout)).toBe(false)
    expect(isTrustedRendererUrl(pathToFileURL(resolve('/app/out/renderer-evil/x.html')).href, layout)).toBe(false)
    expect(isTrustedRendererUrl('file:///app/out/renderer/../main/x.html', layout)).toBe(false)
    expect(isTrustedRendererUrl('https://example.com/overlay/index.html', layout)).toBe(false)
    expect(isTrustedRendererUrl('about:blank', layout)).toBe(false)
    expect(isTrustedRendererUrl('garbage', layout)).toBe(false)
    const dev = { ...layout, devServerUrl: 'http://localhost:5173' }
    expect(isTrustedRendererUrl('http://localhost:5173/overlay/index.html', dev)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5174/overlay/index.html', dev)).toBe(false)
    expect(isTrustedRendererUrl(ok, dev)).toBe(false)
  })
})

describe('pdf CSP injection', () => {
  it('inserts after a doctype', () => {
    const out = injectCsp('<!DOCTYPE html><html><body>x</body></html>')
    expect(out.startsWith('<!DOCTYPE html><meta http-equiv="Content-Security-Policy"')).toBe(true)
  })
  it('prepends otherwise', () => {
    expect(injectCsp('<p>x</p>')).toBe(`<meta http-equiv="Content-Security-Policy" content="${PDF_CSP}"><p>x</p>`)
  })
  it('blocks scripts and network by default', () => {
    expect(PDF_CSP).toContain("default-src 'none'")
    expect(PDF_CSP).not.toContain('http')
  })
})

describe('serial queue / timeout', () => {
  it('runs tasks one at a time and survives failures', async () => {
    const q = new SerialQueue()
    const log: string[] = []
    let running = 0
    const task = (name: string, fail = false) => async () => {
      running++
      expect(running).toBe(1)
      await new Promise((r) => setTimeout(r, 5))
      log.push(name)
      running--
      if (fail) throw new Error(name)
      return name
    }
    const results = await Promise.allSettled([q.push(task('a')), q.push(task('b', true)), q.push(task('c'))])
    expect(log).toEqual(['a', 'b', 'c'])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
    expect(q.pending).toBe(0)
  })
  it('times out', async () => {
    let fired = false
    await expect(withTimeout(new Promise(() => undefined), 10, 'slow', () => (fired = true))).rejects.toBeInstanceOf(TimeoutError)
    expect(fired).toBe(true)
    await expect(withTimeout(Promise.resolve(1), 1000, 'slow')).resolves.toBe(1)
  })
})

describe('ipc validation', () => {
  let dir: string
  let file: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lud-ipc-'))
    file = join(dir, 'Photo.JPG')
    await writeFile(file, 'abc')
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('describes files and folders', async () => {
    const items = await describePaths([file, dir])
    expect(items[0]).toEqual({ path: file, name: 'Photo.JPG', ext: 'jpg', isDirectory: false, sizeBytes: 3 })
    expect(items[1]).toMatchObject({ path: dir, ext: '', isDirectory: true, sizeBytes: 0 })
  })
  it('rejects relative, empty, non-array and missing paths', async () => {
    await expect(describePaths(['relative/file.txt'])).rejects.toThrow('Invalid file list.')
    await expect(describePaths([])).rejects.toThrow()
    await expect(describePaths('x')).rejects.toThrow()
    await expect(describePaths(['/x\0y'])).rejects.toThrow()
    await expect(describePaths([join(dir, 'missing.png')])).rejects.toThrow(/Can't find "missing.png"/)
  })
  it('validates job requests', async () => {
    await expect(validateJobRequest({ id: 'job_1', optionId: 'to-png', inputPaths: [file] })).resolves.toMatchObject({ id: 'job_1' })
    await expect(validateJobRequest({ id: '../x', optionId: 'to-png', inputPaths: [file] })).rejects.toThrow('Invalid job request.')
    await expect(validateJobRequest({ id: 'a', optionId: 'to-exe', inputPaths: [file] })).rejects.toThrow()
    await expect(validateJobRequest({ id: 'a', optionId: 'to-png', inputPaths: [file], extra: 1 })).rejects.toThrow()
    await expect(validateJobRequest({ id: 'a', optionId: 'to-png', inputPaths: [join(dir, 'nope')] })).rejects.toThrow(/Can't find/)
  })
})

describe('job registry', () => {
  it('only reveals produced outputs and records events when enabled', () => {
    const r = new JobRegistry(true)
    r.record({ type: 'queued', jobId: 'a' })
    r.record({ type: 'done', jobId: 'a', outputPaths: ['/tmp/out/a.png'] })
    expect(r.isRevealable('/tmp/out/a.png')).toBe(true)
    expect(r.isRevealable('/tmp/out/../out/a.png')).toBe(true)
    expect(r.isRevealable('/etc/passwd')).toBe(false)
    expect(r.recordedEvents().map((e) => e.type)).toEqual(['queued', 'done'])
    const quiet = new JobRegistry(false)
    quiet.record({ type: 'queued', jobId: 'a' })
    expect(quiet.recordedEvents()).toEqual([])
  })
})
