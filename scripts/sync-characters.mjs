// Copy the selected character art from docs/art/characters into the renderer:
//
//   node scripts/sync-characters.mjs            # every character in src/shared/characters.ts
//   node scripts/sync-characters.mjs sumo-san   # only these ids
//
// For each character with art: src/renderer/characters/<id>/idle.svg + eat.svg (sanitised, see
// scripts/lib/character-svg.mjs) and thumb.png (128×128, transparent, rendered from idle.svg).
// The built-in Uncle gets a thumb.png rendered from the live rig (src/renderer/dev/static-art.tsx).
// The selection (ids, names, source files) lives in src/shared/characters.ts.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { CHARACTERS } from '../src/shared/characters.ts'
import { sanitizeCharacterSvg, svgProblems } from './lib/character-svg.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artDir = join(root, 'docs/art/characters')
const outDir = join(root, 'src/renderer/characters')
const THUMB = 128

const only = process.argv.slice(2)
const unknown = only.filter((id) => !CHARACTERS.some((c) => c.id === id))
if (unknown.length) throw new Error(`unknown character id(s): ${unknown.join(', ')}`)
const selected = CHARACTERS.filter((c) => only.length === 0 || only.includes(c.id))

async function thumb(svg, file) {
  // Render large, trim the transparent margin, then fit the drawing into the square.
  const big = await sharp(Buffer.from(svg), { density: 288 }).png().toBuffer()
  const trimmed = await sharp(big).trim({ threshold: 1 }).toBuffer()
  await sharp(trimmed)
    .resize(THUMB, THUMB, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ palette: true, quality: 90, effort: 8 })
    .toFile(file)
}

for (const c of selected) {
  const dir = join(outDir, c.id)
  mkdirSync(dir, { recursive: true })
  if (c.art === null) {
    // The built-in Uncle: render his settled idle pose through Vite's SSR loader.
    const { startRendererServer } = await import('../src/renderer/dev/vite-dev.mjs')
    const server = await startRendererServer({ ssrOnly: true })
    try {
      const art = await server.ssrLoadModule('/dev/static-art.tsx')
      await thumb(art.renderUncleSvg({ mood: 'idle', seconds: 0.8, width: 350 }), join(dir, 'thumb.png'))
    } finally {
      await server.close()
    }
    console.log(`${c.id}: thumb.png (built-in rig)`)
    continue
  }
  for (const [pose, src] of [
    ['idle', `${c.art}.svg`],
    ['eat', `${c.art}-eat.svg`]
  ]) {
    const svg = sanitizeCharacterSvg(readFileSync(join(artDir, src), 'utf8'))
    const problems = svgProblems(svg)
    if (problems.length) throw new Error(`${src}: ${problems.join(', ')}`)
    writeFileSync(join(dir, `${pose}.svg`), svg + '\n')
    if (pose === 'idle') await thumb(svg, join(dir, 'thumb.png'))
  }
  console.log(`${c.id}: idle.svg, eat.svg, thumb.png ← ${c.art}`)
}
