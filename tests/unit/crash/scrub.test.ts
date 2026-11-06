// D28: crash report scrubbing. Nothing that names a user's file, folder or account may leave.
import { describe, expect, it } from 'vitest'
import { allowedEnvelopeItem, scrubBreadcrumb, scrubEvent, scrubText, type ScrubContext } from '../../../src/main/crash/scrub'

const mac: ScrubContext = {
  appRoots: ["/Applications/Let's Drag!.app/Contents/Resources/app.asar", "/Applications/Let's Drag!.app/Contents/Resources"],
  homeDir: '/Users/jane'
}
const win: ScrubContext = {
  appRoots: ["C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\Let's Drag!\\resources\\app.asar", "C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\Let's Drag!\\resources"],
  homeDir: 'C:\\Users\\Jane Doe'
}
const linux: ScrubContext = { appRoots: ['/tmp/.mount_LetsDrABC123/resources/app.asar', '/tmp/.mount_LetsDrABC123/resources'], homeDir: '/home/jürgen' }

describe('scrubText: macOS', () => {
  it('replaces paths under home with ~/<path>', () => {
    expect(scrubText("ENOENT: no such file or directory, open '/Users/jane/Desktop/Tax Return 2025.pdf'", mac)).toBe(
      "ENOENT: no such file or directory, open '~/<path>'"
    )
    expect(scrubText('Failed /Users/jane/My Pictures/holiday photo.png now', mac)).toBe('Failed ~/<path> now')
    expect(scrubText('home is /Users/jane', mac)).toBe('home is ~')
  })
  it('normalises our own app paths to app:///', () => {
    expect(scrubText("at f (/Applications/Let's Drag!.app/Contents/Resources/app.asar/out/main/index.js:10:5)", mac)).toBe(
      'at f (app:///out/main/index.js:10:5)'
    )
    expect(scrubText("/Applications/Let's Drag!.app/Contents/Resources/bin/ffmpeg exited", mac)).toBe('app:///bin/ffmpeg exited')
  })
  it('replaces other absolute paths and temp dirs', () => {
    expect(scrubText('wrote /private/var/folders/xy/T/lud-123/out.webp', mac)).toBe('wrote <path>')
    expect(scrubText('/Volumes/USB Stick/clip.mov failed', mac)).toBe('<path> failed')
  })
  it('keeps URLs, ratios and node internals', () => {
    expect(scrubText('see https://example.com/a/b and 1/2 and node:internal/fs/utils', mac)).toBe(
      'see https://example.com/a/b and 1/2 and node:internal/fs/utils'
    )
    expect(scrubText('app:///out/renderer/assets/settings-abc.js', mac)).toBe('app:///out/renderer/assets/settings-abc.js')
  })
})

describe('scrubText: Windows', () => {
  it('home (with a space in the user name), backslashes, forward slashes and JSON escapes', () => {
    expect(scrubText('open C:\\Users\\Jane Doe\\Documents\\invoice.docx', win)).toBe('open ~/<path>')
    expect(scrubText('open C:/Users/Jane Doe/Documents/invoice.docx', win)).toBe('open ~/<path>')
    expect(scrubText('"C:\\\\Users\\\\Jane Doe\\\\Desktop\\\\a.png"', win)).toBe('"~/<path>"')
    expect(scrubText('open c:\\users\\jane doe\\x.png', win)).toBe('open ~/<path>')
  })
  it('other drives and our install dir', () => {
    expect(scrubText('D:\\Photos\\Family\\IMG_0001.HEIC is broken', win)).toBe('<path> is broken')
    expect(scrubText("C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\Let's Drag!\\resources\\app.asar\\out\\engine-worker.js:1", win)).toBe(
      'app:///out/engine-worker.js:1'
    )
  })
  it('UNC paths (both spellings)', () => {
    expect(scrubText('read \\\\fileserver\\share\\team\\plan.xlsx failed', win)).toBe('read <path> failed')
    expect(scrubText('read //fileserver/share/plan.xlsx failed', win)).toBe('read <path> failed')
  })
})

describe('scrubText: Linux', () => {
  it('Unicode home and names', () => {
    expect(scrubText('/home/jürgen/Bilder/Grüße aus Köln.jpg', linux)).toBe('~/<path>')
    expect(scrubText("'/home/jürgen/文档/报告.pdf'", linux)).toBe("'~/<path>'")
  })
  it('AppImage mount is our app', () => {
    expect(scrubText('/tmp/.mount_LetsDrABC123/resources/app.asar/out/main/index.js:3:1', linux)).toBe('app:///out/main/index.js:3:1')
  })
  it('~ paths written by our own logs', () => {
    expect(scrubText('saved ~/Downloads/x.png', linux)).toBe('saved ~/<path>')
  })
})

describe('scrubText: file:// URLs', () => {
  it('decodes and scrubs them', () => {
    expect(scrubText('load file:///Users/jane/Desktop/My%20File.png', mac)).toBe('load ~/<path>')
    expect(scrubText('file:///C:/Users/Jane%20Doe/x.pdf', win)).toBe('~/<path>')
    expect(scrubText('file://server/share/x.pdf', win)).toBe('<path>')
    expect(scrubText("file:///Applications/Let's%20Drag!.app/Contents/Resources/app.asar/out/renderer/settings/index.html", mac)).toBe(
      'app:///out/renderer/settings/index.html'
    )
    expect(scrubText('file:///home/j%C3%BCrgen/%E6%96%87.png', linux)).toBe('~/<path>')
  })
})

describe('scrubText: file names, keys and IDs', () => {
  it('strips bare user file names', () => {
    expect(scrubText('Could not convert holiday.PNG to webp', mac)).toBe('Could not convert <file> to webp')
    expect(scrubText('bad archive backup.tar.gz', mac)).toBe('bad archive <file>')
    expect(scrubText('Grüße.heic', mac)).toBe('<file>')
    expect(scrubText('module index.js line 3, see sentry.io and example.com', mac)).toBe('module index.js line 3, see sentry.io and example.com')
  })
  it('strips licence keys and UUIDs (install ID)', () => {
    expect(scrubText('key LD7Q-29XK-PM3A-1A2B rejected', mac)).toBe('key <id> rejected')
    expect(scrubText('install 3f2b8c1e-9a4d-4c2e-8f1a-2b3c4d5e6f70', mac)).toBe('install <id>')
    expect(scrubText('a cannot-convert-this-file message', mac)).toBe('a cannot-convert-this-file message')
  })
})

describe('scrubEvent', () => {
  const event = {
    event_id: '0123456789abcdef0123456789abcdef',
    level: 'error',
    platform: 'node',
    release: 'lets-drag@0.1.0',
    environment: 'production',
    server_name: 'janes-macbook',
    message: 'oops /Users/jane/a.png',
    user: { id: 'x', ip_address: '1.2.3.4', username: 'jane' },
    request: { url: 'file:///Users/jane/x', headers: { 'User-Agent': 'x' } },
    extra: { settings: { licenceKey: 'LD7Q-29XK-PM3A-1A2B' } },
    modules: { sharp: '1.0.0' },
    tags: { 'app.version': '0.1.0', os: 'darwin', character: 'uncle', path: '/Users/jane/a.png', 'event.process': 'renderer' },
    contexts: {
      os: { name: 'macOS', version: '15.1' },
      device: { arch: 'arm64', memory_size: 1, boot_time: 'x' },
      culture: { timezone: 'Europe/Paris', locale: 'fr-FR' },
      app: { app_name: "Let's Drag!", app_version: '0.1.0', app_memory: 1 },
      electron: { crashed_url: 'file:///Users/jane/secret/index.html' }
    },
    exception: {
      values: [
        {
          type: 'Error',
          value: "ENOENT: open '/Users/jane/Desktop/Passport Scan.jpg'",
          stacktrace: {
            frames: [
              { filename: 'app:///out/main/index.js', lineno: 1, vars: { p: '/Users/jane/x' }, context_line: 'code' },
              { filename: '/Users/jane/elsewhere/x.js' }
            ]
          }
        }
      ]
    },
    breadcrumbs: [
      { category: 'console', message: 'opened /Users/jane/a.png' },
      { category: 'electron', message: 'app.ready' },
      { category: 'child-process', message: "'Utility' exited", data: { serviceName: 'x', file: '/Users/jane/b.png' } }
    ],
    debug_meta: { images: [{ type: 'sourcemap', code_file: 'app:///out/main/index.js', debug_id: '3f2b8c1e-9a4d-4c2e-8f1a-2b3c4d5e6f70' }] }
  }

  it('keeps only allow-listed fields, tags and contexts', () => {
    const out = scrubEvent(event, mac) as Record<string, unknown>
    expect(out['server_name']).toBeUndefined()
    expect(out['request']).toBeUndefined()
    expect(out['extra']).toBeUndefined()
    expect(out['modules']).toBeUndefined()
    expect(out['user']).toEqual({ ip_address: null })
    expect(out['tags']).toEqual({ 'app.version': '0.1.0', os: 'darwin', character: 'uncle', 'event.process': 'renderer' })
    expect(out['contexts']).toEqual({
      os: { name: 'macOS', version: '15.1' },
      device: { arch: 'arm64' },
      app: { app_name: "Let's Drag!", app_version: '0.1.0' },
      electron: { crashed_url: '~/<path>' }
    })
  })

  it('scrubs messages, exception values, frames and breadcrumbs; drops console breadcrumbs and frame vars', () => {
    const out = scrubEvent(event, mac) as typeof event
    expect(out.message).toBe('oops ~/<path>')
    const ex = out.exception.values[0]!
    expect(ex.value).toBe("ENOENT: open '~/<path>'")
    expect(ex.stacktrace.frames[0]).toEqual({ filename: 'app:///out/main/index.js', lineno: 1 })
    expect(ex.stacktrace.frames[1]!.filename).toBe('~/<path>')
    expect(out.breadcrumbs.map((b) => b.category)).toEqual(['electron', 'child-process'])
    expect(JSON.stringify(out.breadcrumbs)).not.toContain('jane')
    expect(out.debug_meta.images[0]!.debug_id).toBe('3f2b8c1e-9a4d-4c2e-8f1a-2b3c4d5e6f70')
    expect(out.event_id).toBe(event.event_id)
    const json = JSON.stringify(out)
    expect(json).not.toMatch(/jane|Passport|LD7Q|janes-macbook|Europe\/Paris|\.png|\.jpg/)
  })

  it('does not modify the input', () => {
    const copy = JSON.parse(JSON.stringify(event)) as unknown
    scrubEvent(event, mac)
    expect(event).toEqual(copy)
  })
})

describe('scrubBreadcrumb', () => {
  it('drops console / network breadcrumbs and scrubs the rest', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'x' }, mac)).toBeNull()
    expect(scrubBreadcrumb({ category: 'fetch', data: { url: 'https://x' } }, mac)).toBeNull()
    expect(scrubBreadcrumb({ type: 'http', category: 'electron.net' }, mac)).toBeNull()
    expect(scrubBreadcrumb({ category: 'electron', message: 'opened /Users/jane/x.png' }, mac)).toEqual({ category: 'electron', message: 'opened ~/<path>' })
  })
})

describe('allowedEnvelopeItem', () => {
  it('lets only events and minidumps through', () => {
    expect(allowedEnvelopeItem({ type: 'event' })).toBe(true)
    expect(allowedEnvelopeItem({ type: 'attachment', attachment_type: 'event.minidump' })).toBe(true)
    for (const type of ['session', 'sessions', 'transaction', 'span', 'log', 'trace_metric', 'profile', 'profile_chunk', 'replay_event', 'feedback', 'client_report', 'check_in']) {
      expect(allowedEnvelopeItem({ type })).toBe(false)
    }
    expect(allowedEnvelopeItem({ type: 'attachment', attachment_type: 'event.attachment' })).toBe(false)
  })
})
