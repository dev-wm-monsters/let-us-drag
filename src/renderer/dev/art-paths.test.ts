import { describe, expect, it } from 'vitest'
import { artOutputPaths } from './art-paths.mjs'

// Compare with forward slashes and without a drive letter so the test also runs on Windows.
const norm = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

describe('capture.mjs output paths (QA3-12)', () => {
  it('defaults to docs/art', () => {
    const p = artOutputPaths({}, '/repo')
    expect(norm(p.outDir)).toBe('/repo/docs/art/screens')
    expect(norm(p.heroGif)).toBe('/repo/docs/art/hero.gif')
    expect(norm(p.loopGif)).toBe('/repo/docs/art/uncle-eat-chew-spit.gif')
  })

  it('with LUD_SCREENS_DIR, the GIFs go there too (docs/art untouched)', () => {
    const p = artOutputPaths({ LUD_SCREENS_DIR: '/tmp/x' }, '/repo')
    expect(norm(p.outDir)).toBe('/tmp/x')
    expect(norm(p.heroGif)).toBe('/tmp/x/hero.gif')
    expect(norm(p.loopGif)).toBe('/tmp/x/uncle-eat-chew-spit.gif')
    for (const f of Object.values(p)) expect(norm(f)).not.toContain('docs/art')
  })

  it('explicit GIF paths still win', () => {
    const p = artOutputPaths({ LUD_SCREENS_DIR: '/tmp/x', LUD_HERO_PATH: '/a/h.gif', LUD_GIF_PATH: '/b/g.gif' }, '/repo')
    expect(norm(p.heroGif)).toBe('/a/h.gif')
    expect(norm(p.loopGif)).toBe('/b/g.gif')
  })
})
