// One-page visual style sheet for external designers: docs/art/style-guide.svg + style-guide.png.
// Usage: node docs/art/characters/_build/style-guide.mjs
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { INK, POSES, VIEWBOX } from './lib.mjs'
import * as motu from './chars/00-motu-uncle.mjs'
import * as chacha from './chars/01-chacha-gappu.mjs'
import * as dadi from './chars/02-dadi-amma.mjs'
import * as biscuit from './chars/11-biscuit-cat.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', '..')
const F = 'Inter, DejaVu Sans, Arial, sans-serif'
const MONO = 'DejaVu Sans Mono, Menlo, monospace'
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function pose(ch, name, uid, x, y, s, bg = true) {
  const ctx = { uid, ...POSES[name], defs: [] }
  const body = ch.draw(ctx)
  const back = bg ? `<rect x="-220" y="-206" width="440" height="440" fill="${ch.meta.bg[0]}"/><circle cx="0" cy="4" r="196" fill="${ch.meta.bg[1]}"/>` : ''
  return `<svg x="${x}" y="${y}" width="${s}" height="${s}" viewBox="${VIEWBOX}"><defs>${ctx.defs.join('')}</defs>${back}${body}</svg>`
}
const text = (x, y, s, { size = 17, w = 500, fill = INK, anchor = 'start', font = F } = {}) =>
  `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${w}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`
const lines = (x, y, arr, opt = {}) => arr.map((s, i) => text(x, y + i * (opt.lh ?? 24), s, opt)).join('')
function panel(x, y, w, h, n, title) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="#fff" stroke="${INK}" stroke-width="3"/>` + `<circle cx="${x + 30}" cy="${y + 32}" r="16" fill="#f4c34d" stroke="${INK}" stroke-width="3"/>` + text(x + 30, y + 38, String(n), { size: 17, w: 900, anchor: 'middle' }) + text(x + 56, y + 40, title, { size: 24, w: 900 })
}

const W = 1600
const H = 2240
let s = `<rect width="${W}" height="${H}" fill="#fbf4ea"/>`
s += text(48, 74, 'Let us drag! — Character style guide', { size: 44, w: 900 })
s += text(48, 108, 'One-page cheat sheet for character artists. Full rules: docs/art/STYLE_GUIDE.md. Reference build kit: docs/art/characters/_build/.', { size: 18, fill: '#7d6a5f' })

// 1 — canvas & safe area
{
  const x = 40, y = 140, w = 740, h = 520
  s += panel(x, y, w, h, 1, 'Canvas & safe area')
  const ax = x + 30, ay = y + 70, A = 400, k = A / 440
  const X = (vx) => ax + (vx + 220) * k
  const Y = (vy) => ay + (vy + 206) * k
  s += `<rect x="${ax}" y="${ay}" width="${A}" height="${A}" fill="#eef0f8" stroke="${INK}" stroke-width="2"/>`
  s += `<circle cx="${X(0)}" cy="${Y(4)}" r="${196 * k}" fill="#d7dcef"/>`
  s += pose(chacha, 'idle', 'sg-canvas', ax, ay, A, false)
  s += `<rect x="${X(-200)}" y="${Y(-190)}" width="${400 * k}" height="${424 * k}" fill="none" stroke="#2f9a95" stroke-width="3" stroke-dasharray="10 6"/>`
  s += `<rect x="${X(-130)}" y="${Y(-180)}" width="${260 * k}" height="${300 * k}" fill="none" stroke="#d9443a" stroke-width="3" stroke-dasharray="4 5"/>`
  s += `<path d="M ${X(-14)} ${Y(0)} H ${X(14)} M ${X(0)} ${Y(-14)} V ${Y(14)}" stroke="#d9443a" stroke-width="3"/>`
  const tx = ax + A + 26
  s += lines(tx, ay + 16, [
    'Artboard 512 × 512 px', 'viewBox -220 -206 440 440', 'Face origin (0,0) = centre of face', '',
    'teal dashes: character bounds', 'x −200…200, y −190…234', '(body may bleed off the bottom)', '',
    'red dashes: head zone ≈ 260 × 300', 'Head ≈ 60–70 % of visible height', '(big head, small body)', '',
    'Background disc r 196, centre (0, 4)', 'Incoming file enters top-left', '(−150, −150): keep that corner clear', '',
    'Check every drawing at 220–260 px:', 'eyes, mouth and signature', 'detail must still read.'
  ], { size: 16, lh: 23 })
}

// 2 — construction & rig names
{
  const x = 820, y = 140, w = 740, h = 520
  s += panel(x, y, w, h, 2, 'Construction & rig layers (data-part)')
  s += lines(x + 30, y + 84, [
    'root',
    '├─ body          clothes, belly, props on the body',
    '├─ armL / armR  rubber-hose arm (ink stroke + sleeve)',
    '├─ head         pivot near the neck (0, 90)',
    '│  ├─ earL earR hair (+ hat/bun/glasses as own groups)',
    '│  ├─ skull     one jaw-aware path: ink, fill, lit oval',
    '│  └─ face',
    '│     ├─ cheeks  chin',
    '│     ├─ mouth > mouthFill throat uvula tongue',
    '│     │          lowerTeeth upperTeeth mouthLine lip',
    '│     ├─ moustache  nose  (signature face detail)',
    '│     ├─ eyes > eyeL / eyeR > pupilL|R  lidL|R  lowerL|R',
    '│     └─ brows > browL / browR',
    '└─ handL / handR  open palm or fist',
    '',
    'Paint order back→front: ears, hair-back, skull, face',
    '(cheeks, chin, mouth, moustache, nose, eyes, brows),',
    'then arms and hands over the body.',
    'App-only names: headInk headFill headClip shade shine',
    'wrinkles combover pouchL|R blushL|R mole templeL|R',
    'scleraL|R lidLineL|R happyL|R sweat drop1 drop2'
  ], { size: 15, lh: 20.5, font: MONO })
}

// 3 — outlines
{
  const x = 40, y = 690, w = 740, h = 440
  s += panel(x, y, w, h, 3, 'Outlines: ink #2b1a14, variable width')
  const ox = x + 120, oy = y + 170
  const blob = 'M -70,-50 C -30,-80 50,-76 74,-36 C 96,0 70,56 10,62 C -50,66 -96,24 -70,-50 Z'
  s += `<g transform="translate(${ox} ${oy})"><path d="${blob}" fill="${INK}" stroke="${INK}" stroke-width="9" stroke-linejoin="round" transform="translate(1.6 2.2)"/><path d="${blob}" fill="#f39a45"/></g>`
  s += text(ox, oy + 100, 'ink copy offset (1.6, 2.2)', { size: 14, anchor: 'middle', fill: '#7d6a5f' })
  s += text(ox, oy + 118, '→ thin top-left, heavy bottom-right', { size: 14, anchor: 'middle', fill: '#7d6a5f' })
  const rows = [['Head / body silhouette', 9], ['Ears, hair, big props', 8], ['Eyes, hands, nose', 6], ['Open mouth line', 5.5], ['Lid line, folds, creases', 3.4], ['Detail / hatching', 2.4]]
  rows.forEach(([n, sw], i) => {
    const ry = y + 92 + i * 46
    s += `<path d="M ${x + 280} ${ry} L ${x + 380} ${ry}" stroke="${INK}" stroke-width="${sw}" stroke-linecap="round"/>` + text(x + 400, ry + 6, `${sw} — ${n}`, { size: 17 })
  })
  s += lines(x + 30, y + 384, ['Units are viewBox units (≈ 1.16 px at 512). No hairlines under 2. Interior lines are round-capped', 'strokes; silhouettes are FILLED outline shapes (never a plain stroke on top).'], { size: 15, lh: 21 })
}

// 4 — palette
{
  const x = 820, y = 690, w = 740, h = 440
  s += panel(x, y, w, h, 4, 'Colour: warm, flat, few')
  const skins = ['#f6c39b', '#f5c4a0', '#f2c49c', '#f0b893', '#d3a07a', '#c98d64', '#c57f52', '#b9784f', '#b8764c']
  s += text(x + 30, y + 86, 'Skin bases in use (light → deep). Each skin = base, light, shade, deep, blush.', { size: 15 })
  skins.forEach((c, i) => (s += `<rect x="${x + 30 + i * 74}" y="${y + 98}" width="64" height="44" rx="8" fill="${c}" stroke="${INK}" stroke-width="2.5"/>`))
  const ramp = [['light', '#ffe0c8'], ['base', '#f5c4a0'], ['shade', '#dc9f7c'], ['deep', '#b8775a'], ['blush', '#f07b72']]
  s += text(x + 30, y + 178, 'One material = one ramp. Shadow = darker AND cooler (hue toward red/violet):', { size: 15 })
  ramp.forEach(([n, c], i) => (s += `<rect x="${x + 30 + i * 120}" y="${y + 192}" width="104" height="48" rx="8" fill="${c}" stroke="${INK}" stroke-width="2.5"/>` + text(x + 82 + i * 120, y + 262, `${n} ${c}`, { size: 13, anchor: 'middle' })))
  const fixed = [['ink', INK], ['throat', '#5a1119'], ['throat deep', '#2a050b'], ['tongue', '#f0707e'], ['teeth', '#fffaf0'], ['sclera', '#fffdf6'], ['gold', '#f4c34d']]
  s += text(x + 30, y + 300, 'Shared fixed colours (every character):', { size: 15 })
  fixed.forEach(([n, c], i) => (s += `<circle cx="${x + 56 + i * 98}" cy="${y + 336}" r="20" fill="${c}" stroke="${INK}" stroke-width="2.5"/>` + text(x + 56 + i * 98, y + 374, n, { size: 13, anchor: 'middle' })))
  s += text(x + 30, y + 416, 'Max ~12 colours per character (excluding shared). No pure black, no pure grey fills, no neon.', { size: 15, w: 700 })
}

// 5 — lighting
{
  const x = 40, y = 1160, w = 1520, h = 400
  s += panel(x, y, w, h, 5, 'Lighting: default cel (top-left) and the soft-vinyl variant (key from the left)')
  s += pose(motu, 'idle', 'sg-l1', x + 30, y + 70, 300)
  s += pose(dadi, 'idle', 'sg-l2', x + 340, y + 70, 300)
  s += pose(biscuit, 'idle', 'sg-l3', x + 760, y + 70, 300)
  s += pose(biscuit, 'eat', 'sg-l4', x + 1070, y + 70, 300)
  s += `<path d="M ${x + 715} ${y + 76} V ${y + 370}" stroke="${INK}" stroke-width="2" stroke-dasharray="6 6"/>`
  s += lines(x + 30, y + 392, ['DEFAULT: flat base + ONE cel shadow per material (lower-right), lit oval up-left clipped to the head, small forehead shine, optional hatching on the shadow side.'], { size: 14 })
  s += lines(x + 1380, y + 110, ['SOFT VINYL', '(Biscuit only)', '', 'key light LEFT', 'thin rim light on', 'left edges', 'radial form shade', 'to the right', 'soft specular', 'top-left', 'soft contact', 'shadow under feet', 'gradients only,', 'no filters'], { size: 14, lh: 19 })
}

// 6 — poses
{
  const x = 40, y = 1590, w = 740, h = 610
  s += panel(x, y, w, h, 6, 'Poses & expressions (per character)')
  s += pose(chacha, 'idle', 'sg-p1', x + 30, y + 70, 220)
  s += pose(chacha, 'eat', 'sg-p2', x + 262, y + 70, 220)
  s += text(x + 140, y + 312, 'idle', { size: 15, w: 700, anchor: 'middle' }) + text(x + 372, y + 312, 'eat', { size: 15, w: 700, anchor: 'middle' })
  s += lines(x + 500, y + 96, ['shown at 220 px —', 'the minimum size', 'everything must', 'read at.'], { size: 15, lh: 21, fill: '#7d6a5f' })
  s += lines(x + 30, y + 350, [
    '1  idle — mouth closed, friendly smile, pupils centre/slightly down',
    '2  eat — jaw drops 54–62 units, mouth ≥ 100 wide, pupils UP-LEFT',
    '    at the incoming file, brows up, hands up/open',
    '3  chew ×3 — jaw 0.2 / 0.5 / 0.2, cheeks puffed, eyes shut or happy',
    '4  happy — closed happy-arc eyes (happyL/R), big smile, blush',
    '5  cough / choke — eyes squeezed, cheeks red, sweat drop, hand to mouth',
    '',
    'Same layer names in every pose; only shapes and transforms change.',
    'Signature detail visible in ALL poses (one per character, reads at 250 px).'
  ], { size: 15.5, lh: 25 })
}

// 7 — do / don't + handover
{
  const x = 820, y = 1590, w = 740, h = 610
  s += panel(x, y, w, h, 7, 'Do / don’t · deliverables · handover')
  s += lines(x + 30, y + 84, [
    'DO  big head, huge mouth, one signature detail, warm flat fills',
    'DO  respectful, specific, affectionate characters',
    'DON’T  copy or closely echo copyrighted/trademarked characters',
    'DON’T  religious symbols, flags, uniforms of police/army',
    'DON’T  ethnic stereotypes or mocking accents/props',
    'DON’T  gradients/filters in the default style; no text in art'
  ], { size: 15.5, lh: 25, w: 600 })
  s += lines(x + 30, y + 256, [
    'Files per character (NN = number, slug = kebab-case):',
    '  NN-slug.svg        idle, layered master',
    '  NN-slug-eat.svg    eat (same layers)',
    '  NN-slug-chew-1..3.svg  NN-slug-happy.svg  NN-slug-cough.svg',
    '  NN-slug-idle.png   NN-slug-eat.png   512 × 512, with bg disc',
    '',
    'SVG handover:',
    '  plain SVG 1.1, viewBox -220 -206 440 440, no width/height tricks',
    '  every rig group: <g id="slug-pose-part" data-part="part">',
    '  no filters, masks, embedded rasters, <image>, <foreignObject>',
    '  text and fonts converted to paths; no CSS classes / <style>',
    '  clipPaths allowed; gradients only for the soft-vinyl variant',
    '  colours as #rrggbb; ink is always #2b1a14'
  ], { size: 15, lh: 23, font: MONO })
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${s}</svg>`
writeFileSync(join(outDir, 'style-guide.svg'), svg)
await sharp(Buffer.from(svg), { density: 72 }).png().toFile(join(outDir, 'style-guide.png'))
console.log('rendered style-guide')
