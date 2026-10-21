import { describe, expect, it } from 'vitest'
import type { DroppedItem } from '../../shared/types'
import {
  categoryForProbe,
  isFileDrag,
  isHamster,
  isStruggle,
  itemsAreBlocked,
  optionsForItems,
  optionsForProbe,
  probeFromItems
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

  it('options for a probe: known category shows its options, unknown/blocked none', () => {
    const ids = optionsForProbe({ mimeTypes: ['image/png'], count: 1 }).map((o) => o.id)
    expect(ids).toContain('to-png')
    expect(ids.length).toBeLessThanOrEqual(8)
    expect(optionsForProbe({ mimeTypes: [''], count: 1 })).toEqual([])
    expect(optionsForProbe({ mimeTypes: ['application/x-msdownload'], count: 1 })).toEqual([])
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
