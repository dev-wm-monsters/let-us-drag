// All ipcMain.handle handlers (src/shared/api.ts). Every payload is validated with zod (strict
// schemas, SEC-13), and every call must come from the main frame of one of our own windows that
// still shows the page main loaded into it, and that page must be allowed on the channel
// (SEC-11/12, ipc-policy.ts).

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
import { isTrustedSender } from './ipc-policy'
import type { JobRegistry } from './job-registry'
import type { RendererPage, RuntimeLayout } from './paths'

export interface IpcDeps {
  layout: RuntimeLayout
  /** The page main loaded into this webContents (overlay, feed, settings), or null if not ours. */
  pageOfWebContents(id: number): RendererPage | null
  getSettings(): Settings
  updateSettings(patch: unknown): Promise<Settings>
  startJob(req: JobRequest, from: { page: RendererPage; webContentsId: number }): void
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

  const isTrusted = (channel: string, event: IpcMainInvokeEvent): boolean => {
    const frame = event.senderFrame
    return isTrustedSender(
      channel,
      {
        registeredPage: deps.pageOfWebContents(event.sender.id),
        isMainFrame: frame !== null && frame === event.sender.mainFrame,
        frameUrl: frame?.url ?? ''
      },
      deps.layout
    )
  }

  const handle = (channel: string, fn: Handler): void => {
    channels.push(channel)
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (!isTrusted(channel, event)) throw new UntrustedSenderError()
      // Every channel takes at most one argument; extra arguments are a malformed request.
      if (args.length > 1) throw new IpcInputError('Invalid request.')
      try {
        return await fn(event, args[0])
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
    const page = deps.pageOfWebContents(e.sender.id)
    if (!page) throw new UntrustedSenderError()
    deps.startJob(req, { page, webContentsId: e.sender.id })
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

  handle(IPC.overlayInteractive, (_e, raw) => {
    deps.overlay.setInteractive(parseOrThrow(booleanSchema, raw, 'flag'))
  })
  handle(IPC.overlayDone, () => deps.overlay.done())
  handle(IPC.overlayEngaged, () => deps.overlay.engaged())

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
