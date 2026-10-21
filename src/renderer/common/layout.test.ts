import { describe, expect, it } from 'vitest'
import { gestureMessage, triggerKeyLabels } from '../settings/labels'
import { feedRing, overlayRing, uncleWidthFor } from './layout'

describe('layout', () => {
  it('overlay ring is ~190px in a large window and shrinks to fit small ones', () => {
    expect(overlayRing(600, 600).radius).toBe(190)
    expect(overlayRing(400, 600).radius).toBe(142)
    expect(overlayRing(100, 100).radius).toBe(120)
    expect(overlayRing(600, 600).hitRadius * 2).toBeGreaterThanOrEqual(64)
  })
  it('feed ring fits the window', () => {
    expect(feedRing(400, 400).radius).toBe(146)
    expect(feedRing(2000, 2000).radius).toBe(190)
    expect(feedRing(400, 400).hitRadius * 2).toBeGreaterThanOrEqual(64)
  })
  it('uncle width reads well at 220–260px in the overlay', () => {
    const w = uncleWidthFor(overlayRing(600, 600).radius, 250)
    expect(w).toBeGreaterThanOrEqual(220)
    expect(w).toBeLessThanOrEqual(260)
  })
})

describe('settings labels', () => {
  it('uses platform-specific key names', () => {
    expect(triggerKeyLabels('darwin').meta).toMatch(/Command/)
    expect(triggerKeyLabels('win32').meta).toMatch(/Windows/)
    expect(triggerKeyLabels('linux').alt).toBe('Alt')
  })
  it('explains every gesture status', () => {
    expect(gestureMessage(null).ok).toBe(false)
    expect(gestureMessage({ platform: 'linux', gestureAvailable: true }).ok).toBe(true)
    for (const reason of ['wayland', 'mac-permission', 'hook-failed', undefined] as const) {
      const m = gestureMessage({ platform: 'linux', gestureAvailable: false, gestureUnavailableReason: reason })
      expect(m.ok).toBe(false)
      expect(m.text).toMatch(/Feed Window/)
    }
  })
})
