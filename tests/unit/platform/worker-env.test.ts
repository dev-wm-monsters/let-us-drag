import { describe, expect, it } from 'vitest'
import { engineWorkerEnv, isDevOnlyEnvKey } from '../../../src/main/worker-env'

describe('engine worker environment (Security F-16, TPM D18)', () => {
  const env = {
    PATH: '/usr/bin',
    HOME: '/home/u',
    LUD_FFMPEG_PATH: '/tmp/evil',
    LUD_MODEL_PATH: '/tmp/model.onnx',
    LUD_E2E: '1',
    LUD_E2E_ENGINE_WORKER: '/tmp/w.cjs',
    LUD_DEBUG: '1',
    lud_ffmpeg_path: '/tmp/evil2', // Windows env keys are case-insensitive
    Lud_Model_Path: '/tmp/m2',
    LUDWIG: 'kept', // no underscore: not our prefix
    MY_LUD_X: 'kept', // prefix only
    UNSET: undefined
  }

  it('unpackaged: undefined, so utilityProcess.fork inherits process.env unchanged', () => {
    expect(engineWorkerEnv(env, false)).toBeUndefined()
  })

  it('packaged: drops every LUD_* key (any case), keeps everything else', () => {
    const out = engineWorkerEnv(env, true)
    expect(out).toEqual({ PATH: '/usr/bin', HOME: '/home/u', LUDWIG: 'kept', MY_LUD_X: 'kept' })
    expect(Object.keys(out ?? {}).some((k) => k.toUpperCase().startsWith('LUD_'))).toBe(false)
  })

  it('packaged: returns a copy and leaves the input alone', () => {
    const input: Record<string, string | undefined> = { LUD_FFMPEG_PATH: '/x', A: 'b' }
    const out = engineWorkerEnv(input, true)
    expect(out).toEqual({ A: 'b' })
    expect(input['LUD_FFMPEG_PATH']).toBe('/x')
    expect(engineWorkerEnv({}, true)).toEqual({})
  })

  it('prefix test', () => {
    expect(isDevOnlyEnvKey('LUD_')).toBe(true)
    expect(isDevOnlyEnvKey('lUd_X')).toBe(true)
    expect(isDevOnlyEnvKey('LUD')).toBe(false)
    expect(isDevOnlyEnvKey('LUDX_')).toBe(false)
    expect(isDevOnlyEnvKey('')).toBe(false)
  })
})
