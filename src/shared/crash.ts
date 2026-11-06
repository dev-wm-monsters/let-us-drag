// Crash reporting (TPM D28) constants shared by main, preload, renderers and the engine. Pure.
//
// Main decides whether crash reporting is available in this run (packaged build with a DSN, or the
// E2E / developer switches, see src/main/crash/config.ts). Only then does it start the renderers
// with CRASH_REPORTS_ARG (webPreferences.additionalArguments) and the engine utility process with
// the same argv flag. Renderers and the engine never talk to the network: their SDKs hand events
// to main over IPC / a MessagePort, and main scrubs, filters and sends them (or drops them when the
// user turned crash reports off).

/** Renderer / engine flag: "the main process may report crashes in this run". */
export const CRASH_REPORTS_ARG = '--lud-crash-reports'

/** Namespace of the Sentry SDK's renderer → main IPC channels (classic IPC only, no custom protocol). */
export const SENTRY_IPC_NAMESPACE = 'sentry-ipc'

/** "Report a problem" (Settings): a mailto link built in main; no logs are attached. */
export const REPORT_PROBLEM_EMAIL = 'support@wakeupmonster.com'
