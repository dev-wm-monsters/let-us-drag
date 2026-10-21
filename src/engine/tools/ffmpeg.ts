// FFmpeg runner: binary resolution (PLAN §3 decision 8), probing and progress parsing.
// Always spawn(file, argsArray) with shell:false.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { EngineError, cancelledOrTimeout, errnoCode } from '../errors'
import type { ProgressFn } from '../progress'

export interface FfmpegLocateOptions {
  ffmpegPath?: string | undefined
  resourcesDir?: string | undefined
}

/**
 * Ordered candidates: options.ffmpegPath → env LUD_FFMPEG_PATH → resourcesDir/bin/ffmpeg[.exe]
 * → "ffmpeg" (resolved from PATH by the OS when spawning).
 */
export function ffmpegCandidates(
  opts: FfmpegLocateOptions,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string[] {
  const exe = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const out: string[] = []
  if (opts.ffmpegPath) out.push(opts.ffmpegPath)
  const fromEnv = env['LUD_FFMPEG_PATH']
  if (fromEnv) out.push(fromEnv)
  if (opts.resourcesDir) out.push(join(opts.resourcesDir, 'bin', exe))
  out.push(exe)
  return out
}

/** Pick the first existing explicit candidate, else the bare name (PATH lookup at spawn time). */
export function resolveFfmpeg(
  opts: FfmpegLocateOptions,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = existsSync
): string {
  const candidates = ffmpegCandidates(opts, env, platform)
  const bare = candidates[candidates.length - 1]!
  for (const c of candidates.slice(0, -1)) {
    if (exists(c)) return c
  }
  return bare
}

export interface MediaInfo {
  durationSec: number | undefined
  hasVideo: boolean
  hasAudio: boolean
  width: number | undefined
  height: number | undefined
  fps: number | undefined
}

function parseClock(h: string, m: string, s: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s)
}

/** Parse the stderr of `ffmpeg -hide_banner -i <input>` (no ffprobe is shipped). */
export function parseProbeOutput(stderr: string): MediaInfo {
  const info: MediaInfo = { durationSec: undefined, hasVideo: false, hasAudio: false, width: undefined, height: undefined, fps: undefined }
  const d = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr)
  if (d) info.durationSec = parseClock(d[1]!, d[2]!, d[3]!)
  for (const line of stderr.split(/\r?\n/)) {
    if (!/^\s*Stream #/.test(line)) continue
    if (/: Audio: /.test(line)) info.hasAudio = true
    if (/: Video: /.test(line) && !/\(attached pic\)/.test(line)) {
      if (!info.hasVideo) {
        const dims = /, (\d{1,5})x(\d{1,5})(?=[\s,[])/.exec(line)
        if (dims) {
          info.width = Number(dims[1])
          info.height = Number(dims[2])
        }
        const fps = /([\d.]+) fps/.exec(line)
        if (fps) info.fps = Number(fps[1])
      }
      info.hasVideo = true
    }
  }
  return info
}

/**
 * Line parser for `-progress pipe:1` output. Calls onProgress with 0..1 when the duration is
 * known, otherwise -1. Handles chunks split mid-line.
 */
export function createProgressParser(durationSec: number | undefined, onProgress: ProgressFn): (chunk: string) => void {
  let buf = ''
  return (chunk) => {
    buf += chunk
    const lines = buf.split(/\r?\n/)
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const key = line.slice(0, eq).trim()
      const value = line.slice(eq + 1).trim()
      if (key === 'out_time_us' || key === 'out_time_ms') {
        // Both keys are in microseconds (out_time_ms is a historical misnomer in FFmpeg).
        const us = Number(value)
        if (!Number.isFinite(us) || us < 0) continue
        if (durationSec && durationSec > 0) onProgress(Math.min(1, us / 1e6 / durationSec))
        else onProgress(-1)
      } else if (key === 'progress' && value === 'end') {
        onProgress(1)
      }
    }
  }
}

const STDERR_TAIL = 8 * 1024

export interface RunOptions {
  signal: AbortSignal
  /** Known input duration (seconds) to compute progress. */
  durationSec?: number | undefined
  onProgress?: ProgressFn | undefined
  /** Resolve whatever the exit code is (probing: `ffmpeg -i` always "fails"). */
  anyExitCode?: boolean
  /** Collect stdout as a Buffer instead of parsing progress from it. */
  captureStdout?: boolean
}

export interface RunResult {
  code: number
  stderr: string
  stdout?: Buffer
}

/** Spawn ffmpeg with an argument array. Kills the process on abort. */
export function spawnFfmpeg(ffmpeg: string, args: readonly string[], opts: RunOptions): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    if (opts.signal.aborted) {
      reject(cancelledOrTimeout(opts.signal))
      return
    }
    const child = spawn(ffmpeg, [...args], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    const outChunks: Buffer[] = []
    const parse = opts.onProgress && !opts.captureStdout ? createProgressParser(opts.durationSec, opts.onProgress) : undefined
    child.stdout.on('data', (chunk: Buffer) => {
      if (opts.captureStdout) outChunks.push(chunk)
      else parse?.(chunk.toString('utf8'))
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > STDERR_TAIL * 2) stderr = stderr.slice(-STDERR_TAIL)
    })
    let killTimer: NodeJS.Timeout | undefined
    const onAbort = (): void => {
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000)
      killTimer.unref()
    }
    opts.signal.addEventListener('abort', onAbort, { once: true })
    let settled = false
    child.on('error', (err) => {
      if (settled) return
      settled = true
      opts.signal.removeEventListener('abort', onAbort)
      if (errnoCode(err) === 'ENOENT') {
        reject(new EngineError('TOOL_MISSING', 'FFmpeg is missing, so I cannot convert audio or video. Reinstalling Let us drag! should fix it.', `${ffmpeg}: ${String(err)}`))
      } else {
        reject(new EngineError('TOOL_FAILED', undefined, String(err)))
      }
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      opts.signal.removeEventListener('abort', onAbort)
      if (killTimer) clearTimeout(killTimer)
      if (opts.signal.aborted) {
        reject(cancelledOrTimeout(opts.signal))
        return
      }
      const exit = code ?? -1
      const res: RunResult = { code: exit, stderr: stderr.slice(-STDERR_TAIL) }
      if (opts.captureStdout) res.stdout = Buffer.concat(outChunks)
      if (exit === 0 || opts.anyExitCode) resolve(res)
      else reject(new EngineError('TOOL_FAILED', undefined, `ffmpeg exited with ${exit}: ${res.stderr.trim().split(/\r?\n/).slice(-5).join(' | ')}`))
    })
  })
}

/** Probe an input with `ffmpeg -i` (it exits non-zero by design: "no output file"). */
export async function probeMedia(ffmpeg: string, input: string, signal: AbortSignal): Promise<MediaInfo> {
  const res = await spawnFfmpeg(ffmpeg, ['-hide_banner', '-nostdin', '-i', input], { signal, anyExitCode: true })
  const info = parseProbeOutput(res.stderr)
  if (!info.hasAudio && !info.hasVideo) {
    throw new EngineError('INPUT_INVALID', "I couldn't find any audio or video in this file. It may be damaged.", res.stderr.slice(-500))
  }
  return info
}

/** Common leading args for conversions: quiet, machine-readable progress on stdout. */
export function baseArgs(input: string): string[] {
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', '-i', input]
}

/** Run a conversion; `-y` is added only right before our own temp output path. */
export async function runConversion(
  ffmpeg: string,
  input: string,
  outputArgs: readonly string[],
  tempOutput: string,
  opts: { signal: AbortSignal; durationSec?: number | undefined; onProgress?: ProgressFn | undefined; extraInputs?: readonly string[] }
): Promise<void> {
  const extra = (opts.extraInputs ?? []).flatMap((p) => ['-i', p])
  await spawnFfmpeg(ffmpeg, [...baseArgs(input), ...extra, ...outputArgs, '-y', tempOutput], {
    signal: opts.signal,
    durationSec: opts.durationSec,
    onProgress: opts.onProgress
  })
}
