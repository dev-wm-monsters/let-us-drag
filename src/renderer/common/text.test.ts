import { describe, expect, it } from 'vitest'
import { friendlyError, MAX_ENGINE_MESSAGE_CHARS, MODEL_DOWNLOAD_SHARE, MODEL_DOWNLOAD_STAGE, stageCaption } from './text'

// Engine modules are loaded at test runtime only (non-literal specifiers): the renderer's type
// program stays DOM-only, but the test still fails when the engine side of the contract changes.
const engine = (p: string): Promise<Record<string, unknown>> => import(/* @vite-ignore */ `../../engine/${p}`)

describe('friendlyError (QA3-04: long engine messages)', () => {
  it('shows engine messages up to the engine cap (200 chars) verbatim', () => {
    const m140 = 'x'.repeat(140)
    const m200 = 'y'.repeat(200)
    expect(friendlyError({ code: 'INPUT_INVALID', message: m140 })).toBe(m140)
    expect(friendlyError({ code: 'INPUT_INVALID', message: m200 })).toBe(m200)
    expect(friendlyError({ code: 'INPUT_INVALID', message: 'z'.repeat(201) })).toMatch(/broken/)
  })

  it('matches the engine cap', async () => {
    const limits = await engine('limits.ts')
    expect(limits.MAX_MESSAGE_CHARS).toBe(MAX_ENGINE_MESSAGE_CHARS)
  })
})

describe('stageCaption (D15, QA3-02)', () => {
  it('download stage: text + download percentage (first file of n carries the download)', () => {
    expect(stageCaption(MODEL_DOWNLOAD_STAGE, 0, 1)).toBe(`${MODEL_DOWNLOAD_STAGE} · 0%`)
    expect(stageCaption(MODEL_DOWNLOAD_STAGE, MODEL_DOWNLOAD_SHARE * 0.37, 1)).toBe(`${MODEL_DOWNLOAD_STAGE} · 37%`)
    expect(stageCaption(MODEL_DOWNLOAD_STAGE, MODEL_DOWNLOAD_SHARE, 1)).toBe(`${MODEL_DOWNLOAD_STAGE} · 100%`)
    expect(stageCaption(MODEL_DOWNLOAD_STAGE, (MODEL_DOWNLOAD_SHARE * 0.5) / 3, 3)).toBe(`${MODEL_DOWNLOAD_STAGE} · 50%`)
    // Never above 100 %, and no percentage while the size is unknown.
    expect(stageCaption(MODEL_DOWNLOAD_STAGE, 0.9, 1)).toBe(`${MODEL_DOWNLOAD_STAGE} · 100%`)
    expect(stageCaption(MODEL_DOWNLOAD_STAGE, -1, 1)).toBe(MODEL_DOWNLOAD_STAGE)
  })

  it('other stages: short text with an ellipsis; nothing without a stage', () => {
    expect(stageCaption('Chewing', 0.5, 1)).toBe('Chewing…')
    expect(stageCaption('Checking the download', 0.4, 1)).toBe('Checking the download…')
    expect(stageCaption('Done!', 1, 1)).toBe('Done!')
    expect(stageCaption('', 0.5, 1)).toBeNull()
    expect(stageCaption(null, 0.5, 1)).toBeNull()
    expect(stageCaption('   ', 0.5, 1)).toBeNull()
  })

  it('caps over-long stage texts', () => {
    const c = stageCaption('a'.repeat(300), 0.5, 1)!
    expect(c.length).toBeLessThanOrEqual(81)
    expect(c.endsWith('…')).toBe(true)
  })

  it('matches the engine: same stage text, download = first 40 % of the first file', async () => {
    const jobs = await engine('jobs.ts')
    expect(jobs.MODEL_DOWNLOAD_STAGE).toBe(MODEL_DOWNLOAD_STAGE)
    const src = (await import(/* @vite-ignore */ `../../engine/${'jobs.ts'}?raw`)) as { default: string }
    expect(src.default).toContain(`progress(p * ${MODEL_DOWNLOAD_SHARE}, MODEL_DOWNLOAD_STAGE)`)
  })
})
