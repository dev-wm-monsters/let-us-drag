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

/** Extract a single file from a zip archive via its central directory (stored or deflated entries). */
async function unzipSingle(zip, wanted) {
  const { inflateRawSync } = await import('node:zlib')
  // End of central directory record: signature 0x06054b50, searched from the end (comment <= 64 KiB).
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip archive (no end of central directory)')
  const entries = zip.readUInt16LE(eocd + 10)
  let off = zip.readUInt32LE(eocd + 16)
  for (let n = 0; n < entries; n++) {
    if (zip.readUInt32LE(off) !== 0x02014b50) throw new Error('corrupt zip central directory')
    const method = zip.readUInt16LE(off + 10)
    const csize = zip.readUInt32LE(off + 20)
    const nameLen = zip.readUInt16LE(off + 28)
    const extraLen = zip.readUInt16LE(off + 30)
    const commentLen = zip.readUInt16LE(off + 32)
    const localOff = zip.readUInt32LE(off + 42)
    const name = zip.subarray(off + 46, off + 46 + nameLen).toString('utf8')
    if (csize === 0xffffffff || localOff === 0xffffffff) throw new Error('zip64 archives are not supported')
    if (name === wanted || name.endsWith(`/${wanted}`)) {
      if (zip.readUInt32LE(localOff) !== 0x04034b50) throw new Error('corrupt zip local header')
      const dataStart = localOff + 30 + zip.readUInt16LE(localOff + 26) + zip.readUInt16LE(localOff + 28)
      const data = zip.subarray(dataStart, dataStart + csize)
      if (method === 0) return Buffer.from(data)
      if (method === 8) return inflateRawSync(data)
      throw new Error(`unsupported zip compression method ${method}`)
    }
    off += 46 + nameLen + extraLen + commentLen
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
  if (!src.extras?.['FFMPEG-LICENSE.txt']) {
    // Providers that ship a bare binary: record the licence statement the binary itself reports.
    writeFileSync(
      join(outDir, 'FFMPEG-LICENSE.txt'),
      `Licence statement reported by this FFmpeg binary (ffmpeg -L):\n\n${lic.stdout}\n` +
        `Full licence texts: see THIRD_PARTY_NOTICES.md and the licenses/ folder shipped with the app.\n`
    )
  }
  const conf = spawnSync(bin, ['-hide_banner', '-buildconf'], { encoding: 'utf8' })
  const text = `${lic.stdout}${lic.stderr}${conf.stdout}${conf.stderr}`
  if (/not legally redistributable|--enable-nonfree/i.test(text)) throw new Error(`${key}: ffmpeg is a nonfree build; refusing to ship it`)
  console.log(`  licence gate: ok (${(lic.stdout || '').split('\n').find((l) => /GNU|LGPL|GPL/.test(l))?.trim() ?? 'see -L'})`)
} else {
  console.log('  licence gate: skipped (binary cannot run on this machine)')
}
console.log(`ffmpeg ready: ${join(outDir, exe)}`)
