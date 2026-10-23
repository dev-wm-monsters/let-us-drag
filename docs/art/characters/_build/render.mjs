// Renders every character concept: NN-slug.svg (idle), NN-slug-eat.svg, NN-slug-idle.png and
// NN-slug-eat.png (512×512, sharp), then storyboard.png and storyboard.html.
// Usage: node docs/art/characters/_build/render.mjs [slug-filter…]
import { readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { POSES, VIEWBOX, svgDoc } from './lib.mjs'
import { storyboard } from './storyboard.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..')
const filter = process.argv.slice(2)

const files = readdirSync(join(here, 'chars'))
  .filter((f) => f.endsWith('.mjs'))
  .sort()
const chars = []
for (const f of files) chars.push(await import(pathToFileURL(join(here, 'chars', f)).href))

/** Draw one pose of a character; returns { body, defs }. */
export function drawPose(ch, poseName, uid) {
  const ctx = { uid, ...POSES[poseName], defs: [] }
  const body = ch.draw(ctx)
  return { ctx, body }
}

const LAYERS =
  'Layered for animation: root > body, head > (hair/ears/face > cheeks, mouth > [mouthFill, throat, uvula, tongue, teeth, mouthLine], nose, eyes > eyeL/eyeR > pupilL/pupilR/lidL/lidR, brows > browL/browR), armL/armR, handL/handR, signature props. Rig names are in data-part.'

for (const ch of chars) {
  const m = ch.meta
  const base = `${m.num}-${m.slug}`
  if (filter.length && !filter.some((s) => base.includes(s))) continue
  for (const poseName of ['idle', 'eat']) {
    const { ctx, body } = drawPose(ch, poseName, `${m.slug}-${poseName}`)
    const svg = svgDoc(ctx, `${m.name} (${poseName})`, body, { comment: `${m.name} — ${m.origin}. ${LAYERS}` })
    writeFileSync(join(out, poseName === 'idle' ? `${base}.svg` : `${base}-eat.svg`), svg)
    const bg = `<rect x="-220" y="-206" width="440" height="440" fill="${m.bg[0]}"/><circle cx="0" cy="4" r="196" fill="${m.bg[1]}"/>`
    const withBg = svgDoc(ctx, m.name, bg + body)
    await sharp(Buffer.from(withBg), { density: 144 }).resize(512, 512).png().toFile(join(out, `${base}-${poseName}.png`))
  }
  console.log('rendered', base)
}

if (!filter.length || filter.includes('storyboard')) {
  await storyboard(chars, drawPose, out, VIEWBOX)
  console.log('rendered storyboard')
}
