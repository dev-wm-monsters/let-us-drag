import { describe, expect, it } from 'vitest'
import { type AudioContextLike, createSoundPlayer, type SoundName } from './sounds'

/** A tiny fake AudioContext that records created nodes. */
function fakeContext() {
  const created: string[] = []
  const param = () => ({
    value: 0,
    setValueAtTime: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined
  })
  const node = (kind: string, extra: object = {}) => {
    created.push(kind)
    return { connect: () => undefined, start: () => undefined, stop: () => undefined, ...extra }
  }
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    destination: {},
    state: 'running',
    resume: async () => undefined,
    createOscillator: () => node('osc', { type: 'sine', frequency: param() }),
    createGain: () => node('gain', { gain: param() }),
    createBiquadFilter: () => node('filter', { type: 'lowpass', frequency: param(), Q: param() }),
    createBuffer: (_c: number, len: number) => {
      created.push('buffer')
      const data = new Float32Array(len)
      return { getChannelData: () => data }
    },
    createBufferSource: () => node('src', { buffer: null })
  }
  return { ctx: ctx as unknown as AudioContextLike, created }
}

describe('sound player', () => {
  it('never creates an AudioContext while sounds are off', () => {
    let calls = 0
    const p = createSoundPlayer({
      enabled: false,
      factory: () => {
        calls++
        return fakeContext().ctx
      }
    })
    p.play('gulp')
    expect(calls).toBe(0)
  })

  it('plays every recipe without throwing and creates nodes', () => {
    const f = fakeContext()
    const p = createSoundPlayer({ enabled: true, factory: () => f.ctx })
    for (const s of ['popIn', 'gulp', 'crunch', 'whoosh', 'cough', 'burp'] as SoundName[]) p.play(s)
    expect(f.created.filter((k) => k === 'buffer')).toHaveLength(1) // noise buffer is cached
    expect(f.created.length).toBeGreaterThan(10)
  })

  it('degrades silently when WebAudio is unavailable', () => {
    const p = createSoundPlayer({ enabled: true, factory: () => null })
    expect(() => p.play('popIn')).not.toThrow()
    p.setEnabled(false)
    expect(p.enabled).toBe(false)
  })
})
