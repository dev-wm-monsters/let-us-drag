// Windows / macOS specific behaviour of pure main-process helpers (phase 3 platform review).

import { describe, expect, it } from 'vitest'
import { loginItemSettings } from '../../../src/main/autostart'
import { isSafeSandboxSegment, mapSandboxPath } from '../../../src/main/sandbox-protocol'
import { isBlockedAppRequest } from '../../../src/main/security'
import { renameWithRetry } from '../../../src/main/settings-store'

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

describe('app session filter: no UNC file URLs (Windows NTLM leak)', () => {
  it('blocks file URLs that name a server, in every spelling', () => {
    expect(isBlockedAppRequest('file://server/share/x.png')).toBe(true)
    expect(isBlockedAppRequest('file:\\\\server\\share\\x.png')).toBe(true)
    expect(isBlockedAppRequest('file:////server/share/x.png')).toBe(true)
    expect(isBlockedAppRequest('file:///%5C%5Cserver/share/x.png')).toBe(true)
    expect(isBlockedAppRequest('file:///%2F%2Fserver/share/x.png')).toBe(true)
    expect(isBlockedAppRequest('file://127.0.0.1/c$/x.png')).toBe(true)
  })
  it('allows our local pages (POSIX and Windows drive paths)', () => {
    expect(isBlockedAppRequest('file:///app/out/renderer/feed/index.html')).toBe(false)
    expect(isBlockedAppRequest('file:///C:/Program%20Files/Let%20us%20drag!/resources/app.asar/out/renderer/feed/index.html')).toBe(false)
    expect(isBlockedAppRequest('file://localhost/app/out/renderer/feed/index.html')).toBe(false) // canonicalised to file:///
  })
})

describe('sandbox path segments (Windows device names, NTFS streams)', () => {
  const prefixes = ['/pdfjs/cmaps/', '/pdfjs/standard_fonts/']
  it('accepts the pdf.js data file names', () => {
    for (const name of ['UniJIS-UCS2-H.bcmap', '78-EUC-H.bcmap', 'FoxitSerif.pfb', 'LiberationSans-Bold.ttf', 'LICENSE_FOXIT', 'jbig2.wasm']) {
      expect(isSafeSandboxSegment(name)).toBe(true)
    }
    expect(mapSandboxPath('/pdfjs/standard_fonts/FoxitSerif.pfb', prefixes)).toEqual({ prefix: '/pdfjs/standard_fonts/', rel: 'FoxitSerif.pfb' })
  })
  it('rejects Windows device names, with or without extension, any case', () => {
    for (const name of ['CON', 'con', 'NUL', 'nul.bcmap', 'COM1', 'com1.bcmap', 'LPT9.pfb', 'AUX', 'PRN.x.y']) {
      expect(isSafeSandboxSegment(name)).toBe(false)
      expect(mapSandboxPath(`/pdfjs/cmaps/${name}`, prefixes)).toBeNull()
    }
    expect(isSafeSandboxSegment('CONSOLE.bcmap')).toBe(true)
    expect(isSafeSandboxSegment('COM10')).toBe(true)
  })
  it('rejects alternate data streams, trailing dots/spaces, drive letters and odd characters', () => {
    for (const p of ['/pdfjs/cmaps/a.bcmap:stream', '/pdfjs/cmaps/a.bcmap.', '/pdfjs/cmaps/a.bcmap%20', '/pdfjs/cmaps/C:', '/pdfjs/cmaps/.hidden', '/pdfjs/cmaps/a%3Ab', '/pdfjs/cmaps/a~1']) {
      expect(mapSandboxPath(p, prefixes)).toBeNull()
    }
  })
})

describe('settings rename retry (Windows file locks)', () => {
  it('retries transient lock errors and then succeeds', async () => {
    const fails = ['EPERM', 'EBUSY', 'EACCES']
    const calls: string[] = []
    const slept: number[] = []
    await renameWithRetry('a', 'b', {
      rename: async (from, to) => {
        calls.push(`${from}->${to}`)
        const code = fails.shift()
        if (code) throw errno(code)
      },
      delaysMs: [1, 2, 3, 4],
      sleep: async (ms) => void slept.push(ms)
    })
    expect(calls).toHaveLength(4)
    expect(slept).toEqual([1, 2, 3])
  })
  it('gives up after the last delay and rethrows the error', async () => {
    let n = 0
    const p = renameWithRetry('a', 'b', {
      rename: async () => {
        n++
        throw errno('EPERM')
      },
      delaysMs: [1, 1],
      sleep: async () => undefined
    })
    await expect(p).rejects.toMatchObject({ code: 'EPERM' })
    expect(n).toBe(3)
  })
  it('does not retry other errors', async () => {
    let n = 0
    const p = renameWithRetry('a', 'b', {
      rename: async () => {
        n++
        throw errno('ENOENT')
      },
      sleep: async () => undefined
    })
    await expect(p).rejects.toMatchObject({ code: 'ENOENT' })
    expect(n).toBe(1)
  })
})

describe('login item settings (macOS / Windows)', () => {
  const base = { enabled: true, isPackaged: true, execPath: 'C:\\Users\\u\\AppData\\Local\\Programs\\let-us-drag\\Let us drag!.exe', appPath: 'C:\\x' }
  it('macOS: Electron defaults (the app bundle)', () => {
    expect(loginItemSettings({ ...base, platform: 'darwin' })).toEqual({ openAtLogin: true })
    expect(loginItemSettings({ ...base, platform: 'darwin', isPackaged: false, portableExecutable: '/x' })).toEqual({ openAtLogin: true })
  })
  it('Windows installed build: Electron defaults (process.execPath)', () => {
    expect(loginItemSettings({ ...base, platform: 'win32' })).toEqual({ openAtLogin: true })
    expect(loginItemSettings({ ...base, platform: 'win32', enabled: false })).toEqual({ openAtLogin: false })
  })
  it('Windows portable build: the portable exe, not the unpacked temp copy', () => {
    expect(loginItemSettings({ ...base, platform: 'win32', portableExecutable: 'D:\\Tools\\LetUsDrag.exe' })).toEqual({
      openAtLogin: true,
      path: 'D:\\Tools\\LetUsDrag.exe'
    })
    expect(loginItemSettings({ ...base, platform: 'win32', portableExecutable: 'relative.exe' })).toEqual({ openAtLogin: true })
  })
  it('Windows development run: electron.exe plus the project directory', () => {
    expect(loginItemSettings({ ...base, platform: 'win32', isPackaged: false, execPath: 'C:\\repo\\electron.exe', appPath: 'C:\\repo' })).toEqual({
      openAtLogin: true,
      path: 'C:\\repo\\electron.exe',
      args: ['C:\\repo']
    })
  })
})
