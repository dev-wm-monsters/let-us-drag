// Environment for the engine utilityProcess (Security F-16, TPM D18). Pure; no electron import.
//
// The engine honours developer overrides such as LUD_FFMPEG_PATH (which executable to spawn) and
// LUD_MODEL_PATH (an un-hashed model file). A shipped app must never let the environment choose
// those, so a packaged build forks the worker with an explicit environment that has every
// `LUD_*` key removed. utilityProcess.fork() uses `options.env` INSTEAD of process.env when it is
// given (Electron 45 `ForkOptions.env`, default `process.env`; verified with a probe: a key
// removed from the passed object is absent in the child).
//
// Unpackaged runs (development, E2E) keep the default (`undefined` → inherit process.env), so
// LUD_FFMPEG_PATH etc. keep working there.
//
// The prefix test ignores case: Windows environment variables are case-insensitive, so a key
// spelled `lud_ffmpeg_path` would still be found as `LUD_FFMPEG_PATH` in the child.

export const DEV_ONLY_ENV_PREFIX = 'LUD_'

export function isDevOnlyEnvKey(key: string): boolean {
  return key.slice(0, DEV_ONLY_ENV_PREFIX.length).toUpperCase() === DEV_ONLY_ENV_PREFIX
}

/**
 * The `env` to pass to utilityProcess.fork for the engine worker: `undefined` (inherit, the
 * default) when not packaged; otherwise a copy of `env` without any `LUD_*` key.
 */
export function engineWorkerEnv(env: Readonly<Record<string, string | undefined>>, isPackaged: boolean): Record<string, string> | undefined {
  if (!isPackaged) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || isDevOnlyEnvKey(key)) continue
    out[key] = value
  }
  return out
}
