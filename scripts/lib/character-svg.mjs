// Character art sanitiser (pure string → string) + the Vite plugin that applies it at build time.
//
// The character SVGs are our own files (docs/art/characters), but they are inlined into the app's
// DOM, so they go through an allowlist anyway: only plain shape/paint elements survive, no scripts,
// <foreignObject>, <style>, <image>, <use>, event handlers, external references or comments.
// Groups named in `dropParts` (default: the concept art's flying file, `fileIncoming`; the Stage
// draws its own) are removed with their content.
//
// Used by scripts/sync-characters.mjs (files copied into src/renderer/characters are already
// clean) and by the Vite plugin below (`import svg from './idle.svg?character'`), so a raw file
// copy of new art is sanitised again when the renderer is built.
import { readFileSync } from 'node:fs'

const ALLOWED = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'defs',
  'clipPath',
  'mask',
  'linearGradient',
  'radialGradient',
  'stop',
  'text',
  'tspan'
])

const ROOT_ATTRS = new Set(['xmlns', 'viewBox'])

export const DEFAULT_DROP_PARTS = ['fileIncoming']

/** Is this attribute (name, value) safe to keep? */
function keepAttr(name, value) {
  const n = name.toLowerCase()
  if (n.startsWith('on')) return false
  if (n === 'style') return false
  if (n === 'href' || n === 'xlink:href') return value.trim().startsWith('#')
  if (n.startsWith('xmlns:') || n.startsWith('xml:')) return false
  // url(...) references must stay inside the document.
  for (const m of value.matchAll(/url\(\s*['"]?([^'")]*)/gi)) if (!m[1].trim().startsWith('#')) return false
  if (/javascript:|data:/i.test(value)) return false
  return true
}

function parseAttrs(src) {
  const out = []
  for (const m of src.matchAll(/([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out.push([m[1], m[2] ?? m[3] ?? ''])
  return out
}

const esc = (v) => v.replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

/**
 * Sanitise a character SVG. Returns `<svg xmlns viewBox>…</svg>` (no width/height/title).
 * Throws when the input has no <svg> root or a viewBox.
 */
export function sanitizeCharacterSvg(src, { dropParts = DEFAULT_DROP_PARTS } = {}) {
  const drop = new Set(dropParts)
  const s = String(src)
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
  const out = []
  // Depth of an element being skipped (disallowed or dropped), with its tag name; 0 = not skipping.
  let skip = 0
  let sawRoot = false
  let viewBox = null
  const tagRe = /<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g
  let last = 0
  for (let m = tagRe.exec(s); m; m = tagRe.exec(s)) {
    const text = s.slice(last, m.index)
    last = tagRe.lastIndex
    if (!skip && sawRoot && text.trim()) out.push(esc(text.replace(/\s+/g, ' ')))
    const [, close, tag, attrSrc, selfClose] = m
    if (close) {
      if (skip) {
        skip--
        continue
      }
      if (ALLOWED.has(tag)) out.push(`</${tag}>`)
      continue
    }
    if (skip) {
      if (!selfClose) skip++
      continue
    }
    const attrs = parseAttrs(attrSrc)
    const part = attrs.find(([k]) => k === 'data-part')?.[1]
    if (!ALLOWED.has(tag) || (part && drop.has(part))) {
      if (!selfClose) skip = 1
      continue
    }
    let kept
    if (tag === 'svg' && !sawRoot) {
      sawRoot = true
      viewBox = attrs.find(([k]) => k === 'viewBox')?.[1] ?? null
      kept = [['xmlns', 'http://www.w3.org/2000/svg'], ...attrs.filter(([k]) => ROOT_ATTRS.has(k) && k !== 'xmlns')]
    } else {
      kept = attrs.filter(([k, v]) => keepAttr(k, v))
    }
    out.push(`<${tag}${kept.map(([k, v]) => ` ${k}="${esc(v)}"`).join('')}${selfClose ? '/' : ''}>`)
  }
  if (!sawRoot) throw new Error('character svg: no <svg> root element')
  if (!viewBox) throw new Error('character svg: the <svg> root has no viewBox')
  return out.join('').replace(/>\s+</g, '><')
}

/** Problems that would make an SVG unsafe to inline (empty = OK). For tests and the sync script. */
export function svgProblems(svg) {
  const problems = []
  if (/<script|<foreignObject|<iframe|<image|<use\b|<style|<!--/i.test(svg)) problems.push('forbidden element or comment')
  if (/\son[a-z]+\s*=/i.test(svg)) problems.push('event handler attribute')
  if (/(?:href|url\()\s*=?\s*["']?(?!#)[a-z]+:/i.test(svg) || /javascript:/i.test(svg)) problems.push('external reference')
  return problems
}

/** Inner markup of a sanitised SVG and its viewBox. */
export function splitSvg(svg) {
  const m = /^<svg([^>]*)>([\s\S]*)<\/svg>$/.exec(svg.trim())
  if (!m) throw new Error('not a sanitised svg')
  const vb = /viewBox="([^"]*)"/.exec(m[1])?.[1] ?? ''
  return { viewBox: vb, inner: m[2] }
}

/** Vite plugin: `import svg from './x.svg?character'` → the sanitised markup as a string. */
export function characterSvgPlugin() {
  const SUFFIX = '?character'
  return {
    name: 'lud-character-svg',
    enforce: 'pre',
    load(id) {
      if (!id.endsWith('.svg' + SUFFIX)) return null
      const file = id.slice(0, -SUFFIX.length)
      this.addWatchFile?.(file)
      return `export default ${JSON.stringify(sanitizeCharacterSvg(readFileSync(file, 'utf8')))}`
    }
  }
}
