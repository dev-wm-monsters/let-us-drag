// All ipcMain.handle handlers (src/shared/api.ts). Every payload is validated with zod and every
// call must come from one of our own windows showing one of our renderer pages.

import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '../shared/api'
import type { JobRequest, PlatformStatus, Settings } from '../shared/types'
import {
  absolutePathSchema,
  booleanSchema,
  describePaths,
  IpcInputError,
  jobIdSchema,
  parseOrThrow,
  validateJobRequest
} from './ipc-validation'
import type { JobRegistry } from './job-registry'
import { isTrustedRendererUrl, type RuntimeLayout } from './paths'

export interface IpcDeps {
  layout: RuntimeLayout
  /** webContents ids of our windows (overlay, feed, settings). */
  isOwnWebContents(id: number): boolean
  overlayWebContentsId(): number
  getSettings(): Settings
  updateSettings(patch: unknown): Promise<Settings>
  startJob(req: JobRequest, fromOverlay: boolean): void
  cancelJob(jobId: string): void
  registry: JobRegistry
  platformStatus(): PlatformStatus
  requestAccessibility(): boolean
  overlay: {
    setInteractive(v: boolean): void
    done(): void
    engaged(): void
  }
  openFeedWindow(): Promise<unknown>
  openSettingsWindow(): Promise<unknown>
}

export class UntrustedSenderError extends Error {
  constructor() {
    super('Request rejected.')
    this.name = 'UntrustedSenderError'
  }
}

type Handler = (event: IpcMainInvokeEvent, arg: unknown) => unknown

export function registerIpc(deps: IpcDeps): () => void {
  const channels: string[] = []

  const isTrusted = (event: IpcMainInvokeEvent, overlayOnly: boolean): boolean => {
    if (!deps.isOwnWebContents(event.sender.id)) return false
    if (overlayOnly && event.sender.id !== deps.overlayWebContentsId()) return false
    const frame = event.senderFrame
    if (!frame || frame.parent !== null) return false // main frame only
    return isTrustedRendererUrl(frame.url, deps.layout)
  }

  const handle = (channel: string, fn: Handler, opts: { overlayOnly?: boolean } = {}): void => {
    channels.push(channel)
    ipcMain.handle(channel, async (event, arg: unknown) => {
      if (!isTrusted(event, opts.overlayOnly === true)) throw new UntrustedSenderError()
      try {
        return await fn(event, arg)
      } catch (err) {
        if (err instanceof IpcInputError) throw err
        // Do not leak internals; keep a friendly message.
        throw new Error(err instanceof Error && err.name === 'ZodError' ? 'Invalid request.' : 'Something went wrong.')
      }
    })
  }

  handle(IPC.describePaths, (_e, paths) => describePaths(paths))

  handle(IPC.startJob, async (e, raw) => {
    const req = await validateJobRequest(raw)
    deps.startJob(req, e.sender.id === deps.overlayWebContentsId())
  })

  handle(IPC.cancelJob, (_e, raw) => {
    deps.cancelJob(parseOrThrow(jobIdSchema, raw, 'job id'))
  })

  handle(IPC.revealPath, (_e, raw) => {
    const p = parseOrThrow(absolutePathSchema, raw, 'path')
    if (!deps.registry.isRevealable(p)) throw new IpcInputError('That file was not made by Let us drag!.')
    shell.showItemInFolder(p)
  })

  handle(IPC.getSettings, () => deps.getSettings())
  handle(IPC.setSettings, (_e, patch) => deps.updateSettings(patch))
  handle(IPC.getPlatformStatus, () => deps.platformStatus())
  handle(IPC.requestAccessibility, () => deps.requestAccessibility())

  handle(
    IPC.overlayInteractive,
    (_e, raw) => {
      deps.overlay.setInteractive(parseOrThrow(booleanSchema, raw, 'flag'))
    },
    { overlayOnly: true }
  )
  handle(IPC.overlayDone, () => deps.overlay.done(), { overlayOnly: true })
  handle(IPC.overlayEngaged, () => deps.overlay.engaged(), { overlayOnly: true })

  handle(IPC.openFeedWindow, async () => {
    await deps.openFeedWindow()
  })
  handle(IPC.openSettingsWindow, async () => {
    await deps.openSettingsWindow()
  })

  return () => {
    for (const c of channels) ipcMain.removeHandler(c)
  }
}
