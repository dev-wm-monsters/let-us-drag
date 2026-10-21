// Security probes against a PACKAGED Linux build (phase 3b). Usage: node run-probes.mjs <app-executable>
// Kept in docs/security/tools/probes (owner: Security). Re-run after packaging: see docs/security/REVIEW.md section 1.
// Each probe starts the app under xvfb-run with a fresh user-data dir, waits, inspects, kills.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const app = process.argv[2]
const work = mkdtempSync(join(tmpdir(), 'run-'))
const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function descendants(pid) {
  const out = []
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue
    try {
      const stat = readFileSync(`/proc/${d}/stat`, 'utf8')
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
      out.push({ pid: Number(d), ppid })
    } catch {}
  }
  const set = new Set([pid])
  let grew = true
  while (grew) {
    grew = false
    for (const p of out) {
      if (set.has(p.ppid) && !set.has(p.pid)) {
        set.add(p.pid)
        grew = true
      }
    }
  }
  set.delete(pid)
  return [...set]
}
function cmdline(pid) {
  try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ') } catch { return '' }
}
function environ(pid) {
  try { return readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean) } catch { return [] }
}

async function launch(name, { env = {}, args = [], waitMs = 12000, during } = {}) {
  const ud = mkdtempSync(join(work, `ud-${name}-`))
  const child = spawn('xvfb-run', ['-a', app, '--no-sandbox', '--disable-gpu', `--user-data-dir=${ud}`, ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  child.stdout.on('data', (d) => (output += d))
  child.stderr.on('data', (d) => (output += d))
  let exited = null
  child.on('exit', (c, s) => (exited = { c, s }))
  await sleep(waitMs)
  let extra
  if (during) extra = await during(child.pid)
  for (const p of descendants(child.pid)) try { process.kill(p, 'SIGKILL') } catch {}
  try { child.kill('SIGKILL') } catch {}
  await sleep(500)
  return { output, exited, extra, settingsWritten: existsSync(join(ud, 'settings.json')) }
}

function record(id, pass, detail) {
  results.push({ id, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`)
}

// 0. Baseline: the app boots.
{
  const r = await launch('baseline')
  record('baseline-boot', r.settingsWritten, `settings.json written=${r.settingsWritten}`)
}

// 1. LUD_E2E + LUD_E2E_ENGINE_WORKER (F-15, SEC-18, D12)
{
  const marker = join(work, 'e2e-worker-marker')
  const evil = join(work, 'evil-worker.cjs')
  writeFileSync(evil, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`)
  const r = await launch('e2e', { env: { LUD_E2E: '1', LUD_E2E_ENGINE_WORKER: evil } })
  const hooks = /e2e hooks installed/.test(r.output)
  record('LUD_E2E_ENGINE_WORKER', !existsSync(marker) && !hooks, `marker=${existsSync(marker)} hooksLog=${hooks}`)
}

// 2. LUD_FFMPEG_PATH / LUD_MODEL_PATH must not reach the engine utilityProcess (F-16, D18)
{
  const r = await launch('ludenv', {
    env: { LUD_FFMPEG_PATH: '/tmp/evil-ffmpeg', LUD_MODEL_PATH: '/tmp/evil.onnx', lud_ffmpeg_path: '/tmp/evil2' },
    during: async (pid) => {
      const procs = descendants(pid).map((p) => ({ p, cmd: cmdline(p) }))
      const engine = procs.filter((x) => /utility-sub-type=node\.mojom\.NodeService/.test(x.cmd))
      const main = procs.find((x) => x.cmd.includes(app) && !/--type=/.test(x.cmd))
      return {
        engineCount: engine.length,
        engineLud: engine.flatMap((x) => environ(x.p).filter((e) => /^lud_/i.test(e))),
        mainLud: main ? environ(main.p).filter((e) => /^lud_/i.test(e)) : null
      }
    }
  })
  const e = r.extra
  record('LUD_FFMPEG_PATH/LUD_MODEL_PATH', e.engineCount > 0 && e.engineLud.length === 0,
    `engine processes=${e.engineCount}, LUD_* in engine env=${JSON.stringify(e.engineLud)}, LUD_* in main env=${JSON.stringify(e.mainLud)}`)
}

// 3. ELECTRON_RENDERER_URL (F-09, SEC-07)
{
  let hits = []
  const server = createServer((req, res) => { hits.push(req.url); res.end('<html><body>evil</body></html>') })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const r = await launch('rendererurl', { env: { ELECTRON_RENDERER_URL: `http://127.0.0.1:${port}` } })
  server.close()
  record('ELECTRON_RENDERER_URL', hits.length === 0 && r.settingsWritten, `server hits=${JSON.stringify(hits)} boot=${r.settingsWritten}`)
}

// 4. ELECTRON_RUN_AS_NODE (fuse runAsNode)
{
  const r = await launch('runasnode', { env: { ELECTRON_RUN_AS_NODE: '1' }, args: ['-e', 'console.log(424242)'], waitMs: 8000 })
  record('ELECTRON_RUN_AS_NODE', !/424242/.test(r.output), `printed=${/424242/.test(r.output)}`)
}

// 5. NODE_OPTIONS --require (fuse enableNodeOptionsEnvironmentVariable) - main AND engine utilityProcess
{
  const marker = join(work, 'nodeoptions-marker')
  const inj = join(work, 'inject.cjs')
  writeFileSync(inj, `require('fs').appendFileSync(${JSON.stringify(marker)}, process.type + ' ' + process.pid + '\\n')`)
  await launch('nodeoptions', { env: { NODE_OPTIONS: `--require ${inj}` } })
  record('NODE_OPTIONS', !existsSync(marker), `marker=${existsSync(marker) ? readFileSync(marker, 'utf8').trim() : 'absent'}`)
}

// 6. --inspect / --inspect-brk (fuse enableNodeCliInspectArguments)
for (const flag of ['--inspect=0', '--inspect-brk=0']) {
  const r = await launch('inspect', { args: [flag], waitMs: 8000 })
  record(flag, !/Debugger listening/.test(r.output), `debugger=${/Debugger listening/.test(r.output)}`)
}

// 7. Chromium switches that are NOT covered by any fuse
{
  const r = await launch('rdp', {
    args: ['--remote-debugging-port=0'],
    during: async () => {
      // DevTools prints "DevTools listening on ws://..." when the port opens.
      return null
    }
  })
  const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(r.output)
  record('--remote-debugging-port', !m, m ? `OPEN: ${m[1]}` : 'not opened')
}
for (const sw of ['--renderer-cmd-prefix', '--utility-cmd-prefix', '--gpu-launcher']) {
  const marker = join(work, `cmdprefix-${sw.slice(2)}`)
  const wrapper = join(work, `wrap-${sw.slice(2)}.sh`)
  writeFileSync(wrapper, `#!/bin/sh\necho ran >> ${marker}\nexec "$@"\n`, { mode: 0o755 })
  const args = [`${sw}=${wrapper}`]
  if (sw === '--gpu-launcher') args.push('--enable-gpu') // ignored when --disable-gpu is given first; kept for info
  await launch(`cmd-${sw.slice(2)}`, { args })
  record(sw, !existsSync(marker), existsSync(marker) ? `wrapper EXECUTED (${readFileSync(marker, 'utf8').trim().split('\n').length}x)` : 'wrapper not executed')
}

writeFileSync(join(work, 'results.json'), JSON.stringify(results, null, 2))
console.log(`results: ${join(work, 'results.json')}`)
process.exit(0)
