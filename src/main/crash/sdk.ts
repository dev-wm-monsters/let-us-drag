// Sentry main-process SDK setup (TPM D28). Loaded lazily (dynamic import from ./reporting.ts) and
// only when crash reporting is possible in this run AND the user has `crashReports` on, so dev /
// E2E runs and opted-out users never even load the SDK.
//
// What it captures: main-process uncaught exceptions / unhandled rejections, renderer errors
// (forwarded by the renderer SDK over classic IPC, see src/renderer/common/crash.ts), engine
// utility-process errors (forwarded over a MessagePort, see src/engine/crash.ts), and native crashes
// of renderer, GPU and utility processes as a small "process gone" event (process type + reason:
// crashed / oom / abnormal exit). No Crashpad minidumps: they are raw memory that may hold file
// names and cannot be scrubbed (website promise), so they are never collected or uploaded.
//
// What it never does: release health / sessions, tracing, profiling, logs, metrics, screenshots,
// console or network breadcrumbs, request data, local variables, source context, IP inference.
// Every event is scrubbed (./scrub.ts) in beforeSend AND again in the transport, which also drops
// every envelope item that is not an event (the SDK forwards some renderer envelopes
// straight to the transport, bypassing beforeSend). The transport talks to the DSN's ingest origin
// only, through a dedicated in-memory session that cancels any other request.

import * as Sentry from '@sentry/electron/main'
import { app, session, type Session } from 'electron'
import { SENTRY_IPC_NAMESPACE } from '../../shared/crash'
import { hardenSession } from '../security'
import { CRASH_SESSION_PARTITION } from './config'
import { allowedEnvelopeItem, scrubBreadcrumb, scrubEvent, scrubValue, type BreadcrumbLike, type EventLike, type ScrubContext } from './scrub'

export interface SentryInitOptions {
  dsn: string
  /** The DSN's origin: the only host the crash session may reach. */
  origin: string
  environment: string
  release: string
  scrub: ScrubContext
  /** Live: the user's `crashReports` setting. Checked in beforeSend and again in the transport. */
  consent(): boolean
  tags: Record<string, string>
  os: { name: string; version: string }
  log(message: string): void
}

export interface SentryHandle {
  setTag(key: string, value: string): void
  /** Capture one test event (tray "Send test crash report", sentry-test.flag) and wait for it to be sent. */
  sendTestEvent(source: string): Promise<boolean>
  flush(timeoutMs: number): Promise<boolean>
}

type TransportFactory = NonNullable<Sentry.NodeOptions['transport']>
type TransportOptions = Parameters<TransportFactory>[0]
type Transport = ReturnType<TransportFactory>
type Envelope = Parameters<Transport['send']>[0]
type EnvelopeItem = Envelope[1][number]

/** Cancel every request of the crash session that is not for the ingest origin. */
function restrictCrashSession(ses: Session, origin: string, log: (message: string) => void): void {
  hardenSession(ses)
  ses.webRequest.onBeforeRequest((details, callback) => {
    let ok = false
    try {
      ok = new URL(details.url).origin === origin
    } catch {
      ok = false
    }
    if (!ok) log(`crash session: blocked request: ${details.url.slice(0, 120)}`)
    callback({ cancel: !ok })
  })
}

function makeTransport(opts: SentryInitOptions): TransportFactory {
  let ses: Session | null = null
  const crashSession = (): Session => {
    if (!ses) {
      ses = session.fromPartition(CRASH_SESSION_PARTITION, { cache: false })
      restrictCrashSession(ses, opts.origin, opts.log)
      // Same privacy rules as the licence session: generic UA, no Accept-Language, no cookies.
      ses.setUserAgent(`LetsDrag/${app.getVersion()}`, '')
    }
    return ses
  }
  return (options: TransportOptions): Transport => {
    const base = Sentry.createTransport(options, async (request) => {
      await app.whenReady()
      const res = await crashSession().fetch(options.url, {
        method: 'POST',
        body: request.body,
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
        credentials: 'omit'
      })
      return {
        statusCode: res.status,
        headers: { 'retry-after': res.headers.get('retry-after'), 'x-sentry-rate-limits': res.headers.get('x-sentry-rate-limits') }
      }
    })
    return {
      send(envelope: Envelope) {
        if (!opts.consent()) return Promise.resolve({})
        const [headers, items] = envelope
        const kept = (items as EnvelopeItem[])
          .filter((item) => allowedEnvelopeItem(item[0] as { type?: unknown; attachment_type?: unknown }))
          .map((item) => (item[0].type === 'event' ? ([item[0], scrubEvent(item[1] as EventLike, opts.scrub)] as unknown as EnvelopeItem) : item))
        // A session, a span, a minidump…: nothing worth sending.
        if (!kept.some((item) => item[0].type === 'event')) return Promise.resolve({})
        const cleanHeaders = scrubValue(headers, opts.scrub) as Envelope[0]
        return base.send([cleanHeaders, kept] as unknown as Envelope)
      },
      flush: (timeout?: number) => base.flush(timeout)
    }
  }
}

export function initSentry(opts: SentryInitOptions): SentryHandle {
  Sentry.init({
    dsn: opts.dsn,
    release: opts.release,
    environment: opts.environment,
    // Classic IPC only (our preload exposes the bridge to our own windows). No custom protocol:
    // with it, any page (e.g. the PDF helper windows rendering untrusted HTML) could post to main.
    ipcMode: Sentry.IPCMode.Classic,
    ipcNamespace: SENTRY_IPC_NAMESPACE,
    getSessions: () => [],
    defaultIntegrations: false,
    integrations: [
      Sentry.electronContextIntegration(),
      Sentry.electronBreadcrumbsIntegration({ autoUpdater: false, captureWindowTitles: false }),
      // Native crashes without minidumps: an event (type + reason) when a renderer, the GPU process or
      // the engine dies abnormally. 'killed' is left out: we kill the engine on purpose (cancel, watchdog).
      Sentry.childProcessIntegration({
        breadcrumbs: ['crashed', 'oom', 'abnormal-exit', 'launch-failed', 'integrity-failure', 'killed'],
        events: ['crashed', 'oom', 'abnormal-exit', 'launch-failed', 'integrity-failure']
      }),
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
      Sentry.eventFiltersIntegration(),
      Sentry.functionToStringIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
      // Stack frame paths of our code → app:///… (runs after the others).
      Sentry.normalizePathsIntegration()
    ],
    // Privacy (website promise). `sendDefaultPii` no longer exists in SDK v11 (@sentry/core 11):
    // `dataCollection` replaces it; everything is off, including IP inference (infer_ip: never).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
      frameContextLines: 0,
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false }
    },
    sendClientReports: false,
    maxBreadcrumbs: 30,
    initialScope: {
      tags: opts.tags,
      user: { ip_address: null },
      contexts: { os: { name: opts.os.name, version: opts.os.version } }
    },
    beforeSend(event, hint) {
      if (!opts.consent()) return null
      // No attachment ever travels with an event (no minidumps, no scope attachment from a renderer).
      if (hint.attachments) hint.attachments = []
      return scrubEvent(event as unknown as EventLike, opts.scrub) as unknown as typeof event
    },
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb as unknown as BreadcrumbLike, opts.scrub) as unknown as typeof crumb | null,
    transport: makeTransport(opts)
  })

  return {
    setTag: (key, value) => Sentry.setTag(key, value),
    async sendTestEvent(source) {
      Sentry.captureException(new Error(`Let's Drag! test crash report (${source})`), { level: 'error' })
      return Sentry.flush(5_000)
    },
    flush: (timeoutMs) => Sentry.flush(timeoutMs)
  }
}
