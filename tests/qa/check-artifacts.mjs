#!/usr/bin/env node
// QA packaging check (docs/qa/TEST_PLAN.md PKG-01, PKG-02, PKG-06, PKG-08, PKG-09).
// Run after `electron-builder` on the machine that built the package:
//   node tests/qa/check-artifacts.mjs [--release release] [--platform linux|darwin|win32] [--arch x64|arm64] [--no-installers]
// Exit code 0 = all checks passed, 1 = at least one check failed, 2 = bad usage.
import { spawnSync } from 'node:child_process'
import { existsSync, openSync, readFileSync, readSync, closeSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const REQUIRED_ENCODERS = ['libx264', 'libvpx-vp9', 'libopus', 'libmp3lame', 'libvorbis', 'aac', 'flac', 'pcm_s16le', 'gif', 'png', 'mjpeg', 'bmp']

function parseArgs(argv) {
  const opts = { release: join(root, 'release'), platform: process.platform, arch: process.arch, installers: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--release') opts.release = argv[++i]
    else if (a === '--platform') opts.platform = argv[++i]
    else if (a === '--arch') opts.arch = argv[++i]
    else if (a === '--no-installers') opts.installers = false
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!['linux', 'darwin', 'win32'].includes(opts.platform)) throw new Error(`bad --platform ${opts.platform}`)
  if (!['x64', 'arm64'].includes(opts.arch)) throw new Error(`bad --arch ${opts.arch}`)
  return opts
}

const results = []
function check(id, ok, what, detail = '') {
  results.push({ id, ok, what, detail })
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Installer file-name patterns from electron-builder.yml (linux arch naming is left open on purpose). */
function installerPatterns(platform, arch, version) {
  const v = escapeRe(version)
  if (platform === 'darwin') return [new RegExp(`^LetUsDrag-${v}-mac-${arch}\\.dmg$`)]
  if (platform === 'win32') return [new RegExp(`^LetUsDrag-${v}-win-${arch}-setup\\.exe$`), new RegExp(`^LetUsDrag-${v}-win-${arch}-portable\\.exe$`)]
  return [new RegExp(`^LetUsDrag-${v}-linux-[A-Za-z0-9_]+\\.AppImage$`), new RegExp(`^LetUsDrag-${v}-linux-[A-Za-z0-9_]+\\.deb$`)]
}

/** The packaged app's Resources directory inside the electron-builder output folder. */
function findResourcesDir(release, platform, arch) {
  if (platform === 'darwin') {
    const macDir = arch === 'x64' ? 'mac' : `mac-${arch}`
    const dir = join(release, macDir)
    if (!existsSync(dir)) return null
    const app = readdirSync(dir).find((n) => n.endsWith('.app'))
    return app ? join(dir, app, 'Contents', 'Resources') : null
  }
  const prefix = platform === 'win32' ? 'win' : 'linux'
  const wanted = arch === 'x64' ? [`${prefix}-unpacked`, `${prefix}-x64-unpacked`] : [`${prefix}-${arch}-unpacked`]
  const dir = wanted.map((n) => join(release, n)).find((p) => existsSync(p))
  return dir ? join(dir, 'resources') : null
}

/** List every file path inside an asar archive by reading its JSON header (no dependency). */
function listAsar(asarPath) {
  const fd = openSync(asarPath, 'r')
  try {
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const jsonLength = head.readUInt32LE(12)
    const json = Buffer.alloc(jsonLength)
    readSync(fd, json, 0, jsonLength, 16)
    const header = JSON.parse(json.toString('utf8'))
    const out = []
    const walk = (node, prefix) => {
      for (const [name, child] of Object.entries(node.files ?? {})) {
        const p = prefix ? `${prefix}/${name}` : name
        if (child.files) walk(child, p)
        else out.push(p)
      }
    }
    walk(header, '')
    return out
  } finally {
    closeSync(fd)
  }
}

function isExecutable(path, platform) {
  if (platform === 'win32') return path.toLowerCase().endsWith('.exe')
  return (statSync(path).mode & 0o111) !== 0
}

function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    return 2
  }
  const { release, platform, arch } = opts
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  if (!existsSync(release)) {
    console.error(`release folder not found: ${release}`)
    return 1
  }

  // PKG-01 installers
  if (opts.installers) {
    const files = readdirSync(release)
    for (const re of installerPatterns(platform, arch, version)) {
      const hit = files.find((f) => re.test(f))
      check('PKG-01', Boolean(hit), `installer matching ${re}`, hit ?? 'missing')
    }
  }

  // Unpacked app
  const res = findResourcesDir(release, platform, arch)
  check('PKG-04', res !== null && existsSync(res), 'unpacked app Resources directory', res ?? 'not found')
  if (res && existsSync(res)) {
    // PKG-02 ffmpeg
    const ffmpeg = join(res, 'bin', platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    const hasFfmpeg = existsSync(ffmpeg)
    check('PKG-02', hasFfmpeg, 'ffmpeg bundled in resources/bin', ffmpeg)
    if (hasFfmpeg) {
      check('PKG-02', isExecutable(ffmpeg, platform), 'ffmpeg is executable')
      if (platform === process.platform && arch === process.arch) {
        const r = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { shell: false, encoding: 'utf8', timeout: 30_000 })
        const missing = r.status === 0 ? REQUIRED_ENCODERS.filter((e) => !new RegExp(`\\s${escapeRe(e)}\\s`).test(r.stdout)) : REQUIRED_ENCODERS
        check('PKG-02', r.status === 0 && missing.length === 0, 'ffmpeg has every required encoder', missing.length ? `missing: ${missing.join(', ')}` : '')
      }
    }
    // PKG-06 notices
    check('PKG-06', existsSync(join(res, 'THIRD_PARTY_NOTICES.md')), 'THIRD_PARTY_NOTICES.md bundled')
    check('PKG-06', existsSync(join(res, 'bin', 'FFMPEG-LICENSE.txt')), 'FFMPEG-LICENSE.txt bundled')

    // PKG-08 asar content
    const asar = join(res, 'app.asar')
    check('PKG-08', existsSync(asar), 'app.asar present')
    if (existsSync(asar)) {
      const files = listAsar(asar)
      check('PKG-08', files.includes('out/main/index.js'), 'asar contains out/main/index.js')
      check('PKG-08', files.includes('package.json'), 'asar contains package.json')
      const maps = files.filter((f) => f.endsWith('.map') && !f.startsWith('node_modules/'))
      check('PKG-08', maps.length === 0, 'no app source maps in asar', maps.slice(0, 5).join(', '))
      const dev = files.filter((f) => /^(src|tests|docs|scripts|\.github)\//.test(f))
      check('PKG-08', dev.length === 0, 'no src/tests/docs/scripts in asar', dev.slice(0, 5).join(', '))
    }

    // PKG-05/09 native modules unpacked, current platform only
    const unpacked = join(res, 'app.asar.unpacked', 'node_modules')
    check('PKG-05', existsSync(join(unpacked, 'sharp')), 'sharp unpacked from asar')
    const ortBin = join(unpacked, 'onnxruntime-node', 'bin', 'napi-v6')
    if (existsSync(ortBin)) {
      const plats = readdirSync(ortBin)
      check('PKG-09', plats.length === 1 && plats[0] === platform, 'onnxruntime-node ships only this platform', plats.join(', '))
    } else {
      check('PKG-09', false, 'onnxruntime-node binaries unpacked', ortBin)
    }
    const hookPrebuilds = join(unpacked, 'uiohook-napi', 'prebuilds')
    if (existsSync(hookPrebuilds)) {
      const dirs = readdirSync(hookPrebuilds)
      check('PKG-09', dirs.length === 1 && dirs[0] === `${platform}-${arch}`, 'uiohook-napi ships only this platform/arch', dirs.join(', '))
    } else {
      check('PKG-09', false, 'uiohook-napi prebuilds unpacked', hookPrebuilds)
    }
  }

  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} ${r.what}${r.detail ? ` — ${r.detail}` : ''}`)
  const failed = results.filter((r) => !r.ok).length
  console.log(`${results.length - failed}/${results.length} checks passed`)
  return failed === 0 ? 0 : 1
}

process.exitCode = main()
