// Video and audio conversions with FFmpeg. Argument builders are pure (unit tested); runners
// write into a temp output provided by the job.
import type { OptionId } from '../../shared/types'
import { EngineError } from '../errors'
import { subProgress, type ProgressFn } from '../progress'
import { probeMedia, runConversion, type MediaInfo } from './ffmpeg'

/** Keep dimensions even (required by yuv420p / H.264). */
const EVEN_SCALE = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'

export const GIF_MAX_FPS = 15
export const GIF_MAX_WIDTH = 480

export interface MediaTarget {
  /** Output file extension. */
  ext: string
  /** FFmpeg output args (after inputs, before -y <output>). */
  args: string[]
  /** Whether the input must contain an audio stream. */
  needsAudio: boolean
  /** Whether the output carries video (so a video stream is required). */
  needsVideo: boolean
}

const H264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-vf', EVEN_SCALE]

/** Map an option + input kind to output args. Returns undefined for unsupported combos. */
export function mediaTarget(optionId: OptionId, kind: 'video' | 'audio', info: Pick<MediaInfo, 'hasAudio'>): MediaTarget | undefined {
  const audioMap = info.hasAudio ? ['-map', '0:a:0'] : []
  if (kind === 'video') {
    switch (optionId) {
      case 'to-mp4':
        return {
          ext: 'mp4',
          args: ['-map', '0:v:0', ...audioMap, ...H264, '-crf', '23', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-f', 'mp4'],
          needsAudio: false,
          needsVideo: true
        }
      case 'to-mov':
        return {
          ext: 'mov',
          args: ['-map', '0:v:0', ...audioMap, ...H264, '-crf', '23', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-f', 'mov'],
          needsAudio: false,
          needsVideo: true
        }
      case 'to-webm':
        return {
          ext: 'webm',
          args: [
            '-map', '0:v:0', ...audioMap,
            '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1',
            '-crf', '32', '-b:v', '0', '-pix_fmt', 'yuv420p', '-vf', EVEN_SCALE,
            '-c:a', 'libopus', '-b:a', '128k', '-f', 'webm'
          ],
          needsAudio: false,
          needsVideo: true
        }
      case 'compress':
        return {
          ext: 'mp4',
          args: ['-map', '0:v:0', ...audioMap, ...H264, '-crf', '28', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4'],
          needsAudio: false,
          needsVideo: true
        }
      case 'to-mp3':
        return { ext: 'mp3', args: ['-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3'], needsAudio: true, needsVideo: false }
      case 'to-wav':
        return { ext: 'wav', args: ['-map', '0:a:0', '-vn', '-c:a', 'pcm_s16le', '-f', 'wav'], needsAudio: true, needsVideo: false }
      default:
        return undefined
    }
  }
  const a = (codec: string[], fmt: string, ext: string): MediaTarget => ({
    ext,
    args: ['-map', '0:a:0', '-vn', ...codec, '-f', fmt],
    needsAudio: true,
    needsVideo: false
  })
  switch (optionId) {
    case 'to-mp3':
      return a(['-c:a', 'libmp3lame', '-b:a', '192k'], 'mp3', 'mp3')
    case 'to-wav':
      return a(['-c:a', 'pcm_s16le'], 'wav', 'wav')
    case 'to-m4a':
      return a(['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'], 'ipod', 'm4a')
    case 'to-ogg':
      return a(['-c:a', 'libvorbis', '-q:a', '5'], 'ogg', 'ogg')
    case 'to-flac':
      return a(['-c:a', 'flac'], 'flac', 'flac')
    case 'compress':
      return a(['-c:a', 'libmp3lame', '-b:a', '128k'], 'mp3', 'mp3')
    default:
      return undefined
  }
}

export interface GifParams {
  /** Frame delay in centiseconds (GIF stores delays in 1/100 s). */
  delayCs: number
  /** Output width, or undefined when the source width is unknown. */
  width: number | undefined
}

/**
 * GIF frame rate and width: ≤ 15 fps, ≤ 480 px wide, never upscaled. The rate is chosen so the
 * frame delay is a whole number of centiseconds (e.g. 100/7 ≈ 14.3 fps), otherwise the GIF muxer
 * rounds the delay down and the animation plays too fast.
 */
export function gifParams(info: Pick<MediaInfo, 'fps' | 'width'>): GifParams {
  const fps = info.fps && info.fps > 0 ? Math.min(GIF_MAX_FPS, info.fps) : GIF_MAX_FPS
  const width = info.width && info.width > 0 ? Math.min(GIF_MAX_WIDTH, info.width) : undefined
  return { delayCs: Math.max(2, Math.ceil(100 / fps)), width }
}

/** Filter prefix shared by both GIF passes. */
export function gifFilter(p: GifParams): string {
  const w = p.width ?? `'min(${GIF_MAX_WIDTH},iw)'`
  return `fps=100/${p.delayCs},scale=${w}:-1:flags=lanczos`
}

export function noAudioError(kind: 'video' | 'audio'): EngineError {
  return new EngineError(
    'INPUT_INVALID',
    kind === 'video' ? "This video has no sound, so there's nothing to turn into audio." : "I couldn't find any sound in this file."
  )
}

export interface MediaJobIo {
  ffmpeg: string
  input: string
  /** Lower-case input extension (Mute keeps the container). */
  inputExt?: string
  signal: AbortSignal
  progress: ProgressFn
  /** Create a temp file next to the output with the given extension. */
  tempFile(ext: string): Promise<string>
}

export interface MediaResult {
  temp: string
  ext: string
  /** Optional stage text to show (e.g. "already 720p"). */
  note?: string
}

/** Convert one media file. Returns the temp path holding the result and its extension. */
export async function convertMedia(optionId: OptionId, kind: 'video' | 'audio', io: MediaJobIo): Promise<MediaResult> {
  io.progress(-1, 'Sniffing the file')
  const info = await probeMedia(io.ffmpeg, io.input, io.signal, kind)
  if (optionId === 'to-gif' && kind === 'video') return convertGif(info, io)
  if (optionId === 'to-720p' && kind === 'video') return convert720p(info, io)
  if (optionId === 'mute' && kind === 'video') return convertMute(info, io)
  const target = mediaTarget(optionId, kind, info)
  if (!target) throw new EngineError('UNSUPPORTED')
  if (target.needsAudio && !info.hasAudio) throw noAudioError(kind)
  if (target.needsVideo && !info.hasVideo) {
    throw new EngineError('INPUT_INVALID', "I couldn't find any picture in this video. It may be audio only or damaged.")
  }
  const temp = await io.tempFile(target.ext)
  await runConversion(io.ffmpeg, io.input, target.args, temp, {
    signal: io.signal,
    kind,
    durationSec: info.durationSec,
    onProgress: (p) => io.progress(p, 'Chewing')
  })
  return { temp, ext: target.ext }
}

async function convertGif(info: MediaInfo, io: MediaJobIo): Promise<MediaResult> {
  if (!info.hasVideo) throw new EngineError('INPUT_INVALID', "I couldn't find any picture in this video.")
  const params = gifParams(info)
  const filter = gifFilter(params)
  const palette = await io.tempFile('png')
  const pass1 = subProgress(io.progress, 0, 0.3)
  await runConversion(io.ffmpeg, io.input, ['-vf', `${filter},palettegen=stats_mode=diff`, '-frames:v', '1', '-update', '1', '-f', 'image2'], palette, {
    signal: io.signal,
    kind: 'video',
    durationSec: info.durationSec,
    onProgress: (p) => pass1(p, 'Picking colours')
  })
  const temp = await io.tempFile('gif')
  const pass2 = subProgress(io.progress, 0.3, 1)
  await runConversion(
    io.ffmpeg,
    io.input,
    ['-lavfi', `${filter}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, '-loop', '0', '-f', 'gif'],
    temp,
    {
      signal: io.signal,
      kind: 'video',
      durationSec: info.durationSec,
      onProgress: (p) => pass2(p, 'Drawing frames'),
      // Our own palette PNG: forced demuxer, so no image2 pattern expansion even if the folder has a "%".
      extraInputs: [{ path: palette, kind: 'image', format: 'png_pipe' }]
    }
  )
  return { temp, ext: 'gif' }
}

// --- 720p, Mute, GIF → MP4 (D30) --------------------------------------------------------------

export const HD_SHORT_SIDE = 720

/**
 * Shorter side 720 px, aspect kept, never upscaled (the min() inside the filter holds even when
 * the probe could not read the size; ffmpeg applies rotation metadata first, and the shorter side
 * does not depend on it), then even dimensions for yuv420p.
 */
export const SCALE_720P = `scale=w='if(gte(iw,ih),-2,min(iw,${HD_SHORT_SIDE}))':h='if(gte(iw,ih),min(ih,${HD_SHORT_SIDE}),-2)',${EVEN_SCALE}`

/** True when the video is already 720p or smaller (shorter side ≤ 720): 720p then only re-encodes. */
export function isAtMost720p(info: Pick<MediaInfo, 'width' | 'height'>): boolean {
  return info.width !== undefined && info.height !== undefined && Math.min(info.width, info.height) <= HD_SHORT_SIDE
}

export function hd720Args(info: Pick<MediaInfo, 'hasAudio'>): string[] {
  const audio = info.hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '160k'] : []
  return [
    '-map', '0:v:0', ...audio,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-vf', SCALE_720P,
    '-movflags', '+faststart', '-f', 'mp4'
  ]
}

function noPicture(): EngineError {
  return new EngineError('INPUT_INVALID', "I couldn't find any picture in this video. It may be audio only or damaged.")
}

async function convert720p(info: MediaInfo, io: MediaJobIo): Promise<MediaResult> {
  if (!info.hasVideo) throw noPicture()
  const temp = await io.tempFile('mp4')
  await runConversion(io.ffmpeg, io.input, hd720Args(info), temp, {
    signal: io.signal,
    kind: 'video',
    durationSec: info.durationSec,
    onProgress: (p) => io.progress(p, 'Shrinking')
  })
  // Never upscaled: a video that is already 720p or smaller keeps its size (re-encoded as H.264 MP4).
  return isAtMost720p(info) ? { temp, ext: 'mp4', note: 'Already 720p or smaller, kept the size' } : { temp, ext: 'mp4' }
}

/** Mute keeps the container and copies the picture stream untouched. */
const MUTE_FORMATS: Readonly<Record<string, string>> = { mp4: 'mp4', m4v: 'mp4', mov: 'mov', mkv: 'matroska', webm: 'webm', avi: 'avi' }

export function muteTarget(inputExt: string): { ext: string; args: string[] } {
  const known = MUTE_FORMATS[inputExt.toLowerCase()]
  const ext = known ? inputExt.toLowerCase() : 'mp4'
  const fmt = known ?? 'mp4'
  const faststart = fmt === 'mp4' || fmt === 'mov' ? ['-movflags', '+faststart'] : []
  return { ext, args: ['-map', '0:v:0', '-c:v', 'copy', '-an', '-sn', '-dn', ...faststart, '-f', fmt] }
}

async function convertMute(info: MediaInfo, io: MediaJobIo): Promise<MediaResult> {
  if (!info.hasVideo) throw noPicture()
  const target = muteTarget(io.inputExt ?? 'mp4')
  const temp = await io.tempFile(target.ext)
  await runConversion(io.ffmpeg, io.input, target.args, temp, {
    signal: io.signal,
    kind: 'video',
    durationSec: info.durationSec,
    onProgress: (p) => io.progress(p, 'Shushing')
  })
  return info.hasAudio ? { temp, ext: target.ext } : { temp, ext: target.ext, note: 'It had no sound anyway' }
}

/**
 * Animated GIF → MP4 (H.264, yuv420p, even dimensions, square pixels, faststart). Transparent
 * pixels become white (yuv420p has no alpha); the GIF's own frame timing is kept.
 */
export const GIF_TO_MP4_FILTER = `[0:v]format=rgba,split[a][b];[a]drawbox=c=white@1:t=fill[bg];[bg][b]overlay=format=auto,${EVEN_SCALE},setsar=1,format=yuv420p[v]`

export function gifToMp4Args(): string[] {
  return ['-filter_complex', GIF_TO_MP4_FILTER, '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-an', '-movflags', '+faststart', '-f', 'mp4']
}

/** `io.input` must already be sniffed as a GIF: the gif demuxer is forced, nothing else is allowed. */
export async function gifToMp4(io: MediaJobIo): Promise<MediaResult> {
  io.progress(-1, 'Sniffing the file')
  const info = await probeMedia(io.ffmpeg, io.input, io.signal, 'gif', 'gif')
  if (!info.hasVideo) throw new EngineError('INPUT_INVALID', "I couldn't read the frames of this GIF.")
  const temp = await io.tempFile('mp4')
  await runConversion(io.ffmpeg, io.input, gifToMp4Args(), temp, {
    signal: io.signal,
    kind: 'gif',
    format: 'gif',
    durationSec: info.durationSec,
    onProgress: (p) => io.progress(p, 'Rolling film')
  })
  return { temp, ext: 'mp4' }
}
