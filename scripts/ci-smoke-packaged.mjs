// CI smoke test: start the PACKAGED app (release/<platform>-unpacked or the .app) with a fresh
// user-data dir and check that it boots (settings.json written by first-run onboarding) and is
// still alive after a grace period. Usage: node scripts/ci-smoke-packaged.mjs
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const release = join(process.cwd(), 'release')
function findExecutable() {
  if (process.platform === 'darwin') {
    const dir = readdirSync(release).find((d) => d.startsWith('mac') && existsSync(join(release, d, 'Let us drag!.app')))
    if (!dir) throw new Error('no .app found under release/')
    return join(release, dir, 'Let us drag!.app', 'Contents', 'MacOS', 'Let us drag!')
  }
  if (process.platform === 'win32') return join(release, 'win-unpacked', 'Let us drag!.exe')
  return join(release, 'linux-unpacked', 'let-us-drag')
}

const exe = findExecutable()
if (!existsSync(exe)) throw new Error(`packaged executable not found: ${exe}`)
const userData = mkdtempSync(join(tmpdir(), 'lud-smoke-'))
const args = [`--user-data-dir=${userData}`]
if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu')
console.log(`starting ${exe}`)
const child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
child.stdout.on('data', (d) => (output += d))
child.stderr.on('data', (d) => (output += d))
let exited = null
child.on('exit', (code, signal) => (exited = { code, signal }))

const settings = join(userData, 'settings.json')
const deadline = Date.now() + 40_000
while (Date.now() < deadline && !existsSync(settings) && !exited) await new Promise((r) => setTimeout(r, 500))
const booted = existsSync(settings)
await new Promise((r) => setTimeout(r, 5000)) // must stay alive a little longer
const alive = !exited
child.kill()
console.log(`booted (settings.json written): ${booted}`)
if (booted) console.log(readFileSync(settings, 'utf8'))
console.log(`alive after grace period: ${alive}${exited ? ` (exit ${JSON.stringify(exited)})` : ''}`)
console.log('--- app output (tail) ---\n' + output.split('\n').slice(-30).join('\n'))
if (!booted || !alive) process.exit(1)
