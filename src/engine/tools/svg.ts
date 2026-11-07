// SVG input (TPM decision D30). An SVG is a program-like XML document: it can carry scripts, event
// handlers, foreign HTML, external references (href, url(), @import), DOCTYPE entities (XXE,
// "billion laughs") and reference bombs (<use> of <use> of …). Nothing renders the user's file
// as is. Instead:
//   1. a small, strict XML parser (no DTD processing, no external entities: a DOCTYPE may only
//      declare plain literal entities, which are expanded by us under a total cap) builds a tree,
//   2. an ALLOW-LIST re-serializer keeps only static drawing elements and plain attributes:
//      no script/foreignObject/animation/metadata/unknown or namespaced elements, no on* handlers,
//      href only "#fragment" (plus inline raster data: images on <image>/<feImage>), url() only
//      "url(#fragment)", no @import, no CSS escapes, no xml:base,
//   3. size caps: input bytes, element count, nesting depth, attributes, expanded reference cost,
//   4. the clean markup is rendered either by librsvg (sharp, from a BUFFER: librsvg resolves no
//      URL without a base file, so it cannot read files or the network even if something slipped
//      through) for PNG/JPG, or as an <img src="data:image/svg+xml…"> through the sandboxed
//      Chromium printToPDF (SVG-as-image mode never loads anything or runs script, and the print
//      window blocks every request) for a vector PDF.
import { readFile, stat } from 'node:fs/promises'
import { invalidInput } from '../errors'
import { MAX_SVG_BYTES, formatBytes } from '../limits'

export const SVG_NS = 'http://www.w3.org/2000/svg'
export const XLINK_NS = 'http://www.w3.org/1999/xlink'

/** Caps (also in docs/security/THREAT_MODEL.md, SVG input). */
export const MAX_SVG_ELEMENTS = 50_000
export const MAX_SVG_DEPTH = 256
export const MAX_SVG_ATTRS = 256
export const MAX_SVG_ENTITIES = 64
export const MAX_SVG_ENTITY_CHARS = 1024
/** Elements drawn after expanding every <use>/url(#…)/href="#…" reference (stops reference bombs). */
export const MAX_SVG_EXPANDED = 250_000
/** Raster output: longest side at least / at most / when the SVG states no size. */
export const SVG_MIN_SIDE = 512
export const SVG_MAX_SIDE = 4096
export const SVG_DEFAULT_SIDE = 2048
/** Vector PDF page when the SVG states no size (CSS px, 8 in). Largest page: 14400 pt = 19200 px. */
export const SVG_PDF_DEFAULT_SIDE = 768
export const SVG_PDF_MAX_SIDE = 19_200

const DAMAGED = "I couldn't read this SVG. It may be damaged, or it isn't really an SVG picture."

// ---------------------------------------------------------------------------------------------
// XML parsing

export interface XmlElement {
  name: string
  attrs: [string, string][]
  children: XmlNode[]
}
export type XmlNode = XmlElement | string

const NAME_START = /[A-Za-z_:]/
const NAME_RE = /[A-Za-z_:][-A-Za-z0-9_.:]*/y
const XML_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

interface ParseState {
  entities: Map<string, string>
  /** Characters still allowed to come out of entity expansion. */
  budget: number
}

function decodeXml(s: string, st: ParseState): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z_][-A-Za-z0-9_.]*);/g, (_m, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw invalidInput(DAMAGED, `bad character reference &${body};`)
      return String.fromCodePoint(cp)
    }
    const v = XML_ENTITIES[body] ?? st.entities.get(body)
    if (v === undefined) throw invalidInput(DAMAGED, `undefined entity &${body};`)
    st.budget -= v.length
    if (st.budget < 0) throw invalidInput('This SVG expands into something enormous, so I refused to open it.', 'entity expansion budget exceeded')
    return v
  })
}

/**
 * DOCTYPE: only plain internal entities with literal values are honoured (Illustrator exports use
 * them for namespace URIs). Parameter entities, SYSTEM/PUBLIC (external) entities, values with
 * references or markup, and too many/too long entities are refused. Everything else in the
 * internal subset (ELEMENT/ATTLIST declarations, including attribute defaults) is ignored.
 */
function parseDoctype(src: string, from: number, st: ParseState): number {
  let i = from + 9 // "<!DOCTYPE"
  let subsetStart = -1
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '[') {
      subsetStart = i + 1
      break
    }
    if (c === '>') return i + 1
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1)
      if (end < 0) break
      i = end
    }
  }
  if (subsetStart < 0) throw invalidInput(DAMAGED, 'unterminated DOCTYPE')
  const subsetEnd = src.indexOf(']', subsetStart)
  if (subsetEnd < 0) throw invalidInput(DAMAGED, 'unterminated DOCTYPE subset')
  const close = /\s*>/y
  close.lastIndex = subsetEnd + 1
  if (!close.test(src)) throw invalidInput(DAMAGED, 'malformed DOCTYPE')
  const subset = src.slice(subsetStart, subsetEnd).replace(/<!--[\s\S]*?-->/g, '')
  const decls = subset.match(/<!ENTITY[\s\S]*?>/g) ?? []
  if (decls.length > MAX_SVG_ENTITIES) throw invalidInput('This SVG declares too many entities, so I refused to open it.')
  if (/%/.test(subset)) throw invalidInput('This SVG uses parameter entities, which I refuse to read (they can pull in other files).')
  for (const d of decls) {
    const m = /^<!ENTITY\s+([A-Za-z_][-A-Za-z0-9_.]*)\s+(?:"([^"]*)"|'([^']*)')\s*>$/.exec(d)
    if (!m) throw invalidInput('This SVG declares an external or unusual entity, which I refuse to read.', d.slice(0, 120))
    const value = m[2] ?? m[3] ?? ''
    if (/[&<]/.test(value) || value.length > MAX_SVG_ENTITY_CHARS) {
      throw invalidInput('This SVG uses nested or oversized entities (a classic "billion laughs" trick), so I refused to open it.')
    }
    if (!st.entities.has(m[1]!)) st.entities.set(m[1]!, value)
  }
  return close.lastIndex
}

/** Parse XML into a tree. Throws INPUT_INVALID for malformed or over-limit documents. */
export function parseXml(src: string): XmlElement {
  const st: ParseState = { entities: new Map(), budget: Math.max(1_000_000, src.length) }
  const root: XmlElement = { name: '#document', attrs: [], children: [] }
  const stack: XmlElement[] = [root]
  let elements = 0
  let i = 0
  const n = src.length
  let sawDoctype = false
  while (i < n) {
    const lt = src.indexOf('<', i)
    const textEnd = lt < 0 ? n : lt
    if (textEnd > i) {
      const raw = src.slice(i, textEnd)
      if (stack.length > 1) stack[stack.length - 1]!.children.push(decodeXml(raw, st))
      else if (raw.trim()) throw invalidInput(DAMAGED, 'text outside the root element')
    }
    if (lt < 0) break
    i = lt
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4)
      if (end < 0) throw invalidInput(DAMAGED, 'unterminated comment')
      i = end + 3
    } else if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9)
      if (end < 0) throw invalidInput(DAMAGED, 'unterminated CDATA')
      if (stack.length > 1) stack[stack.length - 1]!.children.push(src.slice(i + 9, end))
      i = end + 3
    } else if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2)
      if (end < 0) throw invalidInput(DAMAGED, 'unterminated processing instruction')
      i = end + 2
    } else if (/^<!DOCTYPE/i.test(src.slice(i, i + 9))) {
      if (sawDoctype || stack.length > 1) throw invalidInput(DAMAGED, 'misplaced DOCTYPE')
      sawDoctype = true
      i = parseDoctype(src, i, st)
    } else if (src[i + 1] === '!') {
      throw invalidInput(DAMAGED, 'unexpected markup declaration')
    } else if (src[i + 1] === '/') {
      NAME_RE.lastIndex = i + 2
      const m = NAME_RE.exec(src)
      const end = src.indexOf('>', i + 2)
      if (!m || end < 0 || src.slice(NAME_RE.lastIndex, end).trim()) throw invalidInput(DAMAGED, 'malformed end tag')
      const open = stack.pop()
      if (!open || open === root || open.name !== m[0]) throw invalidInput(DAMAGED, `mismatched </${m[0]}>`)
      i = end + 1
    } else {
      NAME_RE.lastIndex = i + 1
      const m = NAME_START.test(src[i + 1] ?? '') ? NAME_RE.exec(src) : null
      if (!m) throw invalidInput(DAMAGED, 'stray "<"')
      if (stack.length === 1 && root.children.length > 0) throw invalidInput(DAMAGED, 'more than one root element')
      const el: XmlElement = { name: m[0], attrs: [], children: [] }
      let j = NAME_RE.lastIndex
      let selfClosing = false
      const seen = new Set<string>()
      for (;;) {
        const ws = /\s*/y
        ws.lastIndex = j
        ws.test(src)
        j = ws.lastIndex
        if (src.startsWith('/>', j)) {
          selfClosing = true
          j += 2
          break
        }
        if (src[j] === '>') {
          j++
          break
        }
        NAME_RE.lastIndex = j
        const an = NAME_RE.exec(src)
        if (!an || an.index !== j) throw invalidInput(DAMAGED, 'malformed attribute')
        const eq = /\s*=\s*(["'])/y
        eq.lastIndex = NAME_RE.lastIndex
        const q = eq.exec(src)
        if (!q) throw invalidInput(DAMAGED, 'attribute without a quoted value')
        const close = src.indexOf(q[1]!, eq.lastIndex)
        if (close < 0) throw invalidInput(DAMAGED, 'unterminated attribute value')
        const raw = src.slice(eq.lastIndex, close)
        if (raw.includes('<')) throw invalidInput(DAMAGED, '"<" in an attribute value')
        if (seen.has(an[0])) throw invalidInput(DAMAGED, `duplicate attribute ${an[0]}`)
        seen.add(an[0])
        if (el.attrs.length >= MAX_SVG_ATTRS) throw invalidInput('This SVG has elements with too many attributes, so I refused to open it.')
        // Attribute value normalisation (XML 1.0 §3.3.3): whitespace characters become spaces.
        el.attrs.push([an[0], decodeXml(raw, st).replace(/[\t\n\r]/g, ' ')])
        j = close + 1
      }
      if (++elements > MAX_SVG_ELEMENTS) throw invalidInput(`This SVG has more than ${MAX_SVG_ELEMENTS.toLocaleString('en-US')} parts, so I refused to open it.`)
      stack[stack.length - 1]!.children.push(el)
      if (!selfClosing) {
        stack.push(el)
        if (stack.length - 1 > MAX_SVG_DEPTH) throw invalidInput('This SVG is nested too deeply, so I refused to open it.')
      }
      i = j
    }
  }
  if (stack.length !== 1) throw invalidInput(DAMAGED, 'unclosed element')
  const top = root.children.find((c): c is XmlElement => typeof c !== 'string')
  if (!top) throw invalidInput(DAMAGED, 'no root element')
  return top
}

// ---------------------------------------------------------------------------------------------
// Sanitizing (allow-list)

const FILTER_PRIMITIVES = [
  'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting',
  'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR',
  'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight',
  'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence'
]

/**
 * Static drawing elements that are kept. Everything else is dropped WITH its content: script,
 * foreignObject, animate/set/animateMotion/animateTransform (they can rewrite href/url to external
 * targets), metadata, iframe/video/audio, cursor, font/glyph (SVG fonts), and any unknown or
 * namespaced element (sodipodi:*, inkscape:*, svg:*). <a> is unwrapped into <g> (links are useless
 * in a picture).
 */
export const SVG_ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'switch', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath', 'title', 'desc', 'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath',
  'mask', 'marker', 'filter', 'image', 'style', 'view', 'a', ...FILTER_PRIMITIVES
])

/** Elements whose href may be an inline raster image (data:image/png|jpeg|gif|webp;base64). */
const RASTER_HREF_ELEMENTS = new Set(['image', 'feImage'])
/** Elements that are useless (or unsafe) without a valid href. */
const NEEDS_HREF = new Set(['use', 'image', 'feImage'])

const FRAGMENT_RE = /^#[A-Za-z_][-A-Za-z0-9_.:]*$/
const RASTER_DATA_RE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]*$/i

/** Allowed href values: an in-document "#id", or (on image/feImage) an inline raster data: URL. */
export function safeSvgHref(element: string, value: string): string | undefined {
  const v = value.trim()
  if (FRAGMENT_RE.test(v)) return v
  if (RASTER_HREF_ELEMENTS.has(element) && RASTER_DATA_RE.test(v)) return v.replace(/\s+/g, '')
  return undefined
}

/**
 * CSS (style attribute, <style> element, presentation attribute values) that can never load
 * anything: CSS escapes are refused outright (they could spell "url(" or "@import" in disguise),
 * @import rules are removed, url() only keeps "#fragment" targets, and every other function that
 * takes a URL or string resource (image-set, image, cross-fade, element, src, paint) is disabled.
 * Returns undefined when the text cannot be made safe (the caller drops it).
 */
export function sanitizeSvgCss(css: string): string | undefined {
  if (css.includes('\\')) return undefined
  let out = css.replace(/\/\*[\s\S]*?(\*\/|$)/g, ' ')
  out = out.replace(/@import\b[^;]*(;|$)/gi, '')
  out = out.replace(/@namespace\b[^;]*(;|$)/gi, '')
  // Safe url(#id) are parked as NUL-delimited tokens (NUL cannot occur: readSvg refuses NUL bytes
  // and the XML parser refuses &#0;) so the check below sees only what is left over.
  const kept: string[] = []
  out = out.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (_m, _q: string, target: string) => {
    if (!FRAGMENT_RE.test(target.trim())) return 'none'
    kept.push(`url(${target.trim()})`)
    return `\u0000${kept.length - 1}\u0000`
  })
  if (out.includes('\u0000') && kept.length === 0) return undefined
  if (/url\s*\(|@import/i.test(out)) return undefined // unbalanced or odd forms
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => kept[Number(i)]!)
  const resourceFn = /(?:^|[^-\w])(?:-webkit-|-moz-)?(?:image-set|image|cross-fade|element|src|paint)\s*\([^()]*\)/gi
  out = out.replace(resourceFn, (m) => `${/^[^-\w]/.test(m) ? m[0] : ''}none`)
  if (/(?:image-set|image|cross-fade|element|src|paint)\s*\(/i.test(out)) return undefined
  out = out.replace(/expression\s*\(/gi, 'invalid(').replace(/behavior\s*:/gi, 'invalid:').replace(/-moz-binding\s*:/gi, 'invalid:')
  return out
}

const ATTR_NAME_RE = /^[A-Za-z][-A-Za-z0-9]*$/

/** Sanitized attributes for an element (href is returned separately). */
function sanitizeAttrs(element: string, attrs: readonly [string, string][]): { attrs: [string, string][]; href?: string } {
  const out: [string, string][] = []
  let href: string | undefined
  let xlinkHref: string | undefined
  for (const [name, value] of attrs) {
    if (name === 'href') href = value
    else if (name === 'xlink:href') xlinkHref = value
    else if (name === 'xml:space') out.push([name, value === 'preserve' ? 'preserve' : 'default'])
    else if (name === 'xmlns' || !ATTR_NAME_RE.test(name)) continue // xmlns*, xml:base, sodipodi:*, …
    else if (/^on/i.test(name)) continue
    else if (name === 'style') {
      const css = sanitizeSvgCss(value)
      if (css !== undefined && css.trim()) out.push([name, css])
    } else if (/url\s*\(|\\|@import/i.test(value)) {
      const css = sanitizeSvgCss(value)
      if (css !== undefined) out.push([name, css])
    } else out.push([name, value])
  }
  const raw = href ?? xlinkHref // SVG 2: href wins over xlink:href
  const safe = raw === undefined ? undefined : safeSvgHref(element, raw)
  return safe === undefined ? { attrs: out } : { attrs: out, href: safe }
}

function sanitizeElement(el: XmlElement): XmlElement | undefined {
  if (!SVG_ALLOWED_ELEMENTS.has(el.name)) return undefined
  const name = el.name === 'a' ? 'g' : el.name
  if (name === 'style') {
    const css = sanitizeSvgCss(el.children.filter((c): c is string => typeof c === 'string').join(''))
    return css === undefined || !css.trim() ? undefined : { name, attrs: [], children: [css] }
  }
  const { attrs, href } = sanitizeAttrs(el.name, el.attrs)
  if (NEEDS_HREF.has(name) && href === undefined) return undefined
  if (href !== undefined && el.name !== 'a') attrs.push(['xlink:href', href])
  const children: XmlNode[] = []
  for (const c of el.children) {
    if (typeof c === 'string') children.push(c)
    else {
      const s = sanitizeElement(c)
      if (s) children.push(s)
    }
  }
  return { name, attrs, children }
}

/** Elements that would be drawn after expanding every #id reference; throws over the cap or on cycles. */
export function expandedCost(root: XmlElement, max = MAX_SVG_EXPANDED): number {
  const byId = new Map<string, XmlElement>()
  const walk = (el: XmlElement): void => {
    const id = el.attrs.find(([n]) => n === 'id')?.[1]
    if (id !== undefined && !byId.has(id)) byId.set(id, el)
    for (const c of el.children) if (typeof c !== 'string') walk(c)
  }
  walk(root)
  const memo = new Map<XmlElement, number>()
  const active = new Set<XmlElement>()
  const tooBig = (): never => {
    throw invalidInput('This SVG repeats its parts so many times that it would never finish drawing, so I refused to open it.')
  }
  const cost = (el: XmlElement): number => {
    const known = memo.get(el)
    if (known !== undefined) return known
    if (active.has(el)) throw invalidInput('This SVG refers to itself in a loop, so I refused to open it.')
    active.add(el)
    // Reference chains (a uses b uses c …) recurse: stay far below the JS stack limit.
    if (active.size > MAX_SVG_DEPTH * 4) throw invalidInput('This SVG chains its parts too deeply, so I refused to open it.')
    let total = 1
    for (const [, v] of el.attrs) {
      for (const m of v.matchAll(/(?:^|url\()#([A-Za-z_][-A-Za-z0-9_.:]*)/g)) {
        const target = byId.get(m[1]!)
        if (target) total += cost(target)
        if (total > max) tooBig()
      }
    }
    for (const c of el.children) {
      if (typeof c !== 'string') total += cost(c)
      if (total > max) tooBig()
    }
    active.delete(el)
    memo.set(el, total)
    return total
  }
  return cost(root)
}

// ---------------------------------------------------------------------------------------------
// Size

const UNIT_PX: Readonly<Record<string, number>> = { '': 1, px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, ex: 8 }

/** "12.5mm" → px; undefined for percentages, zero/negative or unparseable lengths. */
export function parseLength(v: string | undefined): number | undefined {
  if (v === undefined) return undefined
  const m = /^\s*([+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in|em|ex)?\s*$/i.exec(v)
  if (!m) return undefined
  const n = Number(m[1]) * UNIT_PX[(m[2] ?? '').toLowerCase()]!
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function parseViewBox(v: string | undefined): [number, number, number, number] | undefined {
  if (v === undefined) return undefined
  const parts = v.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || !parts.every(Number.isFinite) || parts[2]! <= 0 || parts[3]! <= 0) return undefined
  return parts as [number, number, number, number]
}

export interface SvgSize {
  width: number
  height: number
  /** True when the SVG states an absolute width/height (else the size came from viewBox / defaults). */
  sized: boolean
}

/** Natural size in CSS px: width/height, else the viewBox aspect, else the CSS default 300×150. */
export function naturalSize(width: string | undefined, height: string | undefined, viewBox: string | undefined): SvgSize {
  const w = parseLength(width)
  const h = parseLength(height)
  const vb = parseViewBox(viewBox)
  const aspect = vb ? vb[2] / vb[3] : undefined
  if (w && h) return { width: w, height: h, sized: true }
  if (w && aspect) return { width: w, height: w / aspect, sized: true }
  if (h && aspect) return { width: h * aspect, height: h, sized: true }
  if (vb) return { width: vb[2], height: vb[3], sized: false }
  return { width: w ?? 300, height: h ?? 150, sized: false }
}

/** Scale `size` so its longest side is `target` (or within [min, max]); never below 1 px. */
function fitSide(size: SvgSize, opts: { target?: number; min: number; max: number }): { width: number; height: number } {
  const longest = Math.max(size.width, size.height)
  let scale = 1
  if (opts.target !== undefined) scale = opts.target / longest
  else if (longest < opts.min) scale = opts.min / longest
  else if (longest > opts.max) scale = opts.max / longest
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }
}

/** PNG/JPG pixel size: natural size with the longest side in [512, 4096]; 2048 when the SVG states no size. */
export function rasterSize(size: SvgSize): { width: number; height: number } {
  return fitSide(size, size.sized ? { min: SVG_MIN_SIDE, max: SVG_MAX_SIDE } : { target: SVG_DEFAULT_SIDE, min: 0, max: Infinity })
}

/** PDF page size in CSS px: the natural size (≤ 19200 px a side); 768 px longest side when unsized. */
export function pdfPageSize(size: SvgSize): { width: number; height: number } {
  return fitSide(size, size.sized ? { min: 1, max: SVG_PDF_MAX_SIDE } : { target: SVG_PDF_DEFAULT_SIDE, min: 0, max: Infinity })
}

// ---------------------------------------------------------------------------------------------
// Public API

export interface SafeSvg {
  /** Sanitized root (attributes without width/height/viewBox/x/y; see render()). */
  root: XmlElement
  /** viewBox to render with (the original one, or "0 0 w h" of the natural size). */
  viewBox: string
  size: SvgSize
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeXmlAttr(s: string): string {
  return escapeXmlText(s).replace(/"/g, '&quot;')
}

function serialize(el: XmlElement): string {
  const attrs = el.attrs.map(([n, v]) => ` ${n}="${escapeXmlAttr(v)}"`).join('')
  if (el.children.length === 0) return `<${el.name}${attrs}/>`
  return `<${el.name}${attrs}>${el.children.map((c) => (typeof c === 'string' ? escapeXmlText(c) : serialize(c))).join('')}</${el.name}>`
}

/** Parse + sanitize SVG text (throws INPUT_INVALID when it is not a usable SVG). */
export function sanitizeSvg(text: string): SafeSvg {
  const parsed = parseXml(text.replace(/^﻿/, ''))
  if (parsed.name !== 'svg') throw invalidInput("This file doesn't contain an SVG picture.", `root element <${parsed.name}>`)
  const clean = sanitizeElement(parsed)!
  const get = (n: string): string | undefined => parsed.attrs.find(([k]) => k === n)?.[1]
  const size = naturalSize(get('width'), get('height'), get('viewBox'))
  const vb = parseViewBox(get('viewBox'))
  const viewBox = vb ? vb.join(' ') : `0 0 ${size.width} ${size.height}`
  clean.attrs = clean.attrs.filter(([n]) => !['width', 'height', 'viewBox', 'x', 'y', 'version', 'baseProfile'].includes(n))
  expandedCost(clean)
  return { root: clean, viewBox, size }
}

/** Serialize the sanitized SVG with an explicit pixel size (the only markup any renderer sees). */
export function renderSvgMarkup(svg: SafeSvg, width: number, height: number): string {
  const root: XmlElement = {
    ...svg.root,
    attrs: [
      ['xmlns', SVG_NS],
      ['xmlns:xlink', XLINK_NS],
      ['width', String(width)],
      ['height', String(height)],
      ['viewBox', svg.viewBox],
      ...svg.root.attrs
    ]
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(root)}\n`
}

/** Read and sanitize an SVG file (size-capped, UTF-8, must look like XML). */
export async function readSvg(path: string): Promise<SafeSvg> {
  const { size } = await stat(path)
  if (size > MAX_SVG_BYTES) throw invalidInput(`This SVG is larger than ${formatBytes(MAX_SVG_BYTES)}, which is more than I can chew.`)
  const buf = await readFile(path)
  if (buf.includes(0)) throw invalidInput(DAMAGED, 'NUL byte (binary or UTF-16)')
  const text = buf.toString('utf8')
  if (!/^﻿?\s*</.test(text)) throw invalidInput(DAMAGED, 'does not start with markup')
  return sanitizeSvg(text)
}

/** Rasterize with librsvg (sharp, from a buffer: no base URL, so no file or network access). */
export async function svgToRaster(svg: SafeSvg, format: 'png' | 'jpg', outPath: string): Promise<{ width: number; height: number }> {
  const { rasterizeSvgBuffer } = await import('./sharp-safe')
  const { width, height } = rasterSize(svg.size)
  await rasterizeSvgBuffer(Buffer.from(renderSvgMarkup(svg, width, height), 'utf8'), format, outPath)
  return { width, height }
}

/**
 * HTML for a one-page, vector PDF: the sanitized SVG as an <img> data URL (SVG-as-image: no script,
 * no external loads) on a page exactly its size. Goes through text.renderPdf (sanitizer + CSP).
 */
export function svgPdfHtml(svg: SafeSvg): string {
  const { width, height } = pdfPageSize(svg.size)
  const data = Buffer.from(renderSvgMarkup(svg, width, height), 'utf8').toString('base64')
  return `<style>
@page { size: ${width}px ${height}px; margin: 0; }
html, body { margin: 0; padding: 0; max-width: none; width: ${width}px; height: ${height}px; overflow: hidden; }
img.lud-svg { display: block; width: ${width}px; height: ${height}px; max-width: none; }
</style>
<img class="lud-svg" alt="" width="${width}" height="${height}" src="data:image/svg+xml;base64,${data}">`
}
