// Downloads a static FFmpeg build (ffmpeg-static release b6.1.1, GPL) for the given platform/arch
// into resources/bin/<platform>-<arch>/. Used by CI before packaging and for local testing.
// Usage: node scripts/fetch-ffmpeg.mjs [platform] [arch]
// Integrity: if scripts/ffmpeg-checksums.json has an entry for the file, the SHA-256 must match.
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const RELEASE = 'b6.1.1'
const BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE}`
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const platform = process.argv[2] ?? process.platform
const arch = process.argv[3] ?? process.arch

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

const outDir = join(root, 'resources', 'bin', `${platform}-${arch}`)
mkdirSync(outDir, { recursive: true })
const exe = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
const gzName = `ffmpeg-${platform}-${arch}.gz`

const gz = await get(`${BASE}/${gzName}`)
const sha = createHash('sha256').update(gz).digest('hex')
const sumsFile = join(root, 'scripts', 'ffmpeg-checksums.json')
const sums = existsSync(sumsFile) ? JSON.parse(readFileSync(sumsFile, 'utf8')) : {}
if (sums[gzName] && sums[gzName] !== sha) {
  throw new Error(`Checksum mismatch for ${gzName}: expected ${sums[gzName]}, got ${sha}`)
}
console.log(`${gzName} sha256=${sha}${sums[gzName] ? ' (verified)' : ' (NOT PINNED)'}`)

writeFileSync(join(outDir, exe), gunzipSync(gz))
if (platform !== 'win32') chmodSync(join(outDir, exe), 0o755)
writeFileSync(join(outDir, 'FFMPEG-LICENSE.txt'), await get(`${BASE}/${platform}-${arch}.LICENSE`))
writeFileSync(join(outDir, 'FFMPEG-README.txt'), await get(`${BASE}/${platform}-${arch}.README`))
console.log(`ffmpeg ready: ${join(outDir, exe)}`)
