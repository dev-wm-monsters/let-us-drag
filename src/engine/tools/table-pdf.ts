// Tables → PDF (TPM decision D30): a CSV, or every visible sheet of an XLSX, as a titled, printable
// HTML table that goes through the sanitized htmlToPdf path (text.renderPdf: same sanitizer and
// no-network CSP as every other PDF, D17). Every cell is HTML-escaped. Formulas show their cached
// result (exceljs `result`); nothing is ever recalculated. Rows / columns / cell text are capped.
import { EngineError, invalidInput } from '../errors'
import { MAX_HTML_BYTES, MAX_PDF_CELL_CHARS, MAX_PDF_TABLE_COLS, MAX_PDF_TABLE_ROWS, formatBytes } from '../limits'
import { loadPapa, openWorkbook, parseCsv } from './data'
import { escapeHtml } from './html'
import { readText } from './text'

export interface PdfCell {
  text: string
  numeric: boolean
}

export interface PdfSheet {
  title: string
  /** First row = header row (repeated on every printed page). */
  rows: PdfCell[][]
  columns: number
  /** Non-empty columns left out beyond MAX_PDF_TABLE_COLS. */
  droppedColumns: number
}

export interface PdfTables {
  sheets: PdfSheet[]
  /** True when rows were left out because of MAX_PDF_TABLE_ROWS. */
  truncatedRows: boolean
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Dates as "2026-11-07" (or "2026-11-07 14:30" with a time of day), in UTC like exceljs reads them. */
export function formatDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return ''
  const day = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
  const h = d.getUTCHours()
  const m = d.getUTCMinutes()
  const s = d.getUTCSeconds()
  if (h === 0 && m === 0 && s === 0) return day
  return `${day} ${pad2(h)}:${pad2(m)}${s ? `:${pad2(s)}` : ''}`
}

/** Numbers without float noise (0.1 + 0.2 → "0.3"); percentage formats as "12.5%". */
export function formatNumber(n: number, numFmt?: string): string {
  if (!Number.isFinite(n)) return String(n)
  const plain = (x: number): string => (Number.isInteger(x) ? String(x) : String(Number.parseFloat(x.toPrecision(12))))
  if (numFmt && numFmt.replace(/"[^"]*"/g, '').includes('%')) return `${plain(n * 100)}%`
  return plain(n)
}

function clip(s: string): string {
  return s.length > MAX_PDF_CELL_CHARS ? `${s.slice(0, MAX_PDF_CELL_CHARS - 1)}…` : s
}

const EMPTY: PdfCell = { text: '', numeric: false }

/** An exceljs cell value as printable text. Formulas show their cached result ('' when none is stored). */
export function pdfCell(v: unknown, numFmt?: string): PdfCell {
  if (v === null || v === undefined) return EMPTY
  if (typeof v === 'number') return { text: formatNumber(v, numFmt), numeric: true }
  if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', numeric: false }
  if (v instanceof Date) return { text: formatDate(v), numeric: false }
  if (typeof v === 'string') return { text: clip(v), numeric: false }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('formula' in o || 'sharedFormula' in o || 'result' in o) return pdfCell(o['result'], numFmt)
    if (Array.isArray(o['richText'])) return { text: clip((o['richText'] as { text?: unknown }[]).map((r) => String(r.text ?? '')).join('')), numeric: false }
    if ('text' in o) return pdfCell(o['text'], numFmt)
    if ('error' in o) return { text: String(o['error']), numeric: false }
  }
  return { text: clip(String(v)), numeric: false }
}

/** Drop empty trailing rows / columns and cap the columns; undefined for an empty sheet. */
export function finishSheet(title: string, matrix: readonly (readonly PdfCell[] | undefined)[]): PdfSheet | undefined {
  const rows = Array.from(matrix, (r) => r ?? [])
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => !c.text)) rows.pop()
  let width = 0
  for (const r of rows) {
    for (let c = r.length - 1; c >= width; c--) {
      if (r[c]?.text) {
        width = c + 1
        break
      }
    }
  }
  if (rows.length === 0 || width === 0) return undefined
  const columns = Math.min(width, MAX_PDF_TABLE_COLS)
  return {
    title,
    rows: rows.map((r) => Array.from({ length: columns }, (_, i) => r[i] ?? EMPTY)),
    columns,
    droppedColumns: width - columns
  }
}

/** Read a CSV / XLSX as printable sheets (row cap over all sheets; empty and hidden sheets skipped). */
export async function readTablesForPdf(path: string, ext: string, title: string, signal: AbortSignal = new AbortController().signal): Promise<PdfTables> {
  let budget = MAX_PDF_TABLE_ROWS
  let truncatedRows = false
  const sheets: PdfSheet[] = []
  const e = ext.toLowerCase()
  if (e === 'csv') {
    const t = parseCsv(await readText(path), await loadPapa())
    // parseCsv names empty header cells "column_N": print them empty, as in the file.
    const head = t.header.map((h, i) => (h === `column_${i + 1}` ? '' : h))
    const all = [head, ...t.rows]
    if (all.length > budget) {
      truncatedRows = true
      all.length = budget
    }
    const sheet = finishSheet(title, all.map((r) => r.map((c) => pdfCell(c))))
    if (sheet) sheets.push(sheet)
  } else if (e === 'xlsx') {
    const wb = await openWorkbook(path, signal)
    for (const ws of wb.worksheets) {
      if (ws.state === 'hidden' || ws.state === 'veryHidden') continue
      const matrix: PdfCell[][] = []
      // Rows are kept at their position (empty rows in between stay empty rows), so the cap is on
      // the row NUMBER: a stray value in row 1 000 000 cannot make a million-row table.
      const limit = budget
      ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber > limit) {
          truncatedRows = true
          return
        }
        const cells: PdfCell[] = []
        const count = row.cellCount
        for (let c = 1; c <= Math.min(count, MAX_PDF_TABLE_COLS); c++) {
          const cell = row.getCell(c)
          cells.push(pdfCell(cell.value, cell.numFmt))
        }
        // Beyond the column cap only the last non-empty column matters (for the "left out" note).
        for (let c = count; c > MAX_PDF_TABLE_COLS; c--) {
          if (row.getCell(c).value != null) {
            cells[c - 1] = { text: '…', numeric: false }
            break
          }
        }
        matrix[rowNumber - 1] = cells
      })
      const sheet = finishSheet(ws.name, matrix)
      if (sheet) {
        budget -= sheet.rows.length
        sheets.push(sheet)
      }
    }
  } else {
    throw new EngineError('UNSUPPORTED')
  }
  if (sheets.length === 0) throw invalidInput(e === 'csv' ? 'This CSV file is empty.' : 'This Excel file has no data to print.')
  return { sheets, truncatedRows }
}

/** A sheet is printed landscape when it has many columns or a lot of text per row. */
export function isWideSheet(sheet: PdfSheet): boolean {
  if (sheet.columns > 7) return true
  const sample = sheet.rows.slice(0, 200)
  let chars = 0
  for (let c = 0; c < sheet.columns; c++) chars += Math.max(...sample.map((r) => Math.min(40, r[c]!.text.length))) + 2
  return chars > 100
}

const TABLE_CSS = `
@page { size: A4 portrait; margin: 12mm 10mm; }
@page lud-wide { size: A4 landscape; margin: 10mm; }
body { max-width: none; margin: 0; padding: 0; font-size: 9pt; line-height: 1.3; }
section.lud-sheet + section.lud-sheet { break-before: page; }
section.lud-wide { page: lud-wide; }
h2.lud-title { font-size: 13pt; margin: 0 0 6px; }
p.lud-note { margin: 4px 0 6px; color: #9a3412; font-size: 8.5pt; }
table.lud-grid { border-collapse: collapse; width: auto; max-width: 100%; margin: 0; font-size: 8.5pt; }
table.lud-grid.lud-dense { font-size: 7pt; }
table.lud-grid thead { display: table-header-group; }
table.lud-grid tr { break-inside: avoid; page-break-inside: avoid; }
table.lud-grid th, table.lud-grid td { border: 1px solid #a8a29e; padding: 2px 5px; text-align: left; vertical-align: top; white-space: pre-wrap; overflow-wrap: anywhere; }
table.lud-grid th { background: #e7e5e4; font-weight: 700; }
table.lud-grid td.lud-num { text-align: right; white-space: nowrap; }
table.lud-grid tbody tr:nth-child(even) td { background: #fafaf9; }
`.trim()

function cellHtml(tag: 'th' | 'td', c: PdfCell): string {
  return c.numeric && tag === 'td' ? `<td class="lud-num">${escapeHtml(c.text)}</td>` : `<${tag}>${escapeHtml(c.text)}</${tag}>`
}

function tooBigToPrint(): EngineError {
  return invalidInput(`This table is too big to print (more than ${formatBytes(MAX_HTML_BYTES)} of text).`)
}

/** Body HTML for text.renderPdf: one titled section per sheet, the header row repeated on every page. */
export function tablesToHtml(tables: PdfTables): string {
  const parts = [`<style>\n${TABLE_CSS}\n</style>`]
  let size = 0
  tables.sheets.forEach((sheet, i) => {
    const last = i === tables.sheets.length - 1
    const [head, ...body] = sheet.rows
    parts.push(`<section class="lud-sheet${isWideSheet(sheet) ? ' lud-wide' : ''}">`, `<h2 class="lud-title">${escapeHtml(sheet.title)}</h2>`)
    if (sheet.droppedColumns > 0) {
      const n = sheet.droppedColumns
      parts.push(`<p class="lud-note">${n} more column${n === 1 ? '' : 's'} left out (at most ${MAX_PDF_TABLE_COLS} columns are printed).</p>`)
    }
    // Stop as soon as the HTML outgrows what renderPdf accepts: at the caps (20 000 × 50 cells of
    // 500 characters, which a tiny XLSX reaching one shared string from every cell can ask for) the
    // whole table would be 0.5–2.5 G characters, gigabytes of memory or a V8 "Invalid string length".
    const rows: string[] = []
    for (const r of [head!, ...body]) {
      const tr = `<tr>${r.map((c) => cellHtml(rows.length === 0 ? 'th' : 'td', c)).join('')}</tr>`
      size += tr.length + 1
      if (size > MAX_HTML_BYTES) throw tooBigToPrint()
      rows.push(tr)
    }
    parts.push(
      `<table class="lud-grid${sheet.columns > 14 ? ' lud-dense' : ''}">`,
      `<thead>${rows[0]}</thead>`,
      `<tbody>\n${rows.slice(1).join('\n')}\n</tbody>`,
      '</table>'
    )
    if (tables.truncatedRows && last) {
      parts.push(`<p class="lud-note">More rows were left out here (at most ${MAX_PDF_TABLE_ROWS.toLocaleString('en-US')} rows are printed).</p>`)
    }
    parts.push('</section>')
  })
  return parts.join('\n')
}
