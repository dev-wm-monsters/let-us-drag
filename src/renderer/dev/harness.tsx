// Visual QA harness entry: renders the real overlay / feed / settings UI in plain Chromium with a
// mocked window.lud. Open via `node src/renderer/dev/serve.mjs` →
//   http://127.0.0.1:5199/dev/harness.html?view=overlay|feed|settings[&plain=1&hungry=1&platform=darwin&reason=mac-permission&firstRun=1&jobs=auto&bg=flat]
// Drive it from Playwright through window.__harness (see src/renderer/dev/capture.mjs).
import type { PlatformStatus, Settings } from '../../shared/types'
import { createMockLud, type MockControl } from './mock-lud'

interface FileSpec {
  name: string
  type: string
}

export interface Harness extends MockControl {
  view: string
  /** Dispatch a synthetic HTML5 drag event carrying files at client point (x, y). */
  drag(phase: 'dragenter' | 'dragover' | 'drop' | 'dragleave', x: number, y: number, files: FileSpec[]): void
  /** Convenience: enter + over at a point. */
  hoverAt(x: number, y: number, files: FileSpec[]): void
  /** Client position of an option bubble (or null). */
  optionPoint(id: string): { x: number; y: number } | null
  center(): { x: number; y: number }
  state(): string
  key(key: string): void
}

declare global {
  interface Window {
    __harness: Harness
  }
}

const q = new URLSearchParams(location.search)
const view = q.get('view') ?? 'overlay'
const settings: Partial<Settings> = {
  plainMode: q.get('plain') === '1',
  hungryMode: q.get('hungry') === '1',
  sounds: q.get('sounds') === '1',
  firstRunDone: q.get('firstRun') !== '1'
}
const platform: PlatformStatus = {
  platform: (q.get('platform') as PlatformStatus['platform']) ?? 'linux',
  gestureAvailable: !q.get('reason'),
  ...(q.get('reason') ? { gestureUnavailableReason: q.get('reason') as PlatformStatus['gestureUnavailableReason'] } : {}),
  ...(q.get('platform') === 'darwin' ? { accessibilityTrusted: !q.get('reason') } : {})
}
const mock = createMockLud({ settings, platform, jobs: (q.get('jobs') as 'auto' | 'manual') ?? 'manual' })
;(window as unknown as { lud: unknown }).lud = mock.api

function makeDataTransfer(files: FileSpec[]): DataTransfer {
  const dt = new DataTransfer()
  for (const f of files) dt.items.add(new File([new Uint8Array(16)], f.name, { type: f.type }))
  return dt
}

function stageEl(): HTMLElement | null {
  return document.querySelector('[data-uncle-state]')
}

window.__harness = {
  ...mock,
  view,
  drag(phase, x, y, files) {
    const target = document.elementFromPoint(x, y) ?? document.body
    const ev = new DragEvent(phase, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      dataTransfer: makeDataTransfer(files)
    })
    target.dispatchEvent(ev)
  },
  hoverAt(x, y, files) {
    this.drag('dragover', x, y, files)
  },
  optionPoint(id) {
    const el = document.querySelector(`[data-testid="option-${id}"]`)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  },
  center() {
    const r = stageEl()?.getBoundingClientRect()
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 }
  },
  state() {
    return stageEl()?.getAttribute('data-uncle-state') ?? 'none'
  },
  key(key) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  }
}

if (view === 'overlay') document.documentElement.classList.add(q.get('bg') === 'flat' ? 'harness-flat' : 'harness-desktop')

// Import the real window entry after the mock is installed.
if (view === 'feed') await import('../feed/main')
else if (view === 'settings') await import('../settings/main')
else await import('../overlay/main')
