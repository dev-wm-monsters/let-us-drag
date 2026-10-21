import { describe, expect, it } from 'vitest'
import { categoryForExt, categoryForMime, combinedCategory, optionsFor } from '../../src/shared/catalog'

describe('catalog', () => {
  it('maps extensions case-insensitively', () => {
    expect(categoryForExt('.PNG')).toBe('image')
    expect(categoryForExt('heic')).toBe('image')
    expect(categoryForExt('mkv')).toBe('video')
    expect(categoryForExt('exe')).toBe('blocked')
    expect(categoryForExt('xyz')).toBe('unknown')
  })

  it('maps MIME types', () => {
    expect(categoryForMime('image/png')).toBe('image')
    expect(categoryForMime('application/pdf')).toBe('pdf')
    expect(categoryForMime('')).toBe('unknown')
    expect(categoryForMime('image/svg+xml')).toBe('unknown')
  })

  it('hides no-op conversions', () => {
    const ids = optionsFor({ categories: ['image'], exts: ['png'], count: 1, hasDirectory: false }).map((o) => o.id)
    expect(ids).not.toContain('to-png')
    expect(ids).toContain('to-jpg')
    expect(ids.length).toBeLessThanOrEqual(8)
  })

  it('mixed or folder inputs only offer ZIP', () => {
    expect(optionsFor({ categories: ['image', 'video'], exts: [], count: 2, hasDirectory: false }).map((o) => o.id)).toEqual(['zip'])
    expect(combinedCategory(['image'], true)).toBe('unknown')
  })

  it('blocked inputs offer nothing', () => {
    expect(optionsFor({ categories: ['blocked'], exts: ['exe'], count: 1, hasDirectory: false })).toEqual([])
  })

  it('pdf-merge needs two PDFs', () => {
    expect(optionsFor({ categories: ['pdf'], exts: ['pdf'], count: 1, hasDirectory: false }).map((o) => o.id)).not.toContain('pdf-merge')
    expect(optionsFor({ categories: ['pdf', 'pdf'], exts: ['pdf', 'pdf'], count: 2, hasDirectory: false }).map((o) => o.id)).toContain('pdf-merge')
  })
})
