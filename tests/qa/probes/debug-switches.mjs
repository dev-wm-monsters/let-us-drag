// QA phase 4 (B-058 / D22): a PACKAGED build must refuse Chromium/Node debug switches.
// For every spelling it starts the app (fresh user-data dir, under xvfb-run), waits, then reports the
// exit code and whether a CDP endpoint answered. A control run without switches must stay alive.
//
//   npx electron-builder --linux --dir --publish never
//   node tests/qa/probes/debug-switches.mjs "release/linux-unpacked/let-us-drag"
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const app = process.argv[2]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const VARIANTS = [
  ['control (no switch)', []],
  ['--remote-debugging-port=9301', ['--remote-debugging-port=9301'], 9301],
  ['--remote-debugging-port 9302 (space)', ['--remote-debugging-port', '9302'], 9302],
  ['-remote-debugging-port=9303 (single dash)', ['-remote-debugging-port=9303'], 9303],
  ['--REMOTE-DEBUGGING-PORT=9304 (upper case)', ['--REMOTE-DEBUGGING-PORT=9304'], 9304],
  ['--remote-debugging-port=0', ['--remote-debugging-port=0']],
  ['--remote-debugging-pipe', ['--remote-debugging-pipe']],
  ['--remote-debugging-address=0.0.0.0 --remote-debugging-port=9305', ['--remote-debugging-address=0.0.0.0', '--remote-debugging-port=9305'], 9305],
  ['-- --remote-debugging-port=9306 (after --)', ['--', '--remote-debugging-port=9306'], 9306],
  ['--inspect=9307', ['--inspect=9307'], 9307],
  ['--inspect-brk=9308', ['--inspect-brk=9308'], 9308],
  ['--js-flags=--expose-gc', ['--js-flags=--expose-gc']]
]

function descendants(pid) {
  const all = []
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue
    try {
      const stat = readFileSync(`/proc/${d}/stat`, 'utf8')
      all.push({ pid: Number(d), ppid: Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]) })
    } catch {}
  }
  const set = new Set([pid])
  for (let grew = true; grew; ) {
    grew = false
    for (const p of all) {
      if (set.has(p.ppid) && !set.has(p.pid)) {
        set.add(p.pid)
        grew = true
      }
    }
  }
  set.delete(pid)
  return [...set]
}

/** TCP ports in LISTEN state (global table; compared before/after each launch). */
function listeningPorts() {
  const out = new Set()
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
    try {
      for (const line of readFileSync(f, 'utf8').split('\n').slice(1)) {
        const cols = line.trim().split(/\s+/)
        if (cols[3] === '0A') out.add(parseInt(cols[1].split(':')[1], 16))
      }
    } catch {}
  }
  return out
}

const results = []
for (const [label, args, port] of VARIANTS) {
  const before = listeningPorts()
  const ud = mkdtempSync(join(tmpdir(), 'dbg-ud-'))
  const child = spawn('xvfb-run', ['-a', app, '--no-sandbox', '--disable-gpu', `--user-data-dir=${ud}`, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (d) => (output += d))
  child.stderr.on('data', (d) => (output += d))
  let exited = null
  child.on('exit', (c) => (exited = c))
  await sleep(8000)
  const newPorts = [...listeningPorts()].filter((p) => !before.has(p))
  let cdp = 'no'
  if (port) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) })
      cdp = `HTTP ${r.status}`
    } catch {
      cdp = 'no'
    }
  }
  const alive = exited === null
  for (const p of descendants(child.pid)) try { process.kill(p, 'SIGKILL') } catch {}
  try { child.kill('SIGKILL') } catch {}
  await sleep(500)
  const refused = /refusing to start with --[a-z-]+/.exec(output)?.[0] ?? ''
  results.push({ label, alive, exit: exited, cdp, newListeningPorts: newPorts, message: refused })
}
console.log(JSON.stringify(results, null, 1))
