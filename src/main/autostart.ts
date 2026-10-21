// Launch at login.
// - macOS / Windows: app.setLoginItemSettings (done by the caller, app.ts, with loginItemSettings()).
// - Linux: an XDG autostart entry at $XDG_CONFIG_HOME/autostart/let-us-drag.desktop
//   (default ~/.config/autostart). Limitations: honoured by desktop environments that implement
//   the XDG Autostart spec (GNOME, KDE, Xfce, Cinnamon, MATE…), not by bare window managers.
//   For an AppImage the entry points at $APPIMAGE; if that file is moved, the entry goes stale
//   (toggling the setting off/on rewrites it). .deb installs point at the installed binary.

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, win32 } from 'node:path'

export const AUTOSTART_FILE_NAME = 'let-us-drag.desktop'

export function linuxAutostartPath(env: Readonly<Record<string, string | undefined>>, home: string = homedir()): string {
  const xdg = env['XDG_CONFIG_HOME']
  const base = xdg && isAbsolute(xdg) ? xdg : join(home, '.config')
  return join(base, 'autostart', AUTOSTART_FILE_NAME)
}

/**
 * Quote one argument for the Exec key (Desktop Entry spec, "The Exec key"): arguments containing
 * reserved characters are wrapped in double quotes, with `"`, `` ` ``, `$` and `\` backslash-escaped.
 * `%` is doubled because field codes start with it.
 */
export function quoteExecArg(arg: string): string {
  const escapedPercent = arg.replace(/%/g, '%%')
  if (!/[\s"'\\><~|&;$*?#()`]/.test(escapedPercent)) return escapedPercent
  return `"${escapedPercent.replace(/(["`$\\])/g, '\\$1')}"`
}

export function buildDesktopEntry(command: readonly string[]): string {
  if (command.length === 0) throw new Error('autostart: empty command')
  for (const part of command) {
    if (/[\r\n]/.test(part)) throw new Error('autostart: newline in command')
  }
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Let us drag!',
    'Comment=Drag a file, hold Shift, feed it to the Uncle.',
    `Exec=${command.map(quoteExecArg).join(' ')}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n')
}

/**
 * The command that starts this app.
 * appImage = $APPIMAGE when running from an AppImage; appPath is passed only in development
 * (electron binary + project directory).
 */
export function launchCommand(opts: { execPath: string; appImage?: string; isPackaged: boolean; appPath: string }): string[] {
  if (opts.appImage && isAbsolute(opts.appImage)) return [opts.appImage]
  if (opts.isPackaged) return [opts.execPath]
  return [opts.execPath, opts.appPath]
}

export async function setLinuxAutostart(enabled: boolean, file: string, command: readonly string[]): Promise<void> {
  if (!enabled) {
    await rm(file, { force: true })
    return
  }
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, buildDesktopEntry(command), { encoding: 'utf8', mode: 0o644 })
}

/**
 * Argument for app.setLoginItemSettings (macOS / Windows).
 * - Windows portable build: the portable .exe the user started (PORTABLE_EXECUTABLE_FILE), not
 *   the temporary folder it unpacked itself into (process.execPath).
 * - Windows, unpackaged (development): electron.exe plus the project directory; electron.exe
 *   alone would start Electron's default app at login.
 * - Otherwise Electron's defaults (process.execPath on Windows, the app bundle on macOS).
 */
export function loginItemSettings(opts: {
  platform: NodeJS.Platform
  enabled: boolean
  isPackaged: boolean
  execPath: string
  appPath: string
  portableExecutable?: string
}): { openAtLogin: boolean; path?: string; args?: string[] } {
  if (opts.platform !== 'win32') return { openAtLogin: opts.enabled }
  if (opts.portableExecutable && win32.isAbsolute(opts.portableExecutable)) return { openAtLogin: opts.enabled, path: opts.portableExecutable }
  if (!opts.isPackaged) return { openAtLogin: opts.enabled, path: opts.execPath, args: [opts.appPath] }
  return { openAtLogin: opts.enabled }
}
