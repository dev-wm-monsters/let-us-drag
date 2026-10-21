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
  signal: AbortSignal
  progress: ProgressFn
  /** Create a temp file next to the output with the given extension. */
  tempFile(ext: string): Promise<string>
}

/** Convert one media file. Returns the temp path holding the result and its extension. */
export async function convertMedia(optionId: OptionId, kind: 'video' | 'audio', io: MediaJobIo): Promise<{ temp: string; ext: string }> {
  io.progress(-1, 'Sniffing the file')
  const info = await probeMedia(io.ffmpeg, io.input, io.signal)
  if (optionId === 'to-gif' && kind === 'video') return convertGif(info, io)
  const target = mediaTarget(optionId, kind, info)
  if (!target) throw new EngineError('UNSUPPORTED')
  if (target.needsAudio && !info.hasAudio) throw noAudioError(kind)
  if (target.needsVideo && !info.hasVideo) {
    throw new EngineError('INPUT_INVALID', "I couldn't find any picture in this video. It may be audio only or damaged.")
  }
  const temp = await io.tempFile(target.ext)
  await runConversion(io.ffmpeg, io.input, target.args, temp, {
    signal: io.signal,
    durationSec: info.durationSec,
    onProgress: (p) => io.progress(p, 'Chewing')
  })
  return { temp, ext: target.ext }
}

async function convertGif(info: MediaInfo, io: MediaJobIo): Promise<{ temp: string; ext: string }> {
  if (!info.hasVideo) throw new EngineError('INPUT_INVALID', "I couldn't find any picture in this video.")
  const params = gifParams(info)
  const filter = gifFilter(params)
  const palette = await io.tempFile('png')
  const pass1 = subProgress(io.progress, 0, 0.3)
  await runConversion(io.ffmpeg, io.input, ['-vf', `${filter},palettegen=stats_mode=diff`, '-frames:v', '1', '-update', '1', '-f', 'image2'], palette, {
    signal: io.signal,
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
    { signal: io.signal, durationSec: info.durationSec, onProgress: (p) => pass2(p, 'Drawing frames'), extraInputs: [palette] }
  )
  return { temp, ext: 'gif' }
}
