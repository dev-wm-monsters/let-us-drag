// storyboard.png (grid of all characters, idle + eat, with names) and storyboard.html (self-contained,
// inline SVG, no external resources).
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const FONT = 'Inter, DejaVu Sans, Arial, sans-serif'

function poseSvg(ch, drawPose, poseName, uid, viewBox, attrs = '') {
  const { ctx, body } = drawPose(ch, poseName, uid)
  const [x, y, w, h] = viewBox.split(' ').map(Number)
  const bg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${ch.meta.bg[0]}"/><circle cx="0" cy="4" r="196" fill="${ch.meta.bg[1]}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${attrs}><defs>${ctx.defs.join('')}</defs>${bg}${body}</svg>`
}

export async function storyboard(chars, drawPose, out, viewBox) {
  // ——— PNG ———
  const S = 236
  const GAP = 10
  const CELL_W = S * 2 + GAP + 28
  const CELL_H = S + 74
  const COLS = 5
  const PAD = 36
  const TOP = 104
  const W = PAD * 2 + COLS * CELL_W
  const H = TOP + Math.ceil(chars.length / COLS) * CELL_H + PAD
  let cells = ''
  chars.forEach((ch, i) => {
    const cx = PAD + (i % COLS) * CELL_W
    const cy = TOP + Math.floor(i / COLS) * CELL_H
    const m = ch.meta
    cells +=
      `<rect x="${cx + 4}" y="${cy}" width="${CELL_W - 12}" height="${CELL_H - 12}" rx="18" fill="#ffffff" stroke="#2b1a14" stroke-width="3"/>` +
      poseSvg(ch, drawPose, 'idle', `sb-${m.slug}-i`, viewBox, ` x="${cx + 14}" y="${cy + 10}" width="${S}" height="${S}"`) +
      poseSvg(ch, drawPose, 'eat', `sb-${m.slug}-e`, viewBox, ` x="${cx + 14 + S + GAP}" y="${cy + 10}" width="${S}" height="${S}"`) +
      `<text x="${cx + 18}" y="${cy + S + 40}" font-family="${FONT}" font-weight="800" font-size="22" fill="#2b1a14">${m.num} · ${esc(m.name)}</text>` +
      `<text x="${cx + CELL_W - 26}" y="${cy + S + 40}" font-family="${FONT}" font-weight="600" font-size="14" fill="#8a7468" text-anchor="end">idle · eat</text>`
  })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#fbf4ea"/>
<text x="${PAD + 4}" y="62" font-family="${FONT}" font-weight="900" font-size="40" fill="#2b1a14">Let us drag! — Motu Uncle + 10 alternative characters</text>
<text x="${W - PAD - 4}" y="62" font-family="${FONT}" font-weight="600" font-size="18" fill="#8a7468" text-anchor="end">concept art · idle (mouth closed) / eat (mouth open, looking up-left at the incoming file)</text>
${cells}
</svg>`
  await sharp(Buffer.from(svg), { density: 72 }).png().toFile(join(out, 'storyboard.png'))

  // ——— HTML ———
  const cards = chars
    .map((ch) => {
      const m = ch.meta
      return `
  <article class="card" id="c${m.num}" style="--bg:${m.bg[0]};--bg2:${m.bg[1]}">
    <header>
      <span class="num">${m.num}</span>
      <div>
        <h2>${esc(m.name)}</h2>
        <p class="origin">${esc(m.origin)}</p>
      </div>
    </header>
    <div class="poses">
      <figure>${poseSvg(ch, drawPose, 'idle', `h-${m.slug}-i`, viewBox, ` role="img" aria-label="${esc(m.name)}, idle pose"`)}<figcaption>Idle — mouth closed</figcaption></figure>
      <figure>${poseSvg(ch, drawPose, 'eat', `h-${m.slug}-e`, viewBox, ` role="img" aria-label="${esc(m.name)}, eating pose"`)}<figcaption>Eat — mouth wide, eyes on the file</figcaption></figure>
    </div>
    <dl>
      <dt>Signature</dt><dd>${esc(m.signature)}</dd>
      <dt>Says</dt><dd class="quote">“${esc(m.catchphrase)}”</dd>
      <dt>Eats</dt><dd>${esc(m.eats)}</dd>
      <dt>Chews</dt><dd>${esc(m.chews)}</dd>
      <dt>Spits</dt><dd>${esc(m.spits)}</dd>
    </dl>
  </article>`
    })
    .join('\n')
  const toc = chars.map((ch) => `<a href="#c${ch.meta.num}">${ch.meta.num} ${esc(ch.meta.name)}</a>`).join('')
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Character Concepts</title>
<style>
  :root { --ink:#2b1a14; --paper:#fbf4ea; --card:#ffffff; --muted:#7d6a5f; --line:#2b1a14; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --ink:#f6ebe0; --paper:#1d1714; --card:#2a221e; --muted:#bba99c; --line:#5a4a40; } }
  :root[data-theme="dark"] { --ink:#f6ebe0; --paper:#1d1714; --card:#2a221e; --muted:#bba99c; --line:#5a4a40; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, Inter, sans-serif; }
  main { max-width:1240px; margin:0 auto; padding:32px 16px 64px; }
  h1 { font-size:clamp(28px,4vw,44px); line-height:1.1; margin:0 0 8px; letter-spacing:-0.02em; }
  .lede { color:var(--muted); max-width:72ch; margin:0 0 20px; }
  nav { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 28px; }
  nav a { color:var(--ink); text-decoration:none; font-weight:600; font-size:14px; padding:6px 12px; border:2px solid var(--line); border-radius:999px; background:var(--card); }
  nav a:hover { background:var(--ink); color:var(--paper); }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,540px),1fr)); gap:24px; }
  .card { background:var(--card); border:3px solid var(--line); border-radius:22px; padding:18px; box-shadow:4px 5px 0 var(--line); }
  .card header { display:flex; gap:14px; align-items:center; margin-bottom:12px; }
  .num { flex:none; width:44px; height:44px; border-radius:50%; display:grid; place-items:center; font-weight:900; background:var(--bg2); color:#2b1a14; border:3px solid #2b1a14; }
  h2 { margin:0; font-size:22px; line-height:1.2; }
  .origin { margin:2px 0 0; color:var(--muted); font-size:14px; }
  .poses { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  figure { margin:0; }
  figure svg { display:block; width:100%; height:auto; border-radius:14px; border:2px solid #2b1a14; }
  figcaption { font-size:12px; color:var(--muted); text-align:center; margin-top:4px; }
  dl { display:grid; grid-template-columns:auto 1fr; gap:6px 12px; margin:14px 0 0; font-size:15px; }
  dt { font-weight:800; font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); padding-top:3px; }
  dd { margin:0; }
  .quote { font-style:italic; font-weight:600; }
  footer { margin-top:40px; color:var(--muted); font-size:14px; }
</style>
</head>
<body>
<main>
  <h1>Let us drag! — Motu Uncle + 10 alternative characters</h1>
  <p class="lede">Concept art for a vote. Each character keeps the Uncle’s construction (bold variable-weight ink, flat warm colours, cel shading, layered rig) and has a huge mouth that opens wide to eat files. Left: idle. Right: eating, eyes up-left on the incoming file.</p>
  <nav>${toc}</nav>
  <section class="grid">
${cards}
  </section>
  <footer>Source SVGs and PNG renders live next to this page in <code>docs/art/characters/</code>. Regenerate with <code>node docs/art/characters/_build/render.mjs</code>.</footer>
</main>
</body>
</html>
`
  writeFileSync(join(out, 'storyboard.html'), html)
}
