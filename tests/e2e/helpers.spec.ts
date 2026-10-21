// Pure unit tests for the E2E helpers (no Electron). These must pass on the scaffold.
import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { dedupeConsecutive, expectedOutputPath, firstStateDuration, isSubsequence, safeFileStem } from './support/naming'

test.describe('e2e helpers', () => {
  test('expectedOutputPath: next to source, collision numbering', () => {
    const input = join('/data', 'photo.png')
    expect(expectedOutputPath(input, 'jpg')).toBe(join('/data', 'photo.jpg'))
    expect(expectedOutputPath(input, 'jpg', ['photo.jpg'])).toBe(join('/data', 'photo (1).jpg'))
    expect(expectedOutputPath(input, 'jpg', ['photo.jpg', 'photo (1).jpg'])).toBe(join('/data', 'photo (2).jpg'))
    expect(expectedOutputPath(join('/d', 'a.b.c.png'), 'webp')).toBe(join('/d', 'a.b.c.webp'))
    expect(expectedOutputPath(join('/d', 'été 写真.png'), 'webp')).toBe(join('/d', 'été 写真.webp'))
  })

  test('isSubsequence', () => {
    expect(isSubsequence(['eat', 'chew', 'spit'], ['hidden', 'appear', 'eat', 'chew', 'chew', 'spit', 'leave'])).toBe(true)
    expect(isSubsequence(['eat', 'chew', 'spit'], ['chew', 'eat', 'spit'])).toBe(false)
    expect(isSubsequence([], ['x'])).toBe(true)
    expect(isSubsequence(['x'], [])).toBe(false)
  })

  test('dedupeConsecutive', () => {
    expect(dedupeConsecutive(['a', 'a', 'b', 'a', 'a'])).toEqual(['a', 'b', 'a'])
  })

  test('firstStateDuration', () => {
    const tl = [
      { state: 'eat', t: 0 },
      { state: 'chew', t: 100 },
      { state: 'spit', t: 900 }
    ]
    expect(firstStateDuration(tl, 'chew')).toBe(800)
    expect(firstStateDuration(tl, 'spit')).toBeNull()
    expect(firstStateDuration(tl, 'choke')).toBeNull()
  })

  test('safeFileStem', () => {
    expect(safeFileStem('E2E-20 PNG → JPG: eat/chew')).toBe('E2E-20-PNG-JPG-eat-chew')
    expect(safeFileStem('///')).toBe('unnamed')
    expect(safeFileStem('x'.repeat(200))).toHaveLength(80)
  })
})
