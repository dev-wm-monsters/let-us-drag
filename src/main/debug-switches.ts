// TPM D22 / Security F-23 (B-058): a packaged build refuses Chromium's remote-debugging switches.
// Pure; no electron import (index.ts passes app.commandLine.hasSwitch and process.argv).
//
// With `--remote-debugging-port` (or `-pipe`) any local process could attach over CDP to our pages
// and call every window.lud method. No Electron fuse covers it, so the packaged app quits at
// startup, before it creates a window. The Node inspector switches are already disabled by the
// EnableNodeCliInspectArguments fuse; they are listed too (defence in depth).
//
// Verified on Electron 45 (Linux): app.commandLine.hasSwitch() sees `--name`, `--name=value` and
// the single-dash `-name=value` spelling, case-sensitively, and stops at a `--` argument, like
// Chromium itself. Windows Chromium also accepts `/name` and lower-cases switch names, so the
// argv check below accepts every prefix and ignores case (it may refuse more than Chromium
// honours, never less).

/** Switch names (without dashes) a packaged build refuses. */
export const FORBIDDEN_DEBUG_SWITCHES: readonly string[] = [
  'remote-debugging-port',
  'remote-debugging-pipe',
  'remote-debugging-address',
  'remote-debugging-io-pipes',
  'inspect',
  'inspect-brk',
  'inspect-port',
  'inspect-publish-uid',
  'js-flags'
]

/** Switch name of one argv entry (`--a=b`, `-a`, `/a` on Windows), lower-cased, or null. */
export function switchNameOf(arg: string, platform: NodeJS.Platform): string | null {
  let rest: string
  if (arg.startsWith('--')) rest = arg.slice(2)
  else if (arg.startsWith('-')) rest = arg.slice(1)
  else if (platform === 'win32' && arg.startsWith('/')) rest = arg.slice(1)
  else return null
  const eq = rest.indexOf('=')
  const name = (eq === -1 ? rest : rest.slice(0, eq)).toLowerCase()
  return name === '' ? null : name
}

/**
 * The first forbidden debug switch present, or null. `hasSwitch` is app.commandLine.hasSwitch
 * (what Chromium parsed); `argv` is process.argv (every spelling, including after `--`).
 */
export function forbiddenDebugSwitch(
  argv: readonly string[],
  hasSwitch: (name: string) => boolean,
  platform: NodeJS.Platform
): string | null {
  for (const name of FORBIDDEN_DEBUG_SWITCHES) if (hasSwitch(name)) return name
  for (const arg of argv) {
    const name = switchNameOf(arg, platform)
    if (name !== null && FORBIDDEN_DEBUG_SWITCHES.includes(name)) return name
  }
  return null
}
