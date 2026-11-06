// D29: semantic-version comparison (incl. pre-releases), manifest validation and the download allow-list.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_UPDATE_MANIFEST_URL,
  DOWNLOAD_PAGE_URL,
  e2eManifestUrl,
  parseManifestUrl,
  updatePlatformKey,
  buildManifestUrl
} from '../../../src/main/update/config'
import { downloadUrlFor, isAllowedDownloadUrl, MAX_NOTES, MAX_NOTE_CHARS, parseManifest, parseManifestText } from '../../../src/main/update/manifest'
import { compareVersions, formatSemver, isSemver, parseSemver } from '../../../src/main/update/semver'

describe('semver', () => {
  it('parses releases, pre-releases, a leading v and build metadata', () => {
    expect(parseSemver('0.1.0')).toEqual({ major: 0, minor: 1, patch: 0, pre: [] })
    expect(parseSemver('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: [] })
    expect(parseSemver('0.1.0-beta.8')).toEqual({ major: 0, minor: 1, patch: 0, pre: ['beta', 8] })
    expect(parseSemver('1.0.0-rc.1+build.5')).toEqual({ major: 1, minor: 0, patch: 0, pre: ['rc', 1] })
    expect(formatSemver(parseSemver('v2.0.0+abc')!)).toBe('2.0.0')
  })

  it('rejects anything else', () => {
    for (const bad of ['', '1', '1.2', '1.2.3.4', '01.2.3', '1.02.3', '1.2.3-', '1.2.3-beta..1', '1.2.3-01', 'latest', ' ', 'x1.2.3', 1, null, undefined, {}, '9'.repeat(80)]) {
      expect(isSemver(bad), String(bad)).toBe(false)
    }
    expect(parseSemver('99999999999999999999.0.0')).toBeNull() // not a safe integer
  })

  it('orders versions by semver precedence', () => {
    const ordered = [
      '0.0.9',
      '0.1.0-alpha',
      '0.1.0-alpha.1',
      '0.1.0-alpha.beta',
      '0.1.0-beta',
      '0.1.0-beta.2',
      '0.1.0-beta.8',
      '0.1.0-beta.11',
      '0.1.0-rc.1',
      '0.1.0',
      '0.1.1',
      '0.2.0',
      '0.10.0',
      '1.0.0'
    ]
    for (let i = 0; i < ordered.length; i++) {
      for (let j = 0; j < ordered.length; j++) {
        const want = i < j ? -1 : i > j ? 1 : 0
        expect(compareVersions(ordered[i], ordered[j]), `${ordered[i]} vs ${ordered[j]}`).toBe(want)
      }
    }
  })

  it('ignores build metadata and the v prefix when comparing; null for invalid input', () => {
    expect(compareVersions('1.0.0+a', 'v1.0.0+b')).toBe(0)
    expect(compareVersions('1.0.0', 'nope')).toBeNull()
  })
})

const GOOD = {
  latest: '0.2.0',
  minimum: '0.1.0',
  releasedAt: '2026-11-10',
  notes: ['New: HEIC to JPG.', 'Fixed: long names.'],
  downloads: {
    'mac-arm64': 'https://letsdrag.wakeupmonster.com/downloads/LetsDrag-0.2.0-mac-arm64.dmg',
    'mac-x64': 'https://letsdrag.wakeupmonster.com/downloads/LetsDrag-0.2.0-mac-x64.dmg',
    'win-x64': 'https://letsdrag.wakeupmonster.com/downloads/LetsDrag-0.2.0-win-x64.exe',
    'linux-x64': 'https://letsdrag.wakeupmonster.com/downloads/LetsDrag-0.2.0-linux-x86_64.AppImage',
    page: 'https://letsdrag.wakeupmonster.com/#download'
  }
}

describe('manifest validation', () => {
  it('accepts the documented format and ignores unknown fields', () => {
    const m = parseManifest({ ...GOOD, channel: 'stable', extra: { a: 1 } })
    expect(m).toEqual({
      latest: '0.2.0',
      minimum: '0.1.0',
      releasedAt: '2026-11-10',
      notes: GOOD.notes,
      downloads: GOOD.downloads
    })
    expect(m).not.toHaveProperty('channel')
  })

  it('only needs `latest`', () => {
    expect(parseManifest({ latest: 'v0.3.0' })).toEqual({ latest: '0.3.0', minimum: null, releasedAt: null, notes: [], downloads: {} })
    expect(parseManifest({ latest: '0.3.0', minimum: null })?.minimum).toBeNull()
  })

  it('rejects a wrong shape, bad versions and minimum above latest', () => {
    for (const bad of [null, [], 'x', 1, {}, { latest: 2 }, { latest: 'two' }, { latest: '0.2.0', minimum: 'x' }, { latest: '0.2.0', minimum: '0.3.0' }]) {
      expect(parseManifest(bad), JSON.stringify(bad)).toBeNull()
    }
    expect(parseManifest({ latest: '0.2.0', minimum: '0.2.0' })?.minimum).toBe('0.2.0')
    expect(parseManifest({ latest: '0.2.0', minimum: '0.2.0-beta.1' })?.minimum).toBe('0.2.0-beta.1')
  })

  it('cleans notes and dates instead of rejecting the manifest', () => {
    const long = 'x'.repeat(500)
    const m = parseManifest({
      latest: '0.2.0',
      releasedAt: '10/11/2026',
      notes: ['  Fixed:\n\tthing  ', 3, '', null, long, ...Array.from({ length: 20 }, (_, i) => `note ${i}`)]
    })!
    expect(m.releasedAt).toBeNull()
    expect(m.notes[0]).toBe('Fixed: thing')
    expect(m.notes[1]!.length).toBe(MAX_NOTE_CHARS)
    expect(m.notes[1]!.endsWith('…')).toBe(true)
    expect(m.notes).toHaveLength(MAX_NOTES)
    expect(parseManifest({ latest: '0.2.0', releasedAt: '2026-13-40' })!.releasedAt).toBeNull()
    expect(parseManifest({ latest: '0.2.0', notes: 'not a list' })!.notes).toEqual([])
  })

  it('strips every bidi control, including the isolates (U+2066–2069) and the BOM (review)', () => {
    const m = parseManifest({ latest: '0.2.0', notes: ['Fixed ⁧gnirts⁩ and ⁦x⁨y﻿ end'] })!
    expect(m.notes[0]).toBe('Fixed gnirts and x y end')
  })

  it('parses JSON text (with a BOM) and refuses bad JSON or an oversized body', () => {
    expect(parseManifestText('﻿' + JSON.stringify(GOOD))?.latest).toBe('0.2.0')
    expect(parseManifestText('{ nope')).toBeNull()
    expect(parseManifestText('<html>captive portal</html>')).toBeNull()
    expect(parseManifestText(JSON.stringify({ ...GOOD, pad: 'x'.repeat(70_000) }))).toBeNull()
  })
})

describe('download allow-list', () => {
  it('accepts only https links on the website host', () => {
    expect(isAllowedDownloadUrl('https://letsdrag.wakeupmonster.com/downloads/a.dmg')).toBe(true)
    for (const bad of [
      'http://letsdrag.wakeupmonster.com/downloads/a.dmg',
      'https://evil.example/a.dmg',
      'https://letsdrag.wakeupmonster.com.evil.example/a.dmg',
      'https://evil.letsdrag.wakeupmonster.com/a.dmg',
      'https://wakeupmonster.com/a.dmg',
      'https://letsdrag.wakeupmonster.com:8443/a.dmg',
      'https://user:pw@letsdrag.wakeupmonster.com/a.dmg',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'ftp://letsdrag.wakeupmonster.com/a',
      'not a url',
      42
    ]) {
      expect(isAllowedDownloadUrl(bad), String(bad)).toBe(false)
    }
  })

  it('drops disallowed links at parse time and falls back to the page, then to our download page', () => {
    const m = parseManifest({
      latest: '0.2.0',
      downloads: { 'mac-arm64': 'https://evil.example/x.dmg', 'win-x64': 'http://letsdrag.wakeupmonster.com/x.exe', page: 'https://letsdrag.wakeupmonster.com/#download', foo: 'https://letsdrag.wakeupmonster.com/foo' }
    })!
    expect(m.downloads).toEqual({ page: 'https://letsdrag.wakeupmonster.com/#download' })
    expect(downloadUrlFor(m, 'mac-arm64')).toBe('https://letsdrag.wakeupmonster.com/#download')
    expect(downloadUrlFor(parseManifest({ latest: '0.2.0' }), 'win-x64')).toBe(DOWNLOAD_PAGE_URL)
    expect(downloadUrlFor(null, 'linux-x64')).toBe(DOWNLOAD_PAGE_URL)
  })

  it('picks the installer for this OS and CPU', () => {
    const m = parseManifest(GOOD)!
    expect(downloadUrlFor(m, updatePlatformKey('darwin', 'arm64'))).toBe(GOOD.downloads['mac-arm64'])
    expect(downloadUrlFor(m, updatePlatformKey('darwin', 'x64'))).toBe(GOOD.downloads['mac-x64'])
    expect(downloadUrlFor(m, updatePlatformKey('win32', 'x64'))).toBe(GOOD.downloads['win-x64'])
    expect(downloadUrlFor(m, updatePlatformKey('linux', 'x64'))).toBe(GOOD.downloads['linux-x64'])
    // No installer listed for this computer → the download page.
    expect(downloadUrlFor(m, updatePlatformKey('linux', 'arm64'))).toBe(GOOD.downloads.page)
    expect(updatePlatformKey('freebsd', 'x64')).toBeNull()
    expect(updatePlatformKey('linux', 'ia32')).toBeNull()
    // A tampered cached manifest is re-checked at use time.
    expect(downloadUrlFor({ ...m, downloads: { 'linux-x64': 'https://evil.example/x' } }, 'linux-x64')).toBe(DOWNLOAD_PAGE_URL)
  })
})

describe('manifest URL settings', () => {
  it('defaults to the website and accepts only plain https URLs', () => {
    expect(buildManifestUrl()).toBe(DEFAULT_UPDATE_MANIFEST_URL)
    expect(DEFAULT_UPDATE_MANIFEST_URL).toBe('https://letsdrag.wakeupmonster.com/update.json')
    expect(parseManifestUrl('https://staging.example.com/u.json')).toBe('https://staging.example.com/u.json')
    for (const bad of ['', 'http://letsdrag.wakeupmonster.com/update.json', 'https://a.b/u.json?id=1', 'https://u:p@a.b/u.json', 'nope', undefined]) {
      expect(parseManifestUrl(bad), String(bad)).toBeNull()
    }
  })

  it('E2E override: loopback only', () => {
    expect(e2eManifestUrl('http://127.0.0.1:4567/update.json')).toBe('http://127.0.0.1:4567/update.json')
    expect(e2eManifestUrl('http://localhost:4567/x.json?y=1')).toBe('http://localhost:4567/x.json')
    expect(e2eManifestUrl('https://letsdrag.wakeupmonster.com/update.json')).toBeNull()
    expect(e2eManifestUrl('http://10.0.0.1/update.json')).toBeNull()
    expect(e2eManifestUrl('file:///tmp/u.json')).toBeNull()
    expect(e2eManifestUrl(undefined)).toBeNull()
  })
})
