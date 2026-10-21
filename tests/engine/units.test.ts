// Small pure units: progress throttling, ffmpeg parsing/resolution/args, ICO, errors.
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { EngineError, FRIENDLY_MESSAGES, toJobError } from '../../src/engine/errors'
import { createThrottledProgress, normalizeProgress, subProgress } from '../../src/engine/progress'
import { createProgressParser, ffmpegCandidates, parseProbeOutput, resolveFfmpeg } from '../../src/engine/tools/ffmpeg'
import { encodeIco, largestIcoEntry, parseIco } from '../../src/engine/tools/ico'
import { gifFilter, gifParams, mediaTarget } from '../../src/engine/tools/media'
import { compressTargetExt, pageSizeForImage } from '../../src/engine/tools/image'
import { pageFileName } from '../../src/engine/jobs'
import type { JobErrorCode } from '../../src/shared/types'

describe('progress', () => {
  it('normalises', () => {
    expect(normalizeProgress(0.5)).toBe(0.5)
    expect(normalizeProgress(3)).toBe(1)
    expect(normalizeProgress(-1)).toBe(-1)
    expect(normalizeProgress(NaN)).toBe(-1)
  })

  it('throttles to one event per interval, but always passes stage changes', () => {
    let t = 0
    const seen: [number, string | undefined][] = []
    const p = createThrottledProgress((v, s) => seen.push([v, s]), 100, () => t)
    p(0, 'a')
    p(0.1)
    p(0.2)
    t = 50
    p(0.3)
    p(0.3, 'b')
    t = 200
    p(0.4)
    p(0.35) // never goes backwards
    t = 400
    p(0.2)
    expect(seen).toEqual([
      [0, 'a'],
      [0.3, 'b'],
      [0.4, 'b']
    ])
  })

  it('emits at most ~10 events per second under a flood', () => {
    let t = 0
    let count = 0
    const p = createThrottledProgress(() => count++, 100, () => t)
    for (let i = 0; i < 10_000; i++) {
      t = i // 10 s of 1 ms ticks
      p(i / 10_000)
    }
    expect(count).toBeLessThanOrEqual(101)
  })

  it('maps sub-progress', () => {
    const seen: number[] = []
    const sub = subProgress((v) => seen.push(v), 0.5, 1)
    sub(0)
    sub(0.5)
    sub(-1)
    expect(seen).toEqual([0.5, 0.75, -1])
  })
})

describe('ffmpeg', () => {
  const STDERR = `Input #0, matroska,webm, from 'clip.mkv':
  Duration: 00:01:02.50, start: 0.000000, bitrate: 500 kb/s
  Stream #0:0: Video: h264 (High 4:4:4), yuv444p(progressive), 161x121 [SAR 1:1 DAR 161:121], 25 fps, 25 tbr, 1k tbn
  Stream #0:1: Audio: vorbis, 44100 Hz, mono, fltp
  Stream #0:2: Video: mjpeg, yuvj420p, 300x300, 90k tbr (attached pic)
At least one output file must be specified`

  it('parses probe output', () => {
    expect(parseProbeOutput(STDERR)).toEqual({ durationSec: 62.5, hasVideo: true, hasAudio: true, width: 161, height: 121, fps: 25 })
  })

  it('ignores attached pictures (cover art) as video', () => {
    const p = parseProbeOutput(`  Duration: 00:00:03.00, start: 0\n  Stream #0:0: Audio: mp3, 44100 Hz\n  Stream #0:1: Video: png, rgb24, 500x500, 90k tbn (attached pic)`)
    expect(p.hasVideo).toBe(false)
    expect(p.hasAudio).toBe(true)
  })

  it('parses -progress output across chunk boundaries', () => {
    const seen: number[] = []
    const parse = createProgressParser(10, (p) => seen.push(p))
    parse('frame=1\nout_time_us=2500')
    parse('000\nprogress=continue\nout_time_ms=5000000\n')
    parse('progress=end\n')
    expect(seen).toEqual([0.25, 0.5, 1])
  })

  it('reports unknown progress when the duration is unknown', () => {
    const seen: number[] = []
    createProgressParser(undefined, (p) => seen.push(p))('out_time_us=1000\n')
    expect(seen).toEqual([-1])
  })

  it('resolves the binary in PLAN order', () => {
    const res = join('/opt', 'app', 'resources')
    expect(ffmpegCandidates({ ffmpegPath: '/x/ff', resourcesDir: res }, { LUD_FFMPEG_PATH: '/env/ff' }, 'linux')).toEqual([
      '/x/ff',
      '/env/ff',
      join(res, 'bin', 'ffmpeg'),
      'ffmpeg'
    ])
    expect(ffmpegCandidates({ resourcesDir: res }, {}, 'win32')).toEqual([join(res, 'bin', 'ffmpeg.exe'), 'ffmpeg.exe'])
    const exists = (p: string): boolean => p === join(res, 'bin', 'ffmpeg')
    expect(resolveFfmpeg({ ffmpegPath: '/missing', resourcesDir: res }, { LUD_FFMPEG_PATH: '/missing2' }, 'linux', exists)).toBe(join(res, 'bin', 'ffmpeg'))
    expect(resolveFfmpeg({}, {}, 'linux', () => false)).toBe('ffmpeg')
  })

  it('builds the agreed encoder arguments', () => {
    const mp4 = mediaTarget('to-mp4', 'video', { hasAudio: true })!
    expect(mp4.args).toEqual(expect.arrayContaining(['libx264', 'yuv420p', '+faststart', 'aac']))
    expect(mp4.args.join(' ')).toContain('scale=trunc(iw/2)*2:trunc(ih/2)*2')
    const webm = mediaTarget('to-webm', 'video', { hasAudio: true })!.args.join(' ')
    expect(webm).toContain('-c:v libvpx-vp9 -deadline realtime -cpu-used 8 -row-mt 1')
    expect(webm).toContain('-c:a libopus')
    expect(mediaTarget('compress', 'video', { hasAudio: true })!.args.join(' ')).toMatch(/-crf 28.*-b:a 128k/)
    expect(mediaTarget('to-mp4', 'video', { hasAudio: false })!.args).not.toContain('0:a:0')
    expect(mediaTarget('to-mp3', 'audio', { hasAudio: true })!.args.join(' ')).toContain('libmp3lame -b:a 192k')
    expect(mediaTarget('to-ogg', 'audio', { hasAudio: true })!.args.join(' ')).toContain('libvorbis -q:a 5')
    expect(mediaTarget('compress', 'audio', { hasAudio: true })!.args.join(' ')).toContain('-b:a 128k')
    expect(mediaTarget('to-flac', 'video', { hasAudio: true })).toBeUndefined()
  })

  it('GIF parameters: ≤ 15 fps with whole-centisecond delays, ≤ 480 px, never upscaled', () => {
    expect(gifParams({ fps: 30, width: 1920 })).toEqual({ delayCs: 7, width: 480 })
    expect(gifParams({ fps: 10, width: 320 })).toEqual({ delayCs: 10, width: 320 })
    expect(gifParams({ fps: undefined, width: undefined })).toEqual({ delayCs: 7, width: undefined })
    expect(gifFilter({ delayCs: 7, width: 480 })).toBe('fps=100/7,scale=480:-1:flags=lanczos')
  })
})

describe('ICO encoder', () => {
  it('writes a header that parses back', () => {
    const png = (n: number): Uint8Array => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n])
    const buf = encodeIco([
      { size: 16, png: png(1) },
      { size: 256, png: png(2) }
    ])
    expect(buf.readUInt16LE(0)).toBe(0)
    expect(buf.readUInt16LE(2)).toBe(1)
    expect(buf.readUInt16LE(4)).toBe(2)
    expect(buf[6]).toBe(16)
    expect(buf[6 + 16]).toBe(0) // 256 is stored as 0
    const entries = parseIco(buf)
    expect(entries).toEqual([
      { width: 16, height: 16, bitCount: 32, size: 9, offset: 38, isPng: true },
      { width: 256, height: 256, bitCount: 32, size: 9, offset: 47, isPng: true }
    ])
    expect(largestIcoEntry(entries)!.width).toBe(256)
  })

  it('rejects junk and out-of-range sizes', () => {
    expect(() => parseIco(Buffer.from('nope nope nope'))).toThrow()
    expect(() => encodeIco([{ size: 300, png: new Uint8Array(1) }])).toThrow()
    expect(() => encodeIco([])).toThrow()
  })
})

describe('image helpers', () => {
  it('compress keeps the format where it can', () => {
    expect(compressTargetExt('JPEG')).toBe('jpeg')
    expect(compressTargetExt('png')).toBe('png')
    expect(compressTargetExt('heic')).toBe('jpg')
    expect(compressTargetExt('bmp')).toBe('png')
  })

  it('PDF page size: 96 dpi, capped at 14400 pt', () => {
    expect(pageSizeForImage(96, 48)).toEqual([72, 36])
    const [w, h] = pageSizeForImage(40_000, 20_000)
    expect(w).toBe(14_400)
    expect(h).toBe(7_200)
  })

  it('page file names are zero-padded', () => {
    expect(pageFileName(3, 9, 'png')).toBe('page-03.png')
    expect(pageFileName(7, 120, 'jpg')).toBe('page-007.jpg')
  })
})

describe('errors', () => {
  it('has a friendly message for every code', () => {
    const codes: JobErrorCode[] = ['UNSUPPORTED', 'INPUT_NOT_FOUND', 'INPUT_INVALID', 'OUTPUT_NOT_WRITABLE', 'TOOL_MISSING', 'TOOL_FAILED', 'MODEL_DOWNLOAD_FAILED', 'CANCELLED', 'INTERNAL']
    for (const c of codes) {
      expect(FRIENDLY_MESSAGES[c].length).toBeGreaterThan(5)
      expect(toJobError(new EngineError(c))).toEqual({ code: c, message: FRIENDLY_MESSAGES[c] })
    }
  })

  it('maps raw errors without leaking stack traces into the message', () => {
    const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    expect(toJobError(enoent)).toMatchObject({ code: 'INPUT_NOT_FOUND', message: FRIENDLY_MESSAGES.INPUT_NOT_FOUND })
    expect(toJobError(Object.assign(new Error('x'), { code: 'EACCES' })).code).toBe('OUTPUT_NOT_WRITABLE')
    expect(toJobError(Object.assign(new Error('x'), { name: 'AbortError' })).code).toBe('CANCELLED')
    const internal = toJobError(new TypeError('secret internals'))
    expect(internal.code).toBe('INTERNAL')
    expect(internal.message).toBe(FRIENDLY_MESSAGES.INTERNAL)
    expect(internal.detail).toContain('secret internals')
  })
})
