import { describe, expect, it } from 'vitest'
import type { DroppedItem, OptionId } from '../../shared/types'
import {
  categoryForProbe,
  isFileDrag,
  isHamster,
  isStruggle,
  itemsAreBlocked,
  optionsForItems,
  optionsForProbe,
  probeFromItems,
  probeExts,
  probeIsGuess,
  setDevOptionsOverride
} from './drag'
import { baseName, formatBytes, friendlyError, shortName } from './text'

const item = (name: string, extra: Partial<DroppedItem> = {}): DroppedItem => {
  const dot = name.lastIndexOf('.')
  return {
    path: `/tmp/${name}`,
    name,
    ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : '',
    isDirectory: false,
    sizeBytes: 1000,
    ...extra
  }
}

describe('drag helpers', () => {
  it('detects file drags only', () => {
    expect(isFileDrag(['Files'])).toBe(true)
    expect(isFileDrag(['text/plain', 'Files'])).toBe(true)
    expect(isFileDrag(['text/plain'])).toBe(false)
    expect(isFileDrag(null)).toBe(false)
  })

  it('builds probes from file items only', () => {
    const p = probeFromItems([
      { kind: 'file', type: 'image/png' },
      { kind: 'string', type: 'text/uri-list' },
      { kind: 'file', type: '' }
    ])
    expect(p).toEqual({ mimeTypes: ['image/png', ''], count: 2 })
  })

  it('categorises probes', () => {
    expect(categoryForProbe({ mimeTypes: ['image/png', 'image/jpeg'], count: 2 })).toBe('image')
    expect(categoryForProbe({ mimeTypes: ['image/png', 'video/mp4'], count: 2 })).toBe('unknown')
    expect(categoryForProbe({ mimeTypes: [''], count: 1 })).toBe('unknown')
    expect(categoryForProbe({ mimeTypes: [], count: 0 })).toBe('unknown')
    expect(categoryForProbe({ mimeTypes: ['application/x-msdownload'], count: 1 })).toBe('blocked')
  })

  it('options for a probe: known category shows its options, unknown/mixed ZIP, blocked none (D31)', () => {
    const ids = optionsForProbe({ mimeTypes: ['image/png'], count: 1 }).map((o) => o.id)
    expect(ids).toContain('to-jpg')
    // D30: more than 8 options are allowed now (renderer "More…" bubble); ZIP comes last
    expect(ids.at(-1)).toBe('zip')
    // D31: extensions told by the MIME types already apply during the drag: no-op PNG → PNG hidden,
    // extension-only options shown (GIF → MP4, CSV → PDF), exactly like the ring after the drop.
    expect(ids).not.toContain('to-png')
    expect(ids).not.toContain('to-mp4')
    expect(probeExts({ mimeTypes: ['image/png'], count: 1 })).toEqual(['png'])
    expect(optionsForProbe({ mimeTypes: ['image/gif'], count: 1 }).map((o) => o.id)).toContain('to-mp4')
    expect(optionsForProbe({ mimeTypes: ['text/csv'], count: 1 }).map((o) => o.id)).toContain('to-pdf')
    expect(optionsForProbe({ mimeTypes: ['application/json'], count: 1 }).map((o) => o.id)).not.toContain('to-pdf')
    // An ambiguous MIME type (image/tiff has no unambiguous extension here) → category options only.
    expect(probeExts({ mimeTypes: ['image/png', 'image/tiff'], count: 2 })).toEqual([])
    expect(optionsForProbe({ mimeTypes: ['image/png', 'image/tiff'], count: 2 }).map((o) => o.id)).toContain('to-png')
    expect(optionsForItems([item('a.png')]).map((o) => o.id)).toEqual(ids)
    expect(probeIsGuess({ mimeTypes: ['image/png'], count: 1 })).toBe(false)
    // D30: Chromium's image/svg+xml is a known category now (vector), not a guess.
    expect(optionsForProbe({ mimeTypes: ['image/svg+xml'], count: 1 }).map((o) => o.id)).toEqual(['to-png', 'to-jpg', 'to-pdf', 'zip'])
    expect(probeIsGuess({ mimeTypes: ['image/svg+xml'], count: 1 })).toBe(false)
    const zipOnly = [
      [''], // many documents (and SVG on some systems): Chromium reports no type
      ['', ''],
      ['image/png', ''], // some known, some unknown: what fits all cannot be told before the drop
      ['image/png', 'video/mp4'], // mixed
      ['image/png', 'image/svg+xml'], // image + vector: mixed
      ['application/pdf', 'application/zip'],
      [] // no items readable during the drag
    ]
    for (const mimeTypes of zipOnly) {
      const probe = { mimeTypes, count: mimeTypes.length }
      expect(optionsForProbe(probe).map((o) => o.id), mimeTypes.join('+')).toEqual(['zip'])
      expect(probeIsGuess(probe)).toBe(true)
    }
    // Blocked anywhere in the selection: nothing (he refuses), also next to unknown types.
    expect(optionsForProbe({ mimeTypes: ['application/x-msdownload'], count: 1 })).toEqual([])
    expect(optionsForProbe({ mimeTypes: ['', 'application/x-msdownload'], count: 2 })).toEqual([])
    expect(categoryForProbe({ mimeTypes: ['', 'application/x-msdownload'], count: 2 })).toBe('blocked')
    // A single archive still offers Unzip, not the ZIP guess.
    expect(optionsForProbe({ mimeTypes: ['application/zip'], count: 1 }).map((o) => o.id)).toEqual(['unzip'])
  })

  it('the harness options override pads probe and item options, never blocked ones', () => {
    const extra = { id: 'dev-x' as OptionId, label: 'X', hint: 'x', batch: 'each' as const, minInputs: 1 }
    setDevOptionsOverride((options) => [...options, extra])
    try {
      expect(optionsForProbe({ mimeTypes: [''], count: 1 }).map((o) => o.id)).toEqual(['zip', 'dev-x'])
      expect(optionsForItems([item('a.png')]).map((o) => o.id)).toContain('dev-x')
      expect(optionsForProbe({ mimeTypes: ['application/x-msdownload'], count: 1 })).toEqual([])
    } finally {
      setDevOptionsOverride(null)
    }
    expect(optionsForProbe({ mimeTypes: [''], count: 1 }).map((o) => o.id)).toEqual(['zip'])
  })

  it('options for real items hide no-ops and handle folders/mixed', () => {
    const png = optionsForItems([item('a.png')]).map((o) => o.id)
    expect(png).not.toContain('to-png')
    expect(png).toContain('to-jpg')
    expect(optionsForItems([item('a.png'), item('b.mp4')]).map((o) => o.id)).toEqual(['zip'])
    expect(optionsForItems([item('dir', { isDirectory: true })]).map((o) => o.id)).toEqual(['zip'])
    expect(optionsForItems([item('a.pdf'), item('b.pdf')]).map((o) => o.id)).toContain('pdf-merge')
  })

  it('blocked / hamster / struggle', () => {
    expect(itemsAreBlocked([item('a.png'), item('evil.EXE')])).toBe(true)
    expect(itemsAreBlocked([item('folder.exe', { isDirectory: true })])).toBe(false)
    expect(isHamster(2)).toBe(false)
    expect(isHamster(3)).toBe(true)
    expect(isStruggle([item('a.mov', { sizeBytes: 200 * 1024 * 1024 })])).toBe(false)
    expect(isStruggle([item('a.mov', { sizeBytes: 200 * 1024 * 1024 + 1 })])).toBe(true)
  })
})

describe('text helpers', () => {
  it('friendlyError prefers the engine message, falls back per code', () => {
    expect(friendlyError({ code: 'TOOL_FAILED', message: 'FFmpeg could not read the video.' })).toBe(
      'FFmpeg could not read the video.'
    )
    expect(friendlyError({ code: 'INPUT_INVALID', message: '' })).toMatch(/broken/)
    expect(friendlyError({ code: 'INTERNAL', message: 'x'.repeat(500) })).toMatch(/hiccup/)
    expect(friendlyError(null)).toMatch(/hiccup/)
  })
  it('baseName works for posix and windows paths', () => {
    expect(baseName('/a/b/c.png')).toBe('c.png')
    expect(baseName('C:\\Users\\me\\c (1).png')).toBe('c (1).png')
    expect(baseName('/a/b/pages/')).toBe('pages')
    expect(baseName('plain')).toBe('plain')
  })
  it('shortName keeps the extension', () => {
    expect(shortName('short.png')).toBe('short.png')
    const s = shortName('a-very-very-long-file-name-for-the-uncle.jpeg', 20)
    expect(s.length).toBe(20)
    expect(s.endsWith('.jpeg')).toBe(true)
    expect(s).toContain('…')
  })
  it('formatBytes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(300 * 1024 * 1024)).toBe('300 MB')
    expect(formatBytes(-1)).toBe('')
  })
})
