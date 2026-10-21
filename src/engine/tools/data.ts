// Data conversions among CSV / JSON / YAML / XLSX.
// Tables (CSV, XLSX first worksheet) ↔ records (JSON/YAML arrays of objects).
// CSV values stay strings (no guessing that would mangle zip codes or IDs); XLSX keeps numbers,
// booleans and dates (as ISO strings).
import type { OptionId } from '../../shared/types'
import { EngineError, invalidInput } from '../errors'
import { MAX_EXPANDED_NODES, YAML_MAX_ALIASES, YAML_MAX_DEPTH } from '../limits'
import { readText } from './text'
import { scanZipContainer } from './zipscan'

export type Row = (string | number | boolean | null)[]
export interface Table {
  header: string[]
  rows: Row[]
}
export type Data = { kind: 'table'; table: Table } | { kind: 'value'; value: unknown }

// YAML alias bombs and huge nesting are stopped by YAML_MAX_ALIASES / YAML_MAX_DEPTH (js-yaml
// options, verified in node_modules/js-yaml/dist/js-yaml.d.ts 5.5.0) and MAX_EXPANDED_NODES
// (shared references are counted every time they appear), all in ../limits.
export { MAX_EXPANDED_NODES }

// ---------------------------------------------------------------------------------------------
// Pure helpers (unit tested)

/** Make header names non-empty and unique: "", "a", "a" → "column_1", "a", "a_2". */
export function uniqueHeader(raw: readonly unknown[]): string[] {
  const seen = new Map<string, number>()
  return raw.map((h, i) => {
    let name = h === null || h === undefined ? '' : String(h).trim()
    if (!name) name = `column_${i + 1}`
    const count = seen.get(name) ?? 0
    seen.set(name, count + 1)
    return count === 0 ? name : `${name}_${count + 1}`
  })
}

/** Table → array of records keyed by header. Missing cells become "" (CSV) / null. */
export function tableToRecords(t: Table): Record<string, unknown>[] {
  return t.rows.map((r) => Object.fromEntries(t.header.map((h, i) => [h, r[i] ?? null])))
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date)
}

function cellValue(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'bigint') return v.toString()
  return JSON.stringify(v) ?? null
}

/**
 * Records → table. Accepts an array of (flat-ish) objects; nested values become JSON text.
 * A single object is treated as one row. Anything else is INPUT_INVALID.
 */
export function recordsToTable(value: unknown): Table {
  const list = isPlainObject(value) ? [value] : value
  if (!Array.isArray(list) || list.length === 0 || !list.every(isPlainObject)) {
    throw invalidInput(
      'To make a table I need a list of records, like [{"name": "Ann", "age": 31}, ...]. This file has a different shape.'
    )
  }
  const header: string[] = []
  const seen = new Set<string>()
  for (const rec of list) {
    for (const k of Object.keys(rec)) {
      if (!seen.has(k)) {
        seen.add(k)
        header.push(k)
      }
    }
  }
  if (header.length === 0) throw invalidInput('These records have no fields, so there is nothing to put in a table.')
  return { header, rows: list.map((rec) => header.map((h) => cellValue(rec[h]))) }
}

export function parseCsv(text: string, Papa: typeof import('papaparse')): Table {
  const res = Papa.parse<string[]>(text, { header: false, skipEmptyLines: 'greedy', dynamicTyping: false })
  const data = res.data.filter((r) => Array.isArray(r))
  if (data.length === 0) throw invalidInput('This CSV file is empty.')
  const fatal = res.errors.find((e) => e.type === 'Quotes')
  if (fatal && data.length <= 1) throw invalidInput("I couldn't read this CSV file.", fatal.message)
  const [head, ...rows] = data
  const width = Math.max(head!.length, ...rows.map((r) => r.length))
  const header = uniqueHeader([...head!, ...Array<string>(width - head!.length).fill('')])
  return { header, rows: rows.map((r) => [...r, ...Array<string>(width - r.length).fill('')]) }
}

export function toCsv(t: Table, Papa: typeof import('papaparse')): string {
  const rows = t.rows.map((r) => r.map((c) => (c === null ? '' : typeof c === 'string' ? c : String(c))))
  return Papa.unparse({ fields: t.header, data: rows }, { newline: '\n' }) + '\n'
}

/** Flatten an exceljs cell value to a plain value. */
export function excelCell(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('result' in o) return excelCell(o['result'])
    if ('formula' in o || 'sharedFormula' in o) return null
    if (Array.isArray(o['richText'])) return (o['richText'] as { text?: unknown }[]).map((r) => String(r.text ?? '')).join('')
    if ('text' in o && 'hyperlink' in o) return excelCell(o['text'])
    if ('error' in o) return String(o['error'])
  }
  return String(v)
}

// ---------------------------------------------------------------------------------------------
// Reading

async function readXlsx(path: string, signal: AbortSignal): Promise<Table> {
  // SEC-91: entry count and real uncompressed size are checked before exceljs (JSZip) loads it all.
  const { names } = await scanZipContainer(path, 'Excel file', signal)
  if (!names.has('xl/workbook.xml')) throw invalidInput("This isn't a real Excel (.xlsx) file, so I can't read it.")
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.readFile(path)
  } catch (err) {
    throw invalidInput("I couldn't open this Excel file. It may be damaged or password-protected.", err)
  }
  const ws = wb.worksheets[0]
  if (!ws) throw invalidInput('This Excel file has no sheets.')
  const matrix: Row[] = []
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values: Row = []
    const count = row.cellCount
    for (let c = 1; c <= count; c++) values.push(excelCell(row.getCell(c).value))
    matrix[rowNumber - 1] = values
  })
  const rows = Array.from(matrix, (r) => r ?? [])
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c === null || c === '')) rows.pop()
  if (rows.length === 0) throw invalidInput('The first sheet of this Excel file is empty.')
  const [head, ...body] = rows
  const width = Math.max(...rows.map((r) => r.length))
  const header = uniqueHeader([...head!, ...Array<null>(width - head!.length).fill(null)])
  return { header, rows: body.map((r) => [...r, ...Array<null>(width - r.length).fill(null)]) }
}

/**
 * Count nodes as if every shared reference were copied (as JSON/CSV output does) and fail once the
 * count passes `max`. Stops "billion laughs" alias bombs and alias cycles before they explode.
 */
export function assertExpandable(value: unknown, max = MAX_EXPANDED_NODES): void {
  let count = 0
  const stack: unknown[] = [value]
  while (stack.length > 0) {
    const v = stack.pop()
    if (++count > max) {
      throw invalidInput('This YAML expands into something enormous (it reuses the same parts over and over), so I refused to convert it.')
    }
    if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
      for (const child of Object.values(v as Record<string, unknown>)) stack.push(child)
    }
  }
}

function parseYaml(text: string, yaml: typeof import('js-yaml')): unknown {
  let docs: unknown[]
  try {
    docs = yaml.loadAll(text, { schema: yaml.CORE_SCHEMA, maxAliases: YAML_MAX_ALIASES, maxDepth: YAML_MAX_DEPTH })
  } catch (err) {
    if (/maxAliases|maxDepth|maxTotalMergeKeys/.test(String(err))) {
      throw invalidInput('This YAML file reuses or nests things too much (it looks like a YAML bomb), so I refused to read it.', err)
    }
    throw invalidInput("I couldn't read this YAML file. There's a syntax error in it.", err)
  }
  if (docs.length === 0) throw invalidInput('This YAML file is empty.')
  const value = docs.length === 1 ? docs[0] : docs
  assertExpandable(value)
  return value
}

export async function readData(path: string, ext: string, signal: AbortSignal = new AbortController().signal): Promise<Data> {
  switch (ext.toLowerCase()) {
    case 'csv':
      return { kind: 'table', table: parseCsv(await readText(path), await loadPapa()) }
    case 'xlsx':
      return { kind: 'table', table: await readXlsx(path, signal) }
    case 'json': {
      const text = await readText(path)
      if (!text.trim()) throw invalidInput('This JSON file is empty.')
      try {
        return { kind: 'value', value: JSON.parse(text) as unknown }
      } catch (err) {
        throw invalidInput("I couldn't read this JSON file. There's a syntax error in it.", err)
      }
    }
    case 'yaml':
    case 'yml':
      return { kind: 'value', value: parseYaml(await readText(path), await loadYaml()) }
    default:
      throw new EngineError('UNSUPPORTED')
  }
}

// ---------------------------------------------------------------------------------------------
// Writing

function asTable(d: Data): Table {
  return d.kind === 'table' ? d.table : recordsToTable(d.value)
}

function asValue(d: Data): unknown {
  return d.kind === 'table' ? tableToRecords(d.table) : d.value
}

async function writeXlsx(t: Table): Promise<Buffer> {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Let us drag!'
  const ws = wb.addWorksheet('Sheet1')
  ws.addRow(t.header)
  ws.getRow(1).font = { bold: true }
  for (const r of t.rows) ws.addRow(r)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

export async function convertData(
  optionId: OptionId,
  path: string,
  ext: string,
  signal: AbortSignal = new AbortController().signal
): Promise<{ data: Uint8Array | string; ext: string }> {
  const data = await readData(path, ext, signal)
  switch (optionId) {
    case 'to-csv':
      return { data: toCsv(asTable(data), await loadPapa()), ext: 'csv' }
    case 'to-xlsx':
      return { data: await writeXlsx(asTable(data)), ext: 'xlsx' }
    case 'to-json':
      return { data: JSON.stringify(asValue(data), null, 2) + '\n', ext: 'json' }
    case 'to-yaml': {
      const yaml = await loadYaml()
      return { data: yaml.dump(asValue(data), { noRefs: true, lineWidth: -1 }), ext: 'yaml' }
    }
    default:
      throw new EngineError('UNSUPPORTED')
  }
}

async function loadPapa(): Promise<typeof import('papaparse')> {
  const mod = (await import('papaparse')) as typeof import('papaparse') & { default?: typeof import('papaparse') }
  return mod.default ?? mod
}

async function loadYaml(): Promise<typeof import('js-yaml')> {
  return import('js-yaml')
}

async function loadExcel(): Promise<typeof import('exceljs')> {
  const mod = (await import('exceljs')) as typeof import('exceljs') & { default?: typeof import('exceljs') }
  return mod.default ?? mod
}
