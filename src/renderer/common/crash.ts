// Renderer crash reporting (TPM D28). Active only when the preload exposed the Sentry IPC bridge,
// i.e. main started this window with CRASH_REPORTS_ARG (src/preload/index.ts). The SDK sends events
// to main over that IPC bridge only (never the network, so the CSP stays `connect-src 'self'`);
// main scrubs, filters and sends them, or drops them when the user turned crash reports off.
//
// Captured: uncaught errors and unhandled promise rejections (React 19 reports uncaught render
// errors to window.onerror too). No breadcrumbs (DOM / console / fetch), no request data, no scope
// forwarding to main, no session tracking, no tracing, no replay.
import { dedupeIntegration, functionToStringIntegration, globalHandlersIntegration, init, linkedErrorsIntegration } from '@sentry/electron/renderer'
import { SENTRY_IPC_NAMESPACE } from '../../shared/crash'

function bridgeAvailable(): boolean {
  const bridges = (globalThis as { __SENTRY_IPC__?: Record<string, unknown> }).__SENTRY_IPC__
  return typeof bridges === 'object' && bridges !== null && typeof bridges[SENTRY_IPC_NAMESPACE] === 'object'
}

export function startRendererCrashReporting(): boolean {
  if (!bridgeAvailable()) return false
  init({
    ipcNamespace: SENTRY_IPC_NAMESPACE,
    defaultIntegrations: false,
    integrations: [globalHandlersIntegration(), linkedErrorsIntegration(), functionToStringIntegration(), dedupeIntegration()],
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, urlQueryParams: false, frameContextLines: 0 },
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend(event) {
      delete event.request
      return event
    }
  })
  return true
}

startRendererCrashReporting()
