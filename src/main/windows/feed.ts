// Feed Window: a small window you can drop files onto (fallback for Wayland, denied macOS
// Accessibility, or preference). Opened from the tray. Not always-on-top by default
// (Settings has no field for it in v0.1; see the Platform report).

import type { WindowContext } from './common'
import { SingletonWindow } from './singleton'

export function createFeedWindow(ctx: WindowContext): SingletonWindow {
  return new SingletonWindow(ctx, 'feed', {
    width: 380,
    height: 460,
    minWidth: 300,
    minHeight: 340,
    title: 'Let us drag! — Feed the Uncle',
    fullscreenable: false,
    maximizable: false,
    backgroundColor: '#fff8ee'
  })
}
