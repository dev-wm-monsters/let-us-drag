// Procedurally synthesised sound effects (WebAudio, no audio files).
// The AudioContext is created lazily on the first sound, so nothing happens when sounds are off.
import { mulberry32 } from './prng'

export type SoundName = 'popIn' | 'gulp' | 'crunch' | 'whoosh' | 'cough' | 'burp'

/** Minimal structural type so tests can inject a fake context. */
export type AudioContextLike = Pick<
  AudioContext,
  'currentTime' | 'sampleRate' | 'destination' | 'state' | 'resume' | 'createOscillator' | 'createGain' | 'createBiquadFilter' | 'createBuffer' | 'createBufferSource'
>

export interface SoundPlayer {
  play(name: SoundName): void
  setEnabled(on: boolean): void
  readonly enabled: boolean
}

export function createSoundPlayer(opts: { enabled: boolean; factory?: () => AudioContextLike | null }): SoundPlayer {
  let enabled = opts.enabled
  let ctx: AudioContextLike | null = null
  let noise: AudioBuffer | null = null
  let failed = false
  const factory =
    opts.factory ??
    (() => {
      const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
      return Ctor ? new Ctor() : null
    })

  const getCtx = (): AudioContextLike | null => {
    if (failed) return null
    if (!ctx) {
      try {
        ctx = factory()
      } catch {
        ctx = null
      }
      if (!ctx) {
        failed = true
        return null
      }
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    return ctx
  }

  const getNoise = (c: AudioContextLike): AudioBuffer => {
    if (noise) return noise
    const len = Math.floor(c.sampleRate * 1)
    noise = c.createBuffer(1, len, c.sampleRate)
    const data = noise.getChannelData(0)
    const rng = mulberry32(1234)
    for (let i = 0; i < len; i++) data[i] = rng() * 2 - 1
    return noise
  }

  /** Gain envelope: attack → peak → exponential decay. */
  const env = (c: AudioContextLike, at: number, peak: number, attack: number, decay: number): GainNode => {
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(peak, at + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay)
    g.connect(c.destination)
    return g
  }

  const tone = (c: AudioContextLike, type: OscillatorType, f0: number, f1: number, at: number, dur: number, g: GainNode) => {
    const o = c.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(f0, at)
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur)
    o.connect(g)
    o.start(at)
    o.stop(at + dur + 0.05)
    return o
  }

  const noiseBurst = (
    c: AudioContextLike,
    at: number,
    dur: number,
    filter: BiquadFilterType,
    f0: number,
    f1: number,
    q: number,
    g: GainNode
  ) => {
    const src = c.createBufferSource()
    src.buffer = getNoise(c)
    const bq = c.createBiquadFilter()
    bq.type = filter
    bq.Q.value = q
    bq.frequency.setValueAtTime(f0, at)
    bq.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur)
    src.connect(bq)
    bq.connect(g)
    src.start(at, Math.random() * 0.5)
    src.stop(at + dur + 0.05)
  }

  const recipes: Record<SoundName, (c: AudioContextLike, t: number) => void> = {
    popIn: (c, t) => {
      tone(c, 'sine', 320, 980, t, 0.09, env(c, t, 0.35, 0.005, 0.12))
      tone(c, 'triangle', 660, 1320, t + 0.03, 0.06, env(c, t + 0.03, 0.12, 0.004, 0.08))
    },
    gulp: (c, t) => {
      tone(c, 'sine', 210, 70, t, 0.22, env(c, t, 0.5, 0.01, 0.24))
      tone(c, 'sine', 160, 60, t + 0.16, 0.18, env(c, t + 0.16, 0.35, 0.01, 0.2))
      noiseBurst(c, t, 0.12, 'lowpass', 900, 200, 1, env(c, t, 0.12, 0.005, 0.1))
    },
    crunch: (c, t) => {
      const f = 1800 + Math.random() * 1600
      noiseBurst(c, t, 0.06, 'bandpass', f, f * 0.7, 2.5, env(c, t, 0.32, 0.002, 0.07))
      noiseBurst(c, t + 0.035, 0.05, 'bandpass', f * 1.3, f, 3, env(c, t + 0.035, 0.18, 0.002, 0.05))
    },
    whoosh: (c, t) => {
      noiseBurst(c, t, 0.32, 'bandpass', 380, 2600, 1.4, env(c, t, 0.3, 0.08, 0.26))
    },
    cough: (c, t) => {
      for (const dt of [0, 0.2]) {
        noiseBurst(c, t + dt, 0.14, 'lowpass', 1400, 500, 0.8, env(c, t + dt, 0.45, 0.008, 0.14))
        tone(c, 'sawtooth', 150, 90, t + dt, 0.12, env(c, t + dt, 0.1, 0.008, 0.12))
      }
    },
    burp: (c, t) => {
      const g = env(c, t, 0.4, 0.03, 0.62)
      const lp = c.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 700
      lp.connect(g)
      const o = c.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(95, t)
      o.frequency.linearRampToValueAtTime(75, t + 0.6)
      const lfo = c.createOscillator()
      lfo.frequency.value = 28
      const lfoGain = c.createGain()
      lfoGain.gain.value = 18
      lfo.connect(lfoGain)
      lfoGain.connect(o.frequency)
      o.connect(lp)
      o.start(t)
      lfo.start(t)
      o.stop(t + 0.7)
      lfo.stop(t + 0.7)
    }
  }

  return {
    get enabled() {
      return enabled
    },
    setEnabled(on: boolean) {
      enabled = on
    },
    play(name: SoundName) {
      if (!enabled) return
      const c = getCtx()
      if (!c) return
      try {
        recipes[name](c, c.currentTime + 0.01)
      } catch {
        // Audio is decoration: never let it break the flow.
      }
    }
  }
}
