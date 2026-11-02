// Downloads a Remove-BG model from its primary source (the same one the app uses first, TPM
// decisions D10/D25), prints its SHA-256 and checks it against the pinned value in
// src/engine/tools/model.ts. Used by CI and developers to get a local copy
// (then: LUD_MODEL_PATH=<printed path> npm test; the model kind follows from the file name).
//   --model birefnet-lite (default): BiRefNet_lite from the author's GitHub release (MIT).
//   --model isnet: ISNet from the rembg release (wasm fallback / low-memory model). We do NOT
//     mirror the ISNet weights in our releases (D10: their license is not stated upstream).
//
// Usage: node scripts/fetch-model.mjs [outDir] [--model birefnet-lite|isnet] [--url <url>] [--no-verify]
//   outDir defaults to node_modules/.cache/lud-models (git-ignored).
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const MODELS = {
  'birefnet-lite': {
    file: 'BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx',
    url: 'https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx',
    shaConst: 'BIREFNET_LITE_SHA256'
  },
  isnet: {
    file: 'isnet-general-use.onnx',
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
    shaConst: 'ISNET_SHA256'
  }
}

/** Read the pinned SHA-256 from the engine source so there is a single source of truth. */
function pinnedSha256(name) {
  const src = readFileSync(join(root, 'src', 'engine', 'tools', 'model.ts'), 'utf8')
  const m = new RegExp(`export const ${name} = '([0-9a-f]{64})'`).exec(src)
  return m ? m[1] : undefined
}

const args = process.argv.slice(2)
const valueOf = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}
const modelId = valueOf('--model') ?? 'birefnet-lite'
const spec = MODELS[modelId]
if (!spec) {
  console.error(`unknown --model ${modelId} (use ${Object.keys(MODELS).join(' or ')})`)
  process.exit(2)
}
const url = valueOf('--url') ?? spec.url
const verify = !args.includes('--no-verify')
const positional = args.filter((a, i) => !a.startsWith('--') && !['--url', '--model'].includes(args[i - 1]))
const outDir = resolve(positional[0] ?? join(root, 'node_modules', '.cache', 'lud-models'))
const FILE = spec.file
const target = join(outDir, FILE)
const part = `${target}.${process.pid}.part`

mkdirSync(outDir, { recursive: true })
const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30 * 60 * 1000) })
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
const pinned = pinnedSha256(spec.shaConst)
console.log(`${FILE} bytes=${received} sha256=${sha}`)
if (verify && pinned && pinned !== sha) {
  rmSync(part, { force: true })
  console.error(`SHA-256 mismatch: pinned ${pinned}, got ${sha}`)
  process.exit(1)
}
if (existsSync(target)) rmSync(target)
renameSync(part, target)
console.log(`${pinned ? (pinned === sha ? 'verified' : 'NOT VERIFIED') : 'NOT PINNED'}: ${target}`)
