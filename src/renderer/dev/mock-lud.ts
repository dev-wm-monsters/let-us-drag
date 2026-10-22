// In-memory mock of window.lud for the visual QA harness (plain Chromium, no Electron).
// Not shipped: only referenced by src/renderer/dev/harness.tsx.
import type { LudApi, OverlayArmInfo } from '../../shared/api'
import type { TestDropPayload } from '../../shared/test-hooks'
import type { DroppedItem, JobEvent, JobRequest, OptionId, PlatformStatus, Settings } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'

type Listener<T> = (v: T) => void

class Channel<T> {
  private ls = new Set<Listener<T>>()
  on(cb: Listener<T>): () => void {
    this.ls.add(cb)
    return () => this.ls.delete(cb)
  }
  emit(v: T): void {
    for (const l of [...this.ls]) l(v)
  }
}

const TARGET_EXT: Partial<Record<OptionId, string>> = {
  'to-png': 'png',
  'to-jpg': 'jpg',
  'to-webp': 'webp',
  'to-avif': 'avif',
  'to-pdf': 'pdf',
  'to-ico': 'ico',
  'remove-bg': 'png',
  'to-mp4': 'mp4',
  'to-mov': 'mov',
  'to-webm': 'webm',
  'to-gif': 'gif',
  'to-mp3': 'mp3',
  'to-wav': 'wav',
  'to-m4a': 'm4a',
  'to-ogg': 'ogg',
  'to-flac': 'flac',
  'pdf-to-png': '',
  'pdf-to-jpg': '',
  'to-txt': 'txt',
  'pdf-merge': 'pdf',
  'to-html': 'html',
  'to-md': 'md',
  'to-docx': 'docx',
  'to-csv': 'csv',
  'to-json': 'json',
  'to-yaml': 'yaml',
  'to-xlsx': 'xlsx',
  zip: 'zip',
  unzip: ''
}

export interface MockOptions {
  settings?: Partial<Settings>
  platform?: PlatformStatus
  /** 'auto' simulates progress + done; 'manual' waits for control.emitJobEvent(). */
  jobs?: 'auto' | 'manual'
  jobMs?: number
  baseDir?: string
}

export interface MockControl {
  api: LudApi
  calls: { name: string; args: unknown[] }[]
  jobs: JobRequest[]
  settings: Settings
  setJobs(mode: 'auto' | 'manual'): void
  emitJobEvent(e: JobEvent): void
  lastJobId(): string | null
  arm(info?: Partial<OverlayArmInfo>): void
  disarm(): void
  cursor(p: { x: number; y: number }): void
  testDrop(p: TestDropPayload): void
  /** E2E-style drop on the Feed Window (LudTestHooks.dropFilesOnFeed). */
  testFeedDrop(p: TestDropPayload): void
  /** E2E-style cancel of the running job (LudTestHooks.cancelActive). */
  testCancel(): void
  changeSettings(patch: Partial<Settings>): void
  /** Last value set through setOverlayClickThrough (D20); reset to false by arm(), like main does. */
  clickThrough(): boolean
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

export function describeMockPath(path: string): DroppedItem {
  const name = baseName(path.replace(/[\\/]+$/, ''))
  const dot = name.lastIndexOf('.')
  const isDirectory = dot <= 0
  const huge = /huge|big/i.test(name)
  return {
    path,
    name,
    ext: isDirectory ? '' : name.slice(dot + 1).toLowerCase(),
    isDirectory,
    sizeBytes: huge ? 350 * 1024 * 1024 : 2_400_000
  }
}

export function mockOutputPath(input: string, optionId: OptionId): string {
  const dir = input.slice(0, Math.max(input.lastIndexOf('/'), input.lastIndexOf('\\')) + 1)
  const name = baseName(input)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = TARGET_EXT[optionId]
  if (ext === '') return `${dir}${stem} (pages)`
  if (optionId === 'compress') return `${dir}${stem} (compressed)${dot > 0 ? name.slice(dot) : ''}`
  if (optionId === 'remove-bg') return `${dir}${stem} (no background).png`
  return `${dir}${stem}.${ext ?? 'out'}`
}

export function createMockLud(opts: MockOptions = {}): MockControl {
  const job = new Channel<JobEvent>()
  const armCh = new Channel<OverlayArmInfo>()
  const disarmCh = new Channel<void>()
  const cursorCh = new Channel<{ x: number; y: number }>()
  const settingsCh = new Channel<Settings>()
  const testDropCh = new Channel<TestDropPayload>()
  const testFeedDropCh = new Channel<TestDropPayload>()
  const testCancelCh = new Channel<void>()
  const calls: MockControl['calls'] = []
  const jobs: JobRequest[] = []
  let mode = opts.jobs ?? 'manual'
  const baseDir = opts.baseDir ?? '/Users/demo/Desktop/'
  const settings: Settings = { ...DEFAULT_SETTINGS, ...opts.settings }
  const platform: PlatformStatus = opts.platform ?? { platform: 'linux', gestureAvailable: true }
  const log = (name: string, ...args: unknown[]) => calls.push({ name, args })
  let clickThrough = false

  const runAuto = (req: JobRequest) => {
    const total = opts.jobMs ?? 1600
    const steps = 8
    job.emit({ type: 'queued', jobId: req.id })
    for (let i = 1; i <= steps; i++) {
      setTimeout(() => job.emit({ type: 'progress', jobId: req.id, progress: i / steps }), (total * i) / (steps + 1))
    }
    setTimeout(() => {
      const broken = req.inputPaths.some((p) => /broken/i.test(p))
      if (broken) {
        job.emit({
          type: 'error',
          jobId: req.id,
          error: { code: 'INPUT_INVALID', message: 'Blegh! That file seems broken.' }
        })
      } else {
        job.emit({ type: 'done', jobId: req.id, outputPaths: [mockOutputPath(req.inputPaths[0] ?? 'file', req.optionId)] })
      }
    }, total)
  }

  const api: LudApi = {
    pathsForFiles: (files) => {
      log('pathsForFiles', files.length)
      return files.map((f) => baseDir + f.name)
    },
    describePaths: async (paths) => {
      log('describePaths', paths)
      return paths.map(describeMockPath)
    },
    startJob: async (req) => {
      log('startJob', req)
      jobs.push(req)
      if (mode === 'auto') runAuto(req)
    },
    cancelJob: async (id) => {
      log('cancelJob', id)
      job.emit({ type: 'error', jobId: id, error: { code: 'CANCELLED', message: '' } })
    },
    revealPath: async (p) => void log('revealPath', p),
    getSettings: async () => ({ ...settings }),
    setSettings: async (patch) => {
      log('setSettings', patch)
      Object.assign(settings, patch)
      settingsCh.emit({ ...settings })
      return { ...settings }
    },
    getPlatformStatus: async () => ({ ...platform }),
    requestAccessibility: async () => {
      log('requestAccessibility')
      platform.accessibilityTrusted = true
      platform.gestureAvailable = true
      delete platform.gestureUnavailableReason
      return true
    },
    setOverlayInteractive: async (v) => void log('setOverlayInteractive', v),
    setOverlayClickThrough: async (v) => void log('setOverlayClickThrough', v),
    overlayDone: async () => void log('overlayDone'),
    overlayEngaged: async () => void log('overlayEngaged'),
    openFeedWindow: async () => void log('openFeedWindow'),
    openSettingsWindow: async () => void log('openSettingsWindow'),
    setOverlayClickThrough: async (v) => {
      log('setOverlayClickThrough', v)
      clickThrough = v
    },
    onPlatformStatusChanged: () => () => {},
    onJobEvent: (cb) => job.on(cb),
    onOverlayArm: (cb) => armCh.on(cb),
    onOverlayDisarm: (cb) => disarmCh.on(() => cb()),
    onCursor: (cb) => cursorCh.on(cb),
    onSettingsChanged: (cb) => settingsCh.on(cb),
    onTestDrop: (cb) => testDropCh.on(cb),
    onTestFeedDrop: (cb) => testFeedDropCh.on(cb),
    onTestCancel: (cb) => testCancelCh.on(() => cb())
  }

  return {
    api,
    calls,
    jobs,
    settings,
    setJobs: (m) => {
      mode = m
    },
    emitJobEvent: (e) => job.emit(e),
    lastJobId: () => jobs[jobs.length - 1]?.id ?? null,
    arm: (info) => {
      // Main forces the overlay back to a normal drop target when it arms the sensor (D20).
      clickThrough = false
      armCh.emit({ cursor: info?.cursor ?? { x: 300, y: 300 }, settings: info?.settings ?? { ...settings } })
    },
    disarm: () => disarmCh.emit(),
    cursor: (p) => cursorCh.emit(p),
    testDrop: (p) => testDropCh.emit(p),
    testFeedDrop: (p) => testFeedDropCh.emit(p),
    testCancel: () => testCancelCh.emit(),
    changeSettings: (patch) => {
      Object.assign(settings, patch)
      settingsCh.emit({ ...settings })
    },
    clickThrough: () => clickThrough
  }
}
