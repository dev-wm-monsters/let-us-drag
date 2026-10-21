// Downloads the static FFmpeg build we ship for a platform/arch into resources/bin/<platform>-<arch>/.
// Used by CI before packaging/testing. Usage: node scripts/fetch-ffmpeg.mjs [platform] [arch]
//
// Every source is pinned by SHA-256 (fail closed: no pin → no download). When the binary can run on
// this machine, a licence gate rejects builds configured with --enable-nonfree (not redistributable).
// Sources and licences: see THIRD_PARTY_NOTICES.md and docs/TPM_DECISIONS.md (D11).
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const platform = process.argv[2] ?? process.platform
const arch = process.argv[3] ?? process.arch
const key = `${platform}-${arch}`
const sources = JSON.parse(readFileSync(join(root, 'scripts', 'ffmpeg-sources.json'), 'utf8'))
const src = sources[key]
if (!src) throw new Error(`No pinned ffmpeg source for ${key} (scripts/ffmpeg-sources.json)`)
if (!/^[0-9a-f]{64}$/.test(src.sha256 ?? '')) throw new Error(`No SHA-256 pin for ${key}; refusing to download`)

async function get(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'let-us-drag-ci' } })
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Extract a single file from a zip archive (stored or deflated entries only). */
async function unzipSingle(zip, wanted) {
  const { inflateRawSync } = await import('node:zlib')
  let off = 0
  while (off + 30 <= zip.length && zip.readUInt32LE(off) === 0x04034b50) {
    const method = zip.readUInt16LE(off + 8)
    const csize = zip.readUInt32LE(off + 18)
    const nameLen = zip.readUInt16LE(off + 26)
    const extraLen = zip.readUInt16LE(off + 28)
    const name = zip.subarray(off + 30, off + 30 + nameLen).toString('utf8')
    const dataStart = off + 30 + nameLen + extraLen
    if ((zip.readUInt16LE(off + 6) & 0x08) !== 0) throw new Error('zip with data descriptors is not supported')
    const data = zip.subarray(dataStart, dataStart + csize)
    if (name === wanted || name.endsWith(`/${wanted}`)) {
      if (method === 0) return Buffer.from(data)
      if (method === 8) return inflateRawSync(data)
      throw new Error(`unsupported zip compression method ${method}`)
    }
    off = dataStart + csize
  }
  throw new Error(`${wanted} not found in zip`)
}

const archive = await get(src.url)
const sha = createHash('sha256').update(archive).digest('hex')
if (sha !== src.sha256) throw new Error(`Checksum mismatch for ${key}: expected ${src.sha256}, got ${sha}`)
console.log(`${key}: ${src.url}\n  sha256=${sha} (verified)`)

const exe = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
const outDir = join(root, 'resources', 'bin', key)
mkdirSync(outDir, { recursive: true })
const binary = src.format === 'zip' ? await unzipSingle(archive, exe) : gunzipSync(archive)
writeFileSync(join(outDir, exe), binary)
if (platform !== 'win32') chmodSync(join(outDir, exe), 0o755)
for (const [name, url] of Object.entries(src.extras ?? {})) writeFileSync(join(outDir, name), await get(url))
writeFileSync(
  join(outDir, 'FFMPEG-SOURCE.txt'),
  `FFmpeg binary for ${key}\nDownloaded from: ${src.url}\nSHA-256 of the download: ${sha}\nLicence: ${src.license}\n` +
    `Build provider: ${src.provider}\nCorresponding source: ${src.sourceInfo}\n`
)

// Licence gate (only when the binary can run here, i.e. on the matching CI runner).
if (platform === process.platform && arch === process.arch) {
  const bin = join(outDir, exe)
  const lic = spawnSync(bin, ['-hide_banner', '-L'], { encoding: 'utf8' })
  const conf = spawnSync(bin, ['-hide_banner', '-buildconf'], { encoding: 'utf8' })
  const text = `${lic.stdout}${lic.stderr}${conf.stdout}${conf.stderr}`
  if (/not legally redistributable|--enable-nonfree/i.test(text)) throw new Error(`${key}: ffmpeg is a nonfree build; refusing to ship it`)
  console.log(`  licence gate: ok (${(lic.stdout || '').split('\n').find((l) => /GNU|LGPL|GPL/.test(l))?.trim() ?? 'see -L'})`)
} else {
  console.log('  licence gate: skipped (binary cannot run on this machine)')
}
console.log(`ffmpeg ready: ${join(outDir, exe)}`)
