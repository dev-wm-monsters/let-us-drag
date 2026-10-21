// Logging proxy: records every CONNECT / plain HTTP request it receives, answers 403. Runs the app
// with --proxy-server pointing at it so only THIS app's network attempts are seen.
// Usage: node netlog-proxy.mjs <app> <seconds>
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const [app, secs] = process.argv.slice(2)
const seen = []
const t0 = Date.now()
const server = createServer((req, res) => { seen.push({ t: (Date.now() - t0) / 1000, m: req.method, u: req.url }); res.writeHead(403); res.end() })
server.on('connect', (req, sock) => { seen.push({ t: (Date.now() - t0) / 1000, m: 'CONNECT', u: req.url }); sock.end('HTTP/1.1 403 Forbidden\r\n\r\n') })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const ud = mkdtempSync(join(tmpdir(), 'net-ud-'))
const env = { ...process.env }
for (const k of Object.keys(env)) if (/_proxy$/i.test(k)) delete env[k]
const child = spawn('xvfb-run', ['-a', app, '--no-sandbox', '--disable-gpu', `--user-data-dir=${ud}`, `--proxy-server=http://127.0.0.1:${port}`], { env, stdio: 'ignore', detached: true })
await new Promise((r) => setTimeout(r, Number(secs) * 1000))
try { process.kill(-child.pid, 'SIGKILL') } catch {}
server.close()
console.log(JSON.stringify(seen, null, 1))
process.exit(0)
