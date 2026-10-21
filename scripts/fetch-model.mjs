// Downloads the Remove-BG model (isnet-general-use.onnx, as distributed by the rembg project),
// prints its SHA-256 and checks it against the pinned value in src/engine/tools/model.ts.
// Used by CI (then: LUD_MODEL_PATH=<printed path> npm test) and before mirroring the file to our
// own GitHub release "models-v1".
//
// Usage: node scripts/fetch-model.mjs [outDir] [--url <url>] [--no-verify]
//   outDir defaults to node_modules/.cache/lud-models (git-ignored).
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const UPSTREAM_URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx'
const FILE = 'isnet-general-use.onnx'

/** Read the pinned SHA-256 from the engine source so there is a single source of truth. */
function pinnedSha256() {
  const src = readFileSync(join(root, 'src', 'engine', 'tools', 'model.ts'), 'utf8')
  const m = /export const MODEL_SHA256 = '([0-9a-f]{64})'/.exec(src)
  return m ? m[1] : undefined
}

const args = process.argv.slice(2)
const urlIdx = args.indexOf('--url')
const url = urlIdx >= 0 ? args[urlIdx + 1] : UPSTREAM_URL
const verify = !args.includes('--no-verify')
const positional = args.filter((a, i) => !a.startsWith('--') && !(urlIdx >= 0 && i === urlIdx + 1))
const outDir = resolve(positional[0] ?? join(root, 'node_modules', '.cache', 'lud-models'))
const target = join(outDir, FILE)
const part = `${target}.part`

mkdirSync(outDir, { recursive: true })
const res = await fetch(url, { redirect: 'follow' })
if (!res.ok || !res.body) {
  console.error(`GET ${url} -> HTTP ${res.status}`)
  process.exit(1)
}
const total = Number(res.headers.get('content-length')) || 0
const hash = createHash('sha256')
let received = 0
let lastPct = -1
const meter = new Transform({
  transform(chunk, _enc, cb) {
    hash.update(chunk)
    received += chunk.length
    const pct = total ? Math.floor((received / total) * 100) : -1
    if (pct !== lastPct && pct % 10 === 0) {
      lastPct = pct
      process.stderr.write(`  ${pct}%\n`)
    }
    cb(null, chunk)
  }
})
try {
  await pipeline(Readable.fromWeb(res.body), meter, createWriteStream(part))
} catch (err) {
  rmSync(part, { force: true })
  throw err
}
const sha = hash.digest('hex')
const pinned = pinnedSha256()
console.log(`${FILE} bytes=${received} sha256=${sha}`)
if (verify && pinned && pinned !== sha) {
  rmSync(part, { force: true })
  console.error(`SHA-256 mismatch: pinned ${pinned}, got ${sha}`)
  process.exit(1)
}
if (existsSync(target)) rmSync(target)
renameSync(part, target)
console.log(`${pinned ? (pinned === sha ? 'verified' : 'NOT VERIFIED') : 'NOT PINNED'}: ${target}`)
