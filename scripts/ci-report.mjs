// Emits GitHub Actions annotations so CI results are readable through the API (job logs are not
// always accessible). Usage: node scripts/ci-report.mjs <level:notice|warning|error> <title> <file|-> [maxLines]
import { existsSync, readFileSync } from 'node:fs'

const [level = 'notice', title = 'report', file = '-', maxLines = '80'] = process.argv.slice(2)
let text = ''
if (file === '-') text = readFileSync(0, 'utf8')
else if (existsSync(file)) text = readFileSync(file, 'utf8')
else text = `(no log file: ${file})`
// Strip ANSI colours, keep the tail.
const lines = text.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/)
const tail = lines.slice(-Number(maxLines)).join('\n').slice(-60000)
const esc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
const escProp = (s) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C')
process.stdout.write(`::${level} title=${escProp(title)}::${esc(tail)}\n`)
