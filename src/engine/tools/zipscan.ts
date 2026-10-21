// Pre-scan of ZIP-based office files (DOCX, XLSX) before mammoth/exceljs read them (SEC-91).
// Both libraries load the archive fully into memory with JSZip, which has no size limits, so a
// "zip bomb inside an OOXML file" would exhaust memory. The scan reads the same central directory
// JSZip uses, then inflates every entry once through yauzl (validateEntrySizes: the real size
// cannot exceed the declared one), discarding the bytes, and checks the totals against the caps.
import { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { EngineError, cancelledOrTimeout, invalidInput, isAbortError, throwIfAborted } from '../errors'
import { MAX_OOXML_ENTRIES, MAX_OOXML_TOTAL_BYTES, formatBytes } from '../limits'
import { isZipHead, readHead } from '../sniff'

export interface ZipScanLimits {
  maxEntries: number
  maxTotalBytes: number
}

export const OOXML_LIMITS: ZipScanLimits = { maxEntries: MAX_OOXML_ENTRIES, maxTotalBytes: MAX_OOXML_TOTAL_BYTES }

export interface ZipScanResult {
  names: Set<string>
  totalBytes: number
}

/**
 * Validate a ZIP container: signature, entry count, declared and actual uncompressed size,
 * no encryption. `what` names the file type in messages ("Word document", "Excel file").
 */
export async function scanZipContainer(path: string, what: string, signal: AbortSignal, limits: ZipScanLimits = OOXML_LIMITS): Promise<ZipScanResult> {
  const damaged = `I couldn't open this ${what}. It may be damaged, or it isn't what its name says.`
  if (!isZipHead(await readHead(path, 4))) throw invalidInput(damaged)
  const bomb = `This ${what} would unpack to more than ${formatBytes(limits.maxTotalBytes)}. That looks like a zip bomb, so I refused.`
  const yauzl = await import('yauzl')
  let zip
  try {
    zip = await yauzl.openPromise(path, { autoClose: false, lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: false })
  } catch (err) {
    throw invalidInput(damaged, err)
  }
  try {
    if (zip.entryCount > limits.maxEntries) throw invalidInput(`This ${what} has too many parts inside (${zip.entryCount}). That looks like a zip bomb, so I refused.`)
    const names = new Set<string>()
    let declared = 0
    let actual = 0
    for await (const entry of zip.eachEntry()) {
      throwIfAborted(signal)
      names.add(entry.fileName)
      if (entry.fileName.endsWith('/')) continue
      if (entry.isEncrypted()) throw invalidInput(`This ${what} is password-protected, so I cannot open it.`)
      declared += entry.uncompressedSize
      if (declared > limits.maxTotalBytes) throw invalidInput(bomb)
      const stream = await zip.openReadStreamPromise(entry)
      await pipeline(
        stream,
        new Writable({
          write(chunk: Buffer, _enc, cb) {
            actual += chunk.length
            cb(actual > limits.maxTotalBytes ? invalidInput(bomb) : null)
          }
        }),
        { signal }
      )
    }
    return { names, totalBytes: actual }
  } catch (err) {
    if (err instanceof EngineError) throw err
    if (isAbortError(err) || signal.aborted) throw cancelledOrTimeout(signal)
    throw invalidInput(damaged, err)
  } finally {
    zip.close()
  }
}
