// Settings window (also the first-run onboarding window).

import type { WindowContext } from './common'
import { SingletonWindow } from './singleton'

export function createSettingsWindow(ctx: WindowContext): SingletonWindow {
  return new SingletonWindow(ctx, 'settings', {
    width: 540,
    height: 680,
    minWidth: 420,
    minHeight: 480,
    title: 'Let us drag! — Settings',
    fullscreenable: false,
    maximizable: false,
    backgroundColor: '#fff8ee'
  })
}
