// F-23 impact + packaged-engine smoke: launch the PACKAGED app with --remote-debugging-port, attach to
// the hidden overlay page over CDP and drive window.lud.startJob (privileged IPC) for several files.
// Usage: node cdp-convert.mjs <app> <fixtures-dir>
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const [app, fx] = process.argv.slice(2)
const ud = mkdtempSync(join(tmpdir(), 'cdpconv-ud-'))
const port = 39557
const child = spawn('xvfb-run', ['-a', app, '--no-sandbox', '--disable-gpu', `--user-data-dir=${ud}`, `--remote-debugging-port=${port}`], { stdio: 'ignore', detached: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(12000)
const out = {}
try {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page' && /overlay\/index\.html/.test(t.url))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
  const ev = (expr) => new Promise((r) => { const i = ++id; pending.set(i, (d) => r(d.result?.result?.value ?? d.result?.exceptionDetails?.exception?.description)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })) })
  const jobs = [
    ['png-jpg', 'to-jpg', `${fx}/pic.png`],
    ['wav-mp3', 'to-mp3', `${fx}/tone.wav`],
    ['md-html', 'to-html', `${fx}/note.md`],
    ['md-pdf', 'to-pdf', `${fx}/note.md`],
    ['outside', 'to-png', '/etc/hostname']
  ]
  for (const [name, optionId, path] of jobs) {
    out[name] = await ev(`new Promise((resolve) => {
      const id = 'probe-${name}'
      const off = window.lud.onJobEvent((e) => { if (e.jobId === id && (e.type === 'done' || e.type === 'error')) { off(); resolve(JSON.stringify(e)) } })
      window.lud.startJob({ id, optionId: '${optionId}', inputPaths: [${JSON.stringify(path)}] }).catch((err) => { off(); resolve('startJob rejected: ' + err.message) })
      setTimeout(() => resolve('timeout'), 60000)
    })`)
  }
  out['pdf-png'] = await ev(`new Promise((resolve) => {
      const id = 'probe-pdf-png'
      const off = window.lud.onJobEvent((e) => { if (e.jobId === id && (e.type === 'done' || e.type === 'error')) { off(); resolve(JSON.stringify(e)) } })
      window.lud.startJob({ id, optionId: 'pdf-to-png', inputPaths: [${JSON.stringify(`${fx}/note.pdf`)}] }).catch((err) => { off(); resolve('startJob rejected: ' + err.message) })
      setTimeout(() => resolve('timeout'), 60000)
    })`)
  ws.close()
} catch (err) {
  out.error = String(err)
}
console.log(JSON.stringify(out, null, 2))
try { process.kill(-child.pid, 'SIGKILL') } catch {}
process.exit(0)
