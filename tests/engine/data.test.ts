// Data conversions: pure helpers + integration for every CSV/JSON/YAML/XLSX direction.
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import Papa from 'papaparse'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { excelCell, parseCsv, recordsToTable, tableToRecords, toCsv, uniqueHeader } from '../../src/engine/tools/data'
import { MAGIC, SAMPLE_CSV, SAMPLE_JSON, SAMPLE_YAML, makeTempDir, startsWith, textFile, xlsxFile } from '../helpers/fixtures'
import { convertOk, runOption } from '../helpers/engine'

let dir = ''
let cleanup: () => Promise<void> = async () => undefined

beforeAll(async () => {
  ;({ dir, cleanup } = await makeTempDir('lud-data-'))
})
afterAll(() => cleanup())

async function readXlsxRows(path: string): Promise<unknown[][]> {
  const mod = (await import('exceljs')) as typeof import('exceljs') & { default?: typeof import('exceljs') }
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  const rows: unknown[][] = []
  wb.worksheets[0]!.eachRow((r) => rows.push((r.values as unknown[]).slice(1)))
  return rows
}

describe('data helpers', () => {
  it('uniqueHeader fills blanks and de-duplicates', () => {
    expect(uniqueHeader(['', 'a', 'a', null, 'b'])).toEqual(['column_1', 'a', 'a_2', 'column_4', 'b'])
  })

  it('parseCsv pads ragged rows; toCsv quotes as needed', () => {
    const t = parseCsv('a,b\n1\n2,3,4\n', Papa)
    expect(t.header).toEqual(['a', 'b', 'column_3'])
    expect(t.rows).toEqual([
      ['1', '', ''],
      ['2', '3', '4']
    ])
    expect(toCsv({ header: ['x'], rows: [['a,b'], ['q"q']] }, Papa)).toBe('x\n"a,b"\n"q""q"\n')
  })

  it('recordsToTable: union of keys, nested → JSON text, single object = one row', () => {
    const t = recordsToTable([{ a: 1, n: { x: 1 } }, { b: true, a: null }])
    expect(t.header).toEqual(['a', 'n', 'b'])
    expect(t.rows).toEqual([
      [1, '{"x":1}', null],
      [null, null, true]
    ])
    expect(recordsToTable({ k: 'v' }).rows).toEqual([['v']])
  })

  it('recordsToTable rejects non-tabular shapes with INPUT_INVALID', () => {
    for (const v of [[1, 2], 'text', [], [[1]], null]) {
      expect(() => recordsToTable(v)).toThrowError(expect.objectContaining({ code: 'INPUT_INVALID' }))
    }
  })

  it('tableToRecords keys by header', () => {
    expect(tableToRecords({ header: ['a', 'b'], rows: [['1']] })).toEqual([{ a: '1', b: null }])
  })

  it('excelCell flattens formulas, rich text, hyperlinks, dates, errors', () => {
    expect(excelCell({ formula: 'A1+1', result: 3 })).toBe(3)
    expect(excelCell({ richText: [{ text: 'a' }, { text: 'b' }] })).toBe('ab')
    expect(excelCell({ text: 'site', hyperlink: 'https://x' })).toBe('site')
    expect(excelCell(new Date('2024-01-02T00:00:00Z'))).toBe('2024-01-02T00:00:00.000Z')
    expect(excelCell({ error: '#N/A' })).toBe('#N/A')
  })
})

describe('data conversions', () => {
  it('CSV → JSON / YAML / XLSX', async () => {
    const csv = await textFile(join(dir, 'people.csv'), SAMPLE_CSV)
    const [json] = await convertOk('to-json', [csv])
    expect(basename(json!)).toBe('people.json')
    expect(JSON.parse(await readFile(json!, 'utf8'))).toEqual([
      { name: 'Ann', age: '31', city: 'Paris, FR' },
      { name: 'Bob', age: '42', city: 'Berlin' }
    ])
    const [yaml] = await convertOk('to-yaml', [csv])
    expect(basename(yaml!)).toBe('people.yaml')
    const y = await import('js-yaml')
    expect(y.load(await readFile(yaml!, 'utf8'))).toHaveLength(2)
    const [xlsx] = await convertOk('to-xlsx', [csv])
    expect(startsWith(await readFile(xlsx!), MAGIC.zip)).toBe(true)
    const rows = await readXlsxRows(xlsx!)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual(['name', 'age', 'city'])
  })

  it('JSON → CSV / YAML / XLSX', async () => {
    const json = await textFile(join(dir, 'list.json'), SAMPLE_JSON)
    const [csv] = await convertOk('to-csv', [json])
    const parsed = Papa.parse<string[]>((await readFile(csv!, 'utf8')).trim()).data
    expect(parsed[0]).toEqual(['name', 'age', 'tags', 'city'])
    expect(parsed).toHaveLength(3)
    expect(parsed[1]![2]).toBe('["a","b"]')
    const [yaml] = await convertOk('to-yaml', [json])
    expect(await readFile(yaml!, 'utf8')).toContain('name: Ann')
    const [xlsx] = await convertOk('to-xlsx', [json])
    const rows = await readXlsxRows(xlsx!)
    expect(rows[1]).toEqual(['Ann', 31, '["a","b"]'])
  })

  it('YAML → JSON / CSV / XLSX (also .yml)', async () => {
    const yaml = await textFile(join(dir, 'conf.yml'), SAMPLE_YAML)
    const [json] = await convertOk('to-json', [yaml])
    expect(JSON.parse(await readFile(json!, 'utf8'))).toEqual([
      { name: 'Ann', age: 31 },
      { name: 'Bob', age: 42 }
    ])
    const [csv] = await convertOk('to-csv', [yaml])
    expect(await readFile(csv!, 'utf8')).toBe('name,age\nAnn,31\nBob,42\n')
    const [xlsx] = await convertOk('to-xlsx', [yaml])
    expect(await readXlsxRows(xlsx!)).toHaveLength(3)
  })

  it('XLSX (first sheet) → CSV / JSON / YAML', async () => {
    const xlsx = await xlsxFile(join(dir, 'sheet.xlsx'))
    const [csv] = await convertOk('to-csv', [xlsx])
    expect(await readFile(csv!, 'utf8')).toBe('name,age\nAnn,31\nBob,42\n')
    const [json] = await convertOk('to-json', [xlsx])
    expect(JSON.parse(await readFile(json!, 'utf8'))).toEqual([
      { name: 'Ann', age: 31 },
      { name: 'Bob', age: 42 }
    ])
    const [yaml] = await convertOk('to-yaml', [xlsx])
    expect(await readFile(yaml!, 'utf8')).toContain('age: 42')
  })

  it('JSON that is not a list of records → CSV fails with a friendly INPUT_INVALID', async () => {
    const json = await textFile(join(dir, 'scalar.json'), '[1, 2, 3]')
    const res = await runOption('to-csv', [json])
    expect(res.error?.code).toBe('INPUT_INVALID')
    expect(res.error?.message).toMatch(/list of records/)
  })

  it('YAML is loaded safely: custom tags are rejected, alias bombs are capped', async () => {
    const evil = await textFile(join(dir, 'evil.yaml'), 'a: !!js/function "function(){}"\n')
    expect((await runOption('to-json', [evil])).error?.code).toBe('INPUT_INVALID')
    const lines = ['a: &a ["x","x","x","x","x","x","x","x","x"]']
    for (let i = 0; i < 12; i++) lines.push(`${String.fromCharCode(98 + i)}: &${String.fromCharCode(98 + i)} [${Array(9).fill(`*${String.fromCharCode(97 + i)}`).join(',')}]`)
    const bomb = await textFile(join(dir, 'bomb.yaml'), lines.join('\n') + '\n')
    const res = await runOption('to-json', [bomb])
    expect(res.error?.code).toBe('INPUT_INVALID')
  })

  it('broken JSON → INPUT_INVALID', async () => {
    const bad = await textFile(join(dir, 'bad.json'), '{ "a": ')
    expect((await runOption('to-yaml', [bad])).error?.code).toBe('INPUT_INVALID')
  })
})
