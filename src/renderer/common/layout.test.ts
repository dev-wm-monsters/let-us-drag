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
  it('feed ring is unscaled at the default Feed Window size and scales down to fit smaller ones (B-064)', () => {
    // Drop zone of the 380x460 window (Linux) and of the same window inside a Windows frame.
    expect(feedRing(342, 325).scale).toBe(1)
    expect(overlayRing(560, 560).scale).toBe(1)
    expect(feedRing(326, 286).scale).toBeLessThan(1)
    // Minimum window size (300x340): the whole ring, hovered bubbles included, stays in the zone.
    for (const [w, h] of [[262, 189], [246, 150], [326, 286], [342, 325], [500, 300], [200, 600]] as const) {
      const r = feedRing(w, h)
      expect((r.radius + 54) * r.scale).toBeLessThanOrEqual(Math.min(w, h) / 2 + 0.01)
      expect(r.scale).toBeGreaterThan(0)
    }
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
