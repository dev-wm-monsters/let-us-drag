// Character picker: manifest/registry, shipped art, sanitiser and settings validation.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { applySettingsPatch, parseSettings } from '../../src/main/settings-store'
import { CHARACTER_IDS, CHARACTERS, DEFAULT_CHARACTER, characterInfo, isCharacterId } from '../../src/shared/characters'
import { DEFAULT_SETTINGS } from '../../src/shared/types'
import { sanitizeCharacterSvg, splitSvg, svgProblems } from '../../scripts/lib/character-svg.mjs'

const root = resolve(__dirname, '../..')
const shipped = join(root, 'src/renderer/characters')

describe('character manifest', () => {
  it('ships the Uncle (default) and the nine chosen drawn characters, nothing else', () => {
    expect(DEFAULT_CHARACTER).toBe('uncle')
    expect(DEFAULT_SETTINGS.character).toBe('uncle')
    expect([...CHARACTER_IDS]).toEqual([
      'uncle',
      'motu-uncle',
      'chacha-gappu',
      'dadi-amma',
      'halwai-bhaiya',
      'auto-wala-uncle',
      'great-uncle-nickels',
      'sumo-san',
      'nonna-pina',
      'pehlwan-pappu'
    ])
    for (const no of ['captain-chomp', 'abuela-rosa', 'biscuit-cat']) expect(isCharacterId(no)).toBe(false)
    expect(new Set(CHARACTER_IDS).size).toBe(CHARACTER_IDS.length)
  })

  it('every character has a name, a scale and (except the Uncle) a docs art source', () => {
    for (const c of CHARACTERS) {
      expect(c.name.length).toBeGreaterThan(2)
      expect(c.scale).toBeGreaterThan(0.5)
      expect(c.scale).toBeLessThanOrEqual(1)
      if (c.id === 'uncle') expect(c.art).toBeNull()
      else expect(c.art).toMatch(/^\d\d-[a-z-]+$/)
    }
    expect(characterInfo('sumo-san').name).toBe('Sumo-san')
  })

  it('isCharacterId only accepts known ids', () => {
    expect(isCharacterId('uncle')).toBe(true)
    expect(isCharacterId('nonna-pina')).toBe(true)
    for (const bad of ['', 'Uncle', 'nonna', null, 3, undefined, {}]) expect(isCharacterId(bad)).toBe(false)
  })
})

describe('shipped character art (src/renderer/characters)', () => {
  it('has exactly one folder per character', () => {
    const dirs = readdirSync(shipped, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
    expect(dirs).toEqual([...CHARACTER_IDS].sort())
  })

  for (const c of CHARACTERS) {
    it(`${c.id}: thumb.png is 128×128`, async () => {
      const meta = await sharp(join(shipped, c.id, 'thumb.png')).metadata()
      expect([meta.width, meta.height]).toEqual([128, 128])
    })
    if (c.art === null) continue
    it(`${c.id}: idle.svg + eat.svg are sanitised, riggable, and match the docs art`, () => {
      for (const [pose, src] of [
        ['idle', `${c.art}.svg`],
        ['eat', `${c.art}-eat.svg`]
      ] as const) {
        const svg = readFileSync(join(shipped, c.id, `${pose}.svg`), 'utf8').trim()
        expect(svgProblems(svg), `${c.id}/${pose}`).toEqual([])
        expect(svg).not.toContain('fileIncoming')
        expect(splitSvg(svg).viewBox).toBe('-220 -206 440 440')
        for (const part of ['root', 'body', 'head', 'face', 'mouth', 'eyeL', 'eyeR']) expect(svg, `${c.id}/${pose} ${part}`).toContain(`data-part="${part}"`)
        // The sync script output is exactly the sanitised docs file (re-run scripts/sync-characters.mjs).
        const docs = join(root, 'docs/art/characters', src)
        if (existsSync(docs)) expect(svg, `${c.id}/${pose} is stale`).toBe(sanitizeCharacterSvg(readFileSync(docs, 'utf8')))
      }
    })
  }
})

describe('sanitizeCharacterSvg', () => {
  const evil = `<?xml version="1.0"?><!-- hi --><svg viewBox="0 0 10 10" width="512" onload="x()">
    <title>t</title><style>*{}</style><script>alert(1)</script>
    <defs><clipPath id="c"><path d="M0 0"/></clipPath></defs>
    <g data-part="head" clip-path="url(#c)" onclick="y()" fill="url(https://evil/x)" transform="rotate(2)">
      <foreignObject><div>x</div></foreignObject><image href="https://evil/x.png"/><use href="#c"/>
      <a href="javascript:alert(1)"><path d="M1 1"/></a>
      <text x="1">a &amp; b</text>
    </g>
    <g data-part="fileIncoming"><g><path d="M2 2"/></g></g>
  </svg>`

  it('keeps shapes, ids, local url() refs and transforms; drops everything risky', () => {
    const out = sanitizeCharacterSvg(evil)
    expect(svgProblems(out)).toEqual([])
    expect(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">')).toBe(true)
    expect(out).toContain('<clipPath id="c">')
    expect(out).toContain('clip-path="url(#c)"')
    expect(out).toContain('transform="rotate(2)"')
    expect(out).toContain('<text x="1">a &amp; b</text>')
    for (const gone of ['onload', 'onclick', 'evil', 'script', 'style', 'title', 'foreignObject', '<image', '<use', '<a', 'javascript', 'M2 2', 'width=', '<!--', '<?xml'])
      expect(out, gone).not.toContain(gone)
  })

  it('refuses input without an svg root or viewBox', () => {
    expect(() => sanitizeCharacterSvg('<g/>')).toThrow()
    expect(() => sanitizeCharacterSvg('<svg><g/></svg>')).toThrow()
  })

  it('svgProblems flags unsafe markup', () => {
    expect(svgProblems('<svg><script/></svg>').length).toBeGreaterThan(0)
    expect(svgProblems('<svg><g onclick="x"/></svg>').length).toBeGreaterThan(0)
    expect(svgProblems('<svg><g fill="url(https://x)"/></svg>').length).toBeGreaterThan(0)
    expect(svgProblems('<svg><g fill="url(#a)"/></svg>')).toEqual([])
  })
})

describe('settings: character field', () => {
  it('defaults to the Uncle when missing or unknown on disk (other fields kept)', () => {
    expect(parseSettings({}).character).toBe('uncle')
    expect(parseSettings({ character: 'captain-chomp', plainMode: true })).toEqual({ ...DEFAULT_SETTINGS, plainMode: true })
    expect(parseSettings({ character: 42 }).character).toBe('uncle')
    expect(parseSettings({ character: 'sumo-san' }).character).toBe('sumo-san')
  })

  it('a renderer patch accepts known ids and rejects unknown ones', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, { character: 'dadi-amma' }).character).toBe('dadi-amma')
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { character: 'abuela-rosa' })).toThrow()
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { character: '' })).toThrow()
  })
})
