// Engine (utility process) crash reporting (TPM D28). Only when main started us with
// CRASH_REPORTS_ARG, i.e. main's crash reporter runs and holds the other end: the SDK hands every
// event to main over a MessagePort (it never uses the network), and main scrubs, filters and sends
// it, or drops it when the user turned crash reports off. Native crashes of this process are
// Crashpad minidumps, handled entirely by main.
//
// Captured: uncaught exceptions and unhandled rejections. No breadcrumbs (console output and
// ffmpeg command lines name the user's files), no local variables, no source context.

import { CRASH_REPORTS_ARG } from '../shared/crash'

export async function startEngineCrashReporting(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): Promise<boolean> {
  if (!argv.includes(CRASH_REPORTS_ARG)) return false
  const Sentry = await import('@sentry/electron/utility')
  Sentry.init({
    defaultIntegrations: false,
    integrations: [
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
      Sentry.functionToStringIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration()
    ],
    dataCollection: { userInfo: false, stackFrameVariables: false, frameContextLines: 0 },
    sendClientReports: false,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null
  })
  // E2E only: the env of a packaged build never has LUD_* keys (worker-env.ts, D18), and main
  // passes CRASH_REPORTS_ARG to an unpackaged engine only with the E2E mock or LUD_SENTRY_DEV=1.
  const induced = env['LUD_E2E_ENGINE_ERROR']
  if (induced) setTimeout(() => void Promise.reject(new Error(induced)), 0)
  return true
}
