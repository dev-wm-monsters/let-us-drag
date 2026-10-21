// Renders static art from the Uncle SVG with sharp:
//   node src/renderer/dev/render-art.mjs icons      → resources/icon.png, resources/tray/*.png
//   node src/renderer/dev/render-art.mjs poses DIR  → DIR/pose-<mood>.png (quick art review)
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { repoRoot, startRendererServer } from './vite-dev.mjs'

const [cmd = 'icons', outArg] = process.argv.slice(2)
const server = await startRendererServer({ ssrOnly: true })
try {
  const art = await server.ssrLoadModule('/dev/static-art.tsx')
  if (cmd === 'icons') {
    const res = resolve(repoRoot, 'resources')
    mkdirSync(resolve(res, 'tray'), { recursive: true })
    await sharp(Buffer.from(art.renderIconSvg())).resize(1024, 1024).png().toFile(resolve(res, 'icon.png'))
    for (const [file, size] of [
      ['trayTemplate.png', 16],
      ['trayTemplate@2x.png', 32]
    ]) {
      await sharp(Buffer.from(art.renderTraySvg(size * 8)), { density: 72 })
        .resize(size, size)
        .png()
        .toFile(resolve(res, 'tray', file))
    }
    await sharp(Buffer.from(art.renderTraySvg(256, true))).resize(32, 32).png().toFile(resolve(res, 'tray', 'tray.png'))
    console.log('icons written to', res)
  } else if (cmd === 'poses') {
    const out = resolve(outArg ?? resolve(repoRoot, 'docs/art/poses'))
    mkdirSync(out, { recursive: true })
    const moods = ['idle', 'appear', 'hover', 'feedMe', 'eat', 'chew', 'hamster', 'struggle', 'spit', 'choke', 'refuse']
    for (const name of moods) {
      const mood = name === 'hamster' || name === 'struggle' ? 'chew' : name
      const mods = { hamster: name === 'hamster', struggle: name === 'struggle' }
      const seconds = mood === 'eat' ? 0.4 : mood === 'spit' ? 0.8 : mood === 'choke' ? 0.05 : 0.7
      const target = mood === 'hover' ? { x: 160, y: -140 } : { x: 0, y: 30 }
      const svg = art.renderUncleSvg({ mood, seconds, target, mods, width: 520 })
      const mood_ = name // file name
      writeFileSync(resolve(out, `pose-${mood_}.svg`), svg)
      await sharp(Buffer.from(svg)).flatten({ background: '#f3ead8' }).png().toFile(resolve(out, `pose-${mood_}.png`))
    }
    // Contact sheet for quick reviews.
    const tiles = await Promise.all(moods.map((m) => sharp(resolve(out, `pose-${m}.png`)).resize(260).toBuffer()))
    const { height = 0 } = await sharp(tiles[0]).metadata()
    const cols = 5
    await sharp({ create: { width: 260 * cols, height: height * Math.ceil(tiles.length / cols), channels: 3, background: '#ffffff' } })
      .composite(tiles.map((input, i) => ({ input, left: (i % cols) * 260, top: Math.floor(i / cols) * height })))
      .png()
      .toFile(resolve(out, 'sheet.png'))
    console.log('poses written to', out)
  } else {
    throw new Error(`unknown command ${cmd}`)
  }
} finally {
  await server.close()
}
