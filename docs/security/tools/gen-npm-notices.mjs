// Generates the npm part of THIRD_PARTY_NOTICES.md from what a packaged app really ships.
// Owner: Security analyst. Not part of the app or of the build; run by hand before a release.
//
// Usage:
//   1. npm run build && npx electron-builder --linux dir --x64 --publish never -c.directories.output=<tmp>
//   2. npx @electron/asar extract <tmp>/linux-unpacked/resources/app.asar <tmp>/asar-x
//      (asar extract also copies the app.asar.unpacked files)
//   3. node docs/security/tools/gen-npm-notices.mjs <tmp>/asar-x THIRD_PARTY_NOTICES.md
//
// The script replaces the text between the BEGIN/END markers in the notices file. It lists every
// directory under node_modules that has a package.json (including nested copies), with the
// declared licence, and appends every licence/notice file verbatim (identical texts are printed once).
// Packages that ship no licence file get the standard text of their declared licence, with the
// package author as the copyright holder. Platform-specific packages that are not in a Linux
// build (sharp/libvips for macOS and Windows, onnxruntime DLLs) are covered by hand in the notices.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const [appDir, noticesPath] = process.argv.slice(2)
if (!appDir || !noticesPath) {
  console.error('usage: node gen-npm-notices.mjs <extracted-app-dir> <THIRD_PARTY_NOTICES.md>')
  process.exit(2)
}
const BEGIN = '<!-- BEGIN GENERATED NPM NOTICES (docs/security/tools/gen-npm-notices.mjs) -->'
const END = '<!-- END GENERATED NPM NOTICES -->'
const LICENSE_FILE = /^(licen[cs]e|copying|notice|authors)([._-].*)?$/i

const STANDARD = {
  MIT: (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  ISC: (holder) => `ISC License

Copyright (c) ${holder}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`
}
STANDARD['MIT/X11'] = STANDARD.MIT

// Copyright holders where package.json "author" is a maintainer handle, not the holder (checked by hand).
const HOLDER_OVERRIDES = {
  'onnxruntime-common': 'Microsoft Corporation',
  'onnxruntime-node': 'Microsoft Corporation',
  'onnxruntime-web': 'Microsoft Corporation'
}

function personName(author) {
  if (!author) return undefined
  if (typeof author === 'string') return author.replace(/\s*[<(].*$/, '').trim()
  return author.name
}

function findPackages(dir, out = []) {
  const nm = join(dir, 'node_modules')
  if (!existsSync(nm)) return out
  for (const entry of readdirSync(nm)) {
    if (entry.startsWith('.')) continue
    const scoped = entry.startsWith('@')
    const dirs = scoped ? readdirSync(join(nm, entry)).map((e) => join(nm, entry, e)) : [join(nm, entry)]
    for (const d of dirs) {
      if (!statSync(d).isDirectory()) continue
      if (existsSync(join(d, 'package.json'))) out.push(d)
      findPackages(d, out)
    }
  }
  return out
}

const rows = []
const texts = new Map() // normalised text -> { id, text, users: [] }
for (const dir of findPackages(appDir)) {
  const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  if (!pj.name || !pj.version) continue // nested helper package.json files (e.g. "type": "module" markers)
  const declared = pj.license ?? (Array.isArray(pj.licenses) ? pj.licenses.map((l) => l.type).join(' OR ') : undefined) ?? 'NONE DECLARED'
  const files = readdirSync(dir).filter((f) => LICENSE_FILE.test(f) && statSync(join(dir, f)).isFile())
  const id = `${pj.name}@${pj.version}`
  const refs = []
  const bodies = files.map((f) => readFileSync(join(dir, f), 'utf8'))
  if (bodies.length === 0) {
    const make = STANDARD[declared]
    const holder = HOLDER_OVERRIDES[pj.name] ?? personName(pj.author) ?? `the ${pj.name} authors`
    bodies.push(
      make
        ? `${make(holder)}\n\n[No licence file in the package: standard ${declared} text; copyright holder from package.json "author"${HOLDER_OVERRIDES[pj.name] ? ' (corrected by hand)' : ''}.]`
        : `[No licence file in the package and no standard text for "${declared}". See the main notices.]`
    )
  }
  for (const body of bodies) {
    const key = body.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim()
    let t = texts.get(key)
    if (!t) {
      t = { id: `L${texts.size + 1}`, text: key, users: [] }
      texts.set(key, t)
    }
    t.users.push(id)
    refs.push(t.id)
  }
  const repo = typeof pj.repository === 'string' ? pj.repository : (pj.repository?.url ?? '')
  rows.push({ id, name: pj.name, version: pj.version, declared, refs, where: relative(appDir, dir).replace(/\\/g, '/'), repo })
}
rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true }))

const esc = (s) => String(s).replace(/\|/g, '\\|')
const lines = []
lines.push(BEGIN, '')
lines.push(`Generated from a packaged Linux x64 build: ${rows.length} package directories, ${texts.size} distinct licence texts.`, '')
lines.push('| Package | Version | Declared licence | Licence text(s) | Source repository |', '|---|---|---|---|---|')
for (const r of rows) {
  const repo = r.repo.replace(/^git\+/, '').replace(/\.git$/, '')
  lines.push(`| ${esc(r.name)} | ${esc(r.version)} | ${esc(r.declared)} | ${r.refs.join(', ')} | ${esc(repo)} |`)
}
lines.push('', '### npm licence texts', '')
for (const t of texts.values()) {
  const users = [...new Set(t.users)].sort()
  lines.push(`#### ${t.id}`, '', `Used by: ${users.join(', ')}`, '', '```text', t.text.replace(/```/g, "'''"), '```', '')
}
lines.push(END)

const notices = readFileSync(noticesPath, 'utf8')
const a = notices.indexOf(BEGIN)
const b = notices.indexOf(END)
if (a < 0 || b < a) throw new Error(`markers not found in ${noticesPath}`)
writeFileSync(noticesPath, notices.slice(0, a) + lines.join('\n') + notices.slice(b + END.length))
console.log(`wrote ${rows.length} packages, ${texts.size} licence texts into ${noticesPath}`)
