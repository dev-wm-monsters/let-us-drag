// Integration: video + audio options with real FFmpeg (LUD_FFMPEG_PATH or PATH).
// Outputs are validated by magic bytes, a full decode (`ffmpeg -v error -f null`), codec names
// and duration.
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseProbeOutput } from '../../src/engine/tools/ffmpeg'
import { MAGIC, audioFile, ffmpegDecode, ffmpegInfo, makeTempDir, startsWith, videoFile } from '../helpers/fixtures'
import { convertOk, runOption } from '../helpers/engine'

let dir = ''
let cleanup: () => Promise<void> = async () => undefined
let video = ''
let silentVideo = ''

beforeAll(async () => {
  ;({ dir, cleanup } = await makeTempDir('lud-media-'))
  video = await videoFile(join(dir, 'clip.mkv'), { size: '161x121' }) // odd size: outputs must be even
  silentVideo = await videoFile(join(dir, 'silent.mp4'), { audio: false })
})
afterAll(() => cleanup())

async function expectMedia(out: string, codecs: { video?: string; audio?: string }, seconds = 2): Promise<string> {
  expect(await ffmpegDecode(out)).toBe('')
  const info = await ffmpegInfo(out)
  const parsed = parseProbeOutput(info)
  expect(parsed.durationSec).toBeGreaterThan(seconds - 0.3)
  expect(parsed.durationSec).toBeLessThan(seconds + 0.5)
  if (codecs.video) expect(info).toMatch(new RegExp(`Video: ${codecs.video}`))
  if (codecs.audio) expect(info).toMatch(new RegExp(`Audio: ${codecs.audio}`))
  if (!codecs.video) expect(parsed.hasVideo).toBe(false)
  return info
}

describe('video', () => {
  it('MP4: H.264 + AAC, yuv420p, even dimensions, faststart', async () => {
    const [out] = await convertOk('to-mp4', [video])
    expect(basename(out!)).toBe('clip.mp4')
    const info = await expectMedia(out!, { video: 'h264', audio: 'aac' })
    expect(info).toMatch(/yuv420p/)
    const p = parseProbeOutput(info)
    expect([p.width, p.height]).toEqual([160, 120])
    // +faststart: the moov atom comes before mdat
    const buf = await readFile(out!)
    expect(buf.indexOf('moov')).toBeLessThan(buf.indexOf('mdat'))
  })

  it('MOV', async () => {
    const [out] = await convertOk('to-mov', [video])
    expect(basename(out!)).toBe('clip.mov')
    await expectMedia(out!, { video: 'h264', audio: 'aac' })
  })

  it('WEBM: VP9 + Opus', async () => {
    const [out] = await convertOk('to-webm', [video])
    expect(startsWith(await readFile(out!), [0x1a, 0x45, 0xdf, 0xa3])).toBe(true)
    await expectMedia(out!, { video: 'vp9', audio: 'opus' })
  })

  it('GIF: palette, ≤ 15 fps, ≤ 480 px', async () => {
    const big = await videoFile(join(dir, 'wide.mp4'), { size: '640x360' })
    const [out] = await convertOk('to-gif', [big])
    expect(basename(out!)).toBe('wide.gif')
    expect(startsWith(await readFile(out!), MAGIC.gif)).toBe(true)
    const info = await ffmpegInfo(out!)
    const p = parseProbeOutput(info)
    expect(p.width).toBe(480)
    expect(p.height).toBe(270)
    expect(p.fps).toBeLessThanOrEqual(15)
    expect(await ffmpegDecode(out!)).toBe('')
    // the palette temp file was cleaned up
    expect((await readdir(dir)).filter((f) => f.startsWith('.lud-'))).toEqual([])
  })

  it('MP3 and WAV audio extraction', async () => {
    const [mp3] = await convertOk('to-mp3', [video])
    expect(basename(mp3!)).toBe('clip.mp3')
    await expectMedia(mp3!, { audio: 'mp3' })
    const [wav] = await convertOk('to-wav', [video])
    expect(startsWith(await readFile(wav!), MAGIC.wav)).toBe(true)
    await expectMedia(wav!, { audio: 'pcm_s16le' })
  })

  it('audio extraction from a silent video → INPUT_INVALID with a friendly message', async () => {
    const res = await runOption('to-mp3', [silentVideo])
    expect(res.error?.code).toBe('INPUT_INVALID')
    expect(res.error?.message).toMatch(/no sound/i)
  })

  it('silent video → MP4 still works (no audio map)', async () => {
    const src = await videoFile(join(dir, 'mute.webm'), { audio: false })
    const [out] = await convertOk('to-mp4', [src])
    await expectMedia(out!, { video: 'h264' })
  })

  it('Compress: H.264 CRF 28 → "-compressed.mp4", smaller than a high-bitrate source', async () => {
    const src = await videoFile(join(dir, 'raw.avi'), { size: '320x240' })
    const [out] = await convertOk('compress', [src])
    expect(basename(out!)).toBe('raw-compressed.mp4')
    await expectMedia(out!, { video: 'h264', audio: 'aac' })
    expect((await stat(out!)).size).toBeLessThan((await stat(src)).size)
  })

  it('reports progress between 0 and 1', async () => {
    const res = await runOption('to-webm', [video])
    const ps = res.events.flatMap((e) => (e.type === 'progress' ? [e.progress] : []))
    expect(ps.length).toBeGreaterThan(0)
    expect(ps.every((p) => p === -1 || (p >= 0 && p <= 1))).toBe(true)
  })

  it('a file that is not media → INPUT_INVALID', async () => {
    const { writeFile } = await import('node:fs/promises')
    const fake = join(dir, 'fake.mp4')
    await writeFile(fake, 'hello, I am not a video')
    const res = await runOption('to-mov', [fake])
    expect(res.error?.code).toBe('INPUT_INVALID')
  })
})

describe('audio', () => {
  let wav = ''
  beforeAll(async () => {
    wav = await audioFile(join(dir, 'tone.wav'))
  })

  it.each([
    ['to-mp3', 'tone.mp3', 'mp3'],
    ['to-m4a', 'tone.m4a', 'aac'],
    ['to-ogg', 'tone.ogg', 'vorbis'],
    ['to-flac', 'tone.flac', 'flac']
  ] as const)('%s', async (opt, name, codec) => {
    const [out] = await convertOk(opt, [wav])
    expect(basename(out!)).toBe(name)
    await expectMedia(out!, { audio: codec })
  })

  it('to-wav from mp3/opus/aac/oga inputs', async () => {
    for (const n of ['in.mp3', 'in.opus', 'in.aac', 'in.oga']) {
      const src = await audioFile(join(dir, n))
      const [out] = await convertOk('to-wav', [src])
      await expectMedia(out!, { audio: 'pcm_s16le' }, 2)
    }
  })

  it('Compress → MP3 128k "-compressed.mp3"', async () => {
    const [out] = await convertOk('compress', [wav])
    expect(basename(out!)).toBe('tone-compressed.mp3')
    const info = await expectMedia(out!, { audio: 'mp3' })
    expect(info).toMatch(/128 kb\/s/)
    expect((await stat(out!)).size).toBeLessThan((await stat(wav)).size)
  })

  it('cancellation kills ffmpeg and leaves no partial output', async () => {
    const long = await audioFile(join(dir, 'long.wav'), 120)
    const ac = new AbortController()
    let sawProgress = false
    const res = await runOption('to-flac', [long], {
      signal: ac.signal,
      onEvent: (e) => {
        if (e.type === 'progress' && !sawProgress) {
          sawProgress = true
          setTimeout(() => ac.abort(), 50)
        }
      }
    })
    expect(res.error?.code).toBe('CANCELLED')
    const left = await readdir(dir)
    expect(left).not.toContain('long.flac')
    expect(left.filter((f) => f.startsWith('.lud-'))).toEqual([])
  })
})
