// Phase 2 (Platform): pure security helpers, IPC policy, PDF adapter planning, E2E gating.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { IPC } from '../../../src/shared/api'
import { isE2E } from '../../../src/main/e2e-mode'
import { IPC_ALLOWLIST, isAllowedChannel, isTrustedSender } from '../../../src/main/ipc-policy'
import { absolutePathSchema, isDeviceNamespacePath, jobRequestSchema } from '../../../src/main/ipc-validation'
import { devServerOrigin, rendererPageOf, rendererTarget, type RuntimeLayout } from '../../../src/main/paths'
import { isAllowedPrintRequest } from '../../../src/main/pdf-csp'
import {
  clampRenderOptions,
  describeError,
  isPngBytes,
  PDF_ABS_MAX_SIDE,
  PDF_RENDER_CSP,
  PDF_RENDER_SCRIPT,
  planPage
} from '../../../src/main/pdf-render-plan'
import { contentTypeFor, isSandboxUrl, mapSandboxPath } from '../../../src/main/sandbox-protocol'
import { isBlockedAppRequest, secureWebPreferences } from '../../../src/main/security'
import { settingsPatchSchema } from '../../../src/main/settings-store'
import { createTestHooks, type TestHookDeps } from '../../../src/main/test-hooks'

const layout: RuntimeLayout = { mainDir: '/app/out/main', isPackaged: false, resourcesPath: '/res', appPath: '/repo' }
const pageUrl = (page: string): string => pathToFileURL(resolve(`/app/out/renderer/${page}/index.html`)).href

describe('E2E gating (TPM D12, SEC-18)', () => {
  it('needs LUD_E2E=1 and an unpackaged app', () => {
    expect(isE2E({ LUD_E2E: '1' }, false)).toBe(true)
    expect(isE2E({ LUD_E2E: '1' }, true)).toBe(false)
    expect(isE2E({ LUD_E2E: 'true' }, false)).toBe(false)
    expect(isE2E({}, false)).toBe(false)
  })
})

describe('dev server URL (F-09, SEC-07)', () => {
  it('is ignored when packaged', () => {
    const dev = { ...layout, devServerUrl: 'http://localhost:5173' }
    expect(devServerOrigin(dev)).toBe('http://localhost:5173')
    expect(devServerOrigin({ ...dev, isPackaged: true })).toBeUndefined()
    expect(rendererTarget('feed', { ...dev, isPackaged: true }).kind).toBe('file')
    expect(rendererPageOf('http://localhost:5173/feed/index.html', { ...dev, isPackaged: true })).toBeNull()
  })
})

describe('rendererPageOf', () => {
  it('identifies our pages and nothing else', () => {
    expect(rendererPageOf(pageUrl('overlay'), layout)).toBe('overlay')
    expect(rendererPageOf(pageUrl('feed') + '#x', layout)).toBe('feed')
    expect(rendererPageOf(pageUrl('settings'), layout)).toBe('settings')
    expect(rendererPageOf(pathToFileURL(resolve('/app/out/renderer/assets/x.js')).href, layout)).toBeNull()
    expect(rendererPageOf(pathToFileURL(resolve('/app/out/renderer/feed/other.html')).href, layout)).toBeNull()
    expect(rendererPageOf('file://host/app/out/renderer/feed/index.html', layout)).toBeNull()
    expect(rendererPageOf('lud-sandbox://pdf/index.html', layout)).toBeNull()
    const dev = { ...layout, devServerUrl: 'http://localhost:5173' }
    expect(rendererPageOf('http://localhost:5173/settings/index.html', dev)).toBe('settings')
    expect(rendererPageOf('http://user:pw@localhost:5173/settings/index.html', dev)).toBeNull()
  })
})

describe('IPC policy (SEC-11, SEC-12)', () => {
  const sender = (registeredPage: 'overlay' | 'feed' | 'settings' | null, frameUrl: string, isMainFrame = true) => ({ registeredPage, frameUrl, isMainFrame })

  it('covers every renderer → main channel', () => {
    const invokeChannels = [
      IPC.describePaths,
      IPC.startJob,
      IPC.cancelJob,
      IPC.revealPath,
      IPC.getSettings,
      IPC.setSettings,
      IPC.getPlatformStatus,
      IPC.requestAccessibility,
      IPC.overlayInteractive,
      IPC.overlayDone,
      IPC.overlayEngaged,
      IPC.openFeedWindow,
      IPC.openSettingsWindow
    ]
    expect(Object.keys(IPC_ALLOWLIST).sort()).toEqual([...invokeChannels].sort())
  })

  it('applies the per-page allowlist', () => {
    expect(isAllowedChannel(IPC.overlayDone, 'overlay')).toBe(true)
    expect(isAllowedChannel(IPC.overlayDone, 'feed')).toBe(false)
    expect(isAllowedChannel(IPC.setSettings, 'overlay')).toBe(false)
    expect(isAllowedChannel(IPC.setSettings, 'settings')).toBe(true)
    expect(isAllowedChannel(IPC.setSettings, 'feed')).toBe(true)
    expect(isAllowedChannel(IPC.requestAccessibility, 'feed')).toBe(false)
    expect(isAllowedChannel(IPC.startJob, 'settings')).toBe(false)
    expect(isAllowedChannel(IPC.startJob, 'feed')).toBe(true)
    expect(isAllowedChannel('lud:unknown', 'settings')).toBe(false)
    // main → renderer channels are never valid invoke channels
    expect(isAllowedChannel(IPC.jobEvent, 'overlay')).toBe(false)
  })

  it('requires our window, its main frame, and the page main loaded into it', () => {
    expect(isTrustedSender(IPC.startJob, sender('feed', pageUrl('feed')), layout)).toBe(true)
    expect(isTrustedSender(IPC.startJob, sender(null, pageUrl('feed')), layout)).toBe(false) // not our window
    expect(isTrustedSender(IPC.startJob, sender('feed', pageUrl('feed'), false), layout)).toBe(false) // sub-frame
    expect(isTrustedSender(IPC.startJob, sender('feed', pageUrl('overlay')), layout)).toBe(false) // navigated to another page
    expect(isTrustedSender(IPC.startJob, sender('feed', 'https://example.com/feed/index.html'), layout)).toBe(false)
    expect(isTrustedSender(IPC.startJob, sender('feed', ''), layout)).toBe(false)
    expect(isTrustedSender(IPC.overlayDone, sender('settings', pageUrl('settings')), layout)).toBe(false)
  })
})

describe('IPC payload validation (SEC-13, SEC-14)', () => {
  it('rejects Windows device namespaces, accepts UNC paths', () => {
    expect(isDeviceNamespacePath('\\\\.\\PhysicalDrive0')).toBe(true)
    expect(isDeviceNamespacePath('\\\\?\\C:\\x')).toBe(true)
    expect(isDeviceNamespacePath('//./pipe/x')).toBe(true)
    expect(isDeviceNamespacePath('\\\\server\\share\\a.png')).toBe(false)
    expect(isDeviceNamespacePath('/home/a.png')).toBe(false)
    expect(absolutePathSchema.safeParse('\\\\.\\PhysicalDrive0').success).toBe(false)
    expect(absolutePathSchema.safeParse('/a/b\0c').success).toBe(false)
    expect(absolutePathSchema.safeParse('relative/x').success).toBe(false)
    expect(absolutePathSchema.safeParse('/a/../b').data).toBe(resolve('/b'))
  })

  it('job requests and settings patches are strict', () => {
    expect(jobRequestSchema.safeParse({ id: 'j1', optionId: 'to-png', inputPaths: ['/a.jpg'] }).success).toBe(true)
    expect(jobRequestSchema.safeParse({ id: 'j1', optionId: 'to-png', inputPaths: ['/a.jpg'], extra: 1 }).success).toBe(false)
    expect(jobRequestSchema.safeParse({ id: 'j1', optionId: 'to-png', inputPaths: Array(501).fill('/a.jpg') }).success).toBe(false)
    expect(jobRequestSchema.safeParse({ id: 'x'.repeat(65), optionId: 'to-png', inputPaths: ['/a.jpg'] }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ sounds: false }).success).toBe(true)
    expect(settingsPatchSchema.safeParse({ sounds: false, evil: true }).success).toBe(false)
  })
})

describe('network blocking (SEC-150)', () => {
  it('cancels remote requests, allows local ones and the dev server', () => {
    expect(isBlockedAppRequest('https://example.com/x')).toBe(true)
    expect(isBlockedAppRequest('http://127.0.0.1:9/x')).toBe(true)
    expect(isBlockedAppRequest('wss://example.com/')).toBe(true)
    expect(isBlockedAppRequest('ftp://example.com/')).toBe(true)
    expect(isBlockedAppRequest('file:///app/out/renderer/feed/index.html')).toBe(false)
    expect(isBlockedAppRequest('devtools://devtools/x')).toBe(false)
    expect(isBlockedAppRequest('not a url')).toBe(true)
    expect(isBlockedAppRequest('http://localhost:5173/feed/index.html', 'http://localhost:5173')).toBe(false)
    expect(isBlockedAppRequest('ws://localhost:5173/', 'http://localhost:5173')).toBe(false)
    expect(isBlockedAppRequest('http://localhost:5174/', 'http://localhost:5173')).toBe(true)
  })
})

describe('secureWebPreferences (SEC-01/02)', () => {
  it('cannot be weakened by callers', () => {
    const p = secureWebPreferences({ nodeIntegration: true, contextIsolation: false, sandbox: false, webSecurity: false, webviewTag: true, preload: '/p.cjs' })
    expect(p).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      experimentalFeatures: false,
      navigateOnDragDrop: false,
      preload: '/p.cjs'
    })
    expect(p).not.toHaveProperty('enableBlinkFeatures')
  })
})

describe('sandbox protocol (helper windows)', () => {
  it('matches only our scheme and host', () => {
    expect(isSandboxUrl('lud-sandbox://pdf/index.html', 'pdf')).toBe(true)
    expect(isSandboxUrl('lud-sandbox://print/x.html', 'pdf')).toBe(false)
    expect(isSandboxUrl('lud-sandbox://u:p@pdf/index.html', 'pdf')).toBe(false)
    expect(isSandboxUrl('https://pdf/index.html', 'pdf')).toBe(false)
    expect(isSandboxUrl('file:///etc/passwd', 'pdf')).toBe(false)
  })
  it('maps request paths below allowed prefixes only', () => {
    const prefixes = ['/pdfjs/cmaps/', '/pdfjs/build/']
    expect(mapSandboxPath('/pdfjs/cmaps/UniJIS-UCS2-H.bcmap', prefixes)).toEqual({ prefix: '/pdfjs/cmaps/', rel: 'UniJIS-UCS2-H.bcmap' })
    expect(mapSandboxPath('/pdfjs/cmaps/../../package.json', prefixes)).toBeNull()
    expect(mapSandboxPath('/pdfjs/cmaps/%2e%2e/x', prefixes)).toBeNull()
    expect(mapSandboxPath('/pdfjs/cmaps/a%5c..%5cb', prefixes)).toBeNull()
    expect(mapSandboxPath('/pdfjs/cmaps/', prefixes)).toBeNull()
    expect(mapSandboxPath('/pdfjs/cmaps//x', prefixes)).toBeNull()
    expect(mapSandboxPath('/pdfjs/cmaps/x%00', prefixes)).toBeNull()
    expect(mapSandboxPath('/pdfjs/cmaps/%E0%A4%A', prefixes)).toBeNull()
    expect(mapSandboxPath('/etc/passwd', prefixes)).toBeNull()
  })
  it('content types', () => {
    expect(contentTypeFor('/a/pdf.mjs')).toMatch(/javascript/)
    expect(contentTypeFor('/a/x.wasm')).toBe('application/wasm')
    expect(contentTypeFor('/a/x.bcmap')).toBe('application/octet-stream')
  })
  it('htmlToPdf session loads only the current document and data: URLs (SEC-82)', () => {
    const doc = 'lud-sandbox://print/123.html'
    expect(isAllowedPrintRequest(doc, doc)).toBe(true)
    expect(isAllowedPrintRequest('data:image/png;base64,AAAA', doc)).toBe(true)
    expect(isAllowedPrintRequest('lud-sandbox://print/other.html', doc)).toBe(false)
    expect(isAllowedPrintRequest(doc, null)).toBe(false)
    expect(isAllowedPrintRequest('file:///etc/hostname', doc)).toBe(false)
    expect(isAllowedPrintRequest('http://127.0.0.1/beacon', doc)).toBe(false)
  })
})

describe('renderPdfPages planning (P1)', () => {
  const opts = { scale: 2, maxSide: 16_384, maxPixels: 50_000_000 }
  it('renders at the requested scale when within limits', () => {
    expect(planPage(300, 200, opts)).toEqual({ scale: 2, width: 600, height: 400 })
    expect(planPage(612, 792, opts)).toEqual({ scale: 2, width: 1224, height: 1584 })
  })
  it('scales huge pages down to maxSide and maxPixels', () => {
    const p = planPage(14_400, 14_400, opts)!
    expect(p.width).toBeLessThanOrEqual(16_384)
    expect(p.width * p.height).toBeLessThanOrEqual(50_000_000)
    expect(p.width).toBeGreaterThan(7_000)
    const tall = planPage(100, 14_400, opts)!
    expect(tall.height).toBeLessThanOrEqual(16_384)
    expect(tall.width).toBeGreaterThanOrEqual(1)
  })
  it('rejects nonsense sizes and clamps hostile options', () => {
    expect(planPage(0, 10, opts)).toBeNull()
    expect(planPage(Number.NaN, 10, opts)).toBeNull()
    expect(planPage(-5, 10, opts)).toBeNull()
    expect(planPage(Infinity, 10, opts)).toBeNull()
    expect(clampRenderOptions({ scale: 1e9, maxSide: 1e9, maxPixels: 1e12 })).toEqual({ scale: 8, maxSide: PDF_ABS_MAX_SIDE, maxPixels: 100_000_000 })
    expect(clampRenderOptions({ scale: Number.NaN, maxSide: -1, maxPixels: 0 })).toEqual({ scale: 2, maxSide: PDF_ABS_MAX_SIDE, maxPixels: 50_000_000 })
  })
  it('accepts only PNG bytes from the page', () => {
    expect(isPngBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(true)
    expect(isPngBytes(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0]))).toBe(false)
    expect(isPngBytes('89504e47')).toBe(false)
    expect(isPngBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])).toBe(false)
  })
  it('page script and CSP keep the PDF from running code or reaching out', () => {
    expect(PDF_RENDER_SCRIPT).toContain('isEvalSupported: false')
    expect(PDF_RENDER_SCRIPT).toContain('enableXfa: false')
    expect(PDF_RENDER_SCRIPT).toContain('useSystemFonts: false')
    expect(PDF_RENDER_CSP).toContain("default-src 'none'")
    expect(PDF_RENDER_CSP).toContain("script-src 'self' 'wasm-unsafe-eval'")
    expect(PDF_RENDER_CSP).not.toContain(" 'unsafe-eval'")
    expect(PDF_RENDER_CSP).not.toMatch(/https?:/)
  })
  it('describes rejections in one short line', () => {
    expect(describeError(new Error('a\nb'))).toBe('a')
    expect(describeError({ name: 'InvalidPDFException', message: 'Invalid PDF structure.' })).toBe('InvalidPDFException: Invalid PDF structure.')
    expect(describeError({})).toBe('unknown error')
    expect(describeError('x'.repeat(500)).length).toBe(160)
  })
})

describe('test hooks (TPM D2/D3)', () => {
  function deps(log: string[]): TestHookDeps {
    return {
      primaryCenter: () => ({ x: 1, y: 2 }),
      overlay: {
        phase: 'hidden',
        arm: () => log.push('arm'),
        disarm: () => log.push('disarm'),
        isVisible: () => false,
        whenLoaded: async () => undefined,
        sendTestDrop: (p) => log.push(`drop:${p.paths.join(',')}:${p.optionId}`)
      },
      jobEvents: () => [],
      openFeedWindow: async () => log.push('openFeed'),
      openSettingsWindow: async () => log.push('openSettings'),
      sendFeedDrop: async (p) => {
        log.push(`feedDrop:${p.paths.join(',')}:${p.optionId}`)
      },
      sendCancel: () => log.push('cancel')
    }
  }
  it('dropFilesOnFeed validates and forwards; cancelActive forwards', async () => {
    const log: string[] = []
    const hooks = createTestHooks(deps(log))
    await hooks.dropFilesOnFeed(['/tmp/a.png'], 'to-jpg')
    await hooks.dropFilesOnFeed(['/tmp/a.png'], null)
    await expect(hooks.dropFilesOnFeed(['relative.png'], 'to-jpg')).rejects.toThrow()
    await expect(hooks.dropFilesOnFeed(['/tmp/a.png'], 'nope' as never)).rejects.toThrow()
    await hooks.cancelActive()
    expect(log).toEqual(['feedDrop:/tmp/a.png:to-jpg', 'feedDrop:/tmp/a.png:null', 'cancel'])
  })
})
