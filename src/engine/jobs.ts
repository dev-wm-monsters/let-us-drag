// Job execution: validation, dispatch to tools, progress, cancellation, timeout, atomic outputs.
import { writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Category, DroppedItem, JobEvent, JobRequest, OptionId } from '../shared/types'
import type { EngineAdapters, EngineOptions } from './api'
import { EngineError, aboutFile, cancelledOrTimeout, invalidInput, shortName, throwIfAborted, toJobError } from './errors'
import { JOB_TIMEOUT_MS, MAX_INPUT_BYTES, formatBytes } from './limits'
import { OutputStager, convertedName, mergedName, pagesFolderName, suffixedName, unzipFolderName, zipName } from './output'
import { createThrottledProgress, subProgress, type ProgressFn } from './progress'
import { assertJobRequest, describePaths, validateRequest } from './registry'
import { resolveFfmpeg } from './tools/ffmpeg'

export const DEFAULT_JOB_TIMEOUT_MS = JOB_TIMEOUT_MS

/** Engine-internal knobs (not part of the shared contract). */
export interface EngineRuntimeOptions extends EngineOptions {
  /** Per-job safety timeout. Default 30 minutes. */
  jobTimeoutMs?: number
  /** Environment used for LUD_FFMPEG_PATH / LUD_MODEL_PATH (default process.env). */
  env?: NodeJS.ProcessEnv
}

export interface JobContext {
  req: JobRequest
  items: DroppedItem[]
  category: Category
  signal: AbortSignal
  progress: ProgressFn
  out: OutputStager
  adapters: EngineAdapters
  options: EngineRuntimeOptions
  ffmpeg: () => string
}

/** Write bytes to a temp file next to `dir` and stage it as `dir/name`. */
async function stageData(ctx: JobContext, dir: string, name: string, data: Uint8Array | string): Promise<void> {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  const temp = await ctx.out.tempFile(dir, ext)
  await writeFile(temp, data)
  ctx.out.stage(temp, dir, name)
}

type EachHandler = (ctx: JobContext, item: DroppedItem, progress: ProgressFn) => Promise<void>

/**
 * 'each' batches are all-or-nothing (TPM decision D7): outputs are only committed when every input
 * succeeded, and the error names the file that failed.
 */
async function forEachItem(ctx: JobContext, handler: EachHandler): Promise<void> {
  const n = ctx.items.length
  for (let i = 0; i < n; i++) {
    throwIfAborted(ctx.signal)
    const item = ctx.items[i]!
    try {
      await handler(ctx, item, subProgress(ctx.progress, i / n, (i + 1) / n))
    } catch (err) {
      throw n > 1 ? aboutFile(err, item.name) : err
    }
  }
}

/** Refuse inputs above the per-category byte limit (SEC-41) before any parser sees them. */
export function assertInputSizes(category: Category, items: readonly DroppedItem[]): void {
  const max = MAX_INPUT_BYTES[category]
  for (const item of items) {
    if (!item.isDirectory && item.sizeBytes > max) {
      throw invalidInput(`${shortName(item.name)} is larger than ${formatBytes(max)}, which is more than I can chew for this kind of file.`)
    }
  }
}

/** Stage text while the Remove-BG model is downloaded once (TPM decision D10). */
export const MODEL_DOWNLOAD_STAGE = 'One-time download of my scissors (179 MB AI model)'
export const MODEL_VERIFY_STAGE = 'Checking the download'

// --- image ------------------------------------------------------------------------------------

const imageEach: EachHandler = async (ctx, item, progress) => {
  const dir = dirname(item.path)
  const deps = { signal: ctx.signal, ffmpeg: ctx.ffmpeg }
  if (ctx.req.optionId === 'remove-bg') {
    const { ensureModel } = await import('./tools/model')
    const { removeBackground } = await import('./tools/removebg')
    const { openImage } = await import('./tools/image')
    const modelPath = await ensureModel({
      cacheDir: ctx.options.cacheDir,
      signal: ctx.signal,
      env: ctx.options.env,
      onProgress: (p) => progress(p * 0.4, MODEL_DOWNLOAD_STAGE),
      onVerify: () => progress(0.4, MODEL_VERIFY_STAGE)
    })
    const img = await openImage(item.path, item.ext, deps)
    const png = await removeBackground(img, modelPath, ctx.signal, (p, stage) => progress(p < 0 ? -1 : 0.4 + p * 0.6, stage))
    await stageData(ctx, dir, suffixedName(item.name, '-nobg', 'png', { dir }), png)
    return
  }
  const { encodeImageTo, imageOutputExt } = await import('./tools/image')
  progress(-1, 'Chewing')
  // Encoded straight into the temp file: the output never sits in JS memory as a whole.
  const temp = await ctx.out.tempFile(dir, imageOutputExt(ctx.req.optionId, item.ext))
  const res = await encodeImageTo(ctx.req.optionId, item.path, item.ext, deps, temp)
  if (res.note) progress(1, res.note)
  const name = res.suffix ? suffixedName(item.name, res.suffix, res.ext, { dir }) : convertedName(item.name, res.ext, { dir })
  ctx.out.stage(temp, dir, name)
}

/** Animated GIF → MP4 (D30): sniffed as GIF, pixel-capped and checked for animation before ffmpeg sees it. */
const gifToMp4Each: EachHandler = async (ctx, item, progress) => {
  const { openImage } = await import('./tools/image')
  const { requireImage } = await import('./sniff')
  const { sharpError } = await import('./tools/sharp-safe')
  if ((await requireImage(item.path)) !== 'gif') throw invalidInput("This isn't really a GIF, so I can't turn it into a video.")
  let frames = 1
  try {
    frames = (await (await openImage(item.path, item.ext, { signal: ctx.signal, ffmpeg: ctx.ffmpeg }, { animated: true })).metadata()).pages ?? 1
  } catch (err) {
    throw sharpError(err)
  }
  if (frames < 2) throw invalidInput("This GIF doesn't move (it has a single frame), so there's no video to make.")
  const { gifToMp4 } = await import('./tools/media')
  const dir = dirname(item.path)
  const res = await gifToMp4({ ffmpeg: ctx.ffmpeg(), input: item.path, signal: ctx.signal, progress, tempFile: (e) => ctx.out.tempFile(dir, e) })
  ctx.out.stage(res.temp, dir, convertedName(item.name, res.ext, { dir }))
}

async function imagesToPdfJob(ctx: JobContext): Promise<void> {
  const { imagesToPdf } = await import('./tools/image')
  const n = ctx.items.length
  const pdf = await imagesToPdf(ctx.items, { signal: ctx.signal, ffmpeg: ctx.ffmpeg }, (i) => {
    throwIfAborted(ctx.signal)
    ctx.progress(i / n, 'Stacking pages')
  })
  const first = ctx.items[0]!
  const at = { dir: dirname(first.path) }
  await stageData(ctx, at.dir, n === 1 ? convertedName(first.name, 'pdf', at) : mergedName(first.name, 'pdf', at), pdf)
}

// --- video / audio ----------------------------------------------------------------------------

/** Media options whose output keeps the input's name plus a suffix (same or similar format). */
const MEDIA_SUFFIX: Partial<Record<OptionId, string>> = { compress: '-compressed', 'to-720p': '-720p', mute: '-muted' }

const mediaEach: EachHandler = async (ctx, item, progress) => {
  const { convertMedia } = await import('./tools/media')
  const dir = dirname(item.path)
  const kind = ctx.category === 'video' ? 'video' : 'audio'
  const { temp, ext, note } = await convertMedia(ctx.req.optionId, kind, {
    ffmpeg: ctx.ffmpeg(),
    input: item.path,
    inputExt: item.ext,
    signal: ctx.signal,
    progress,
    tempFile: (e) => ctx.out.tempFile(dir, e)
  })
  if (note) progress(1, note)
  const suffix = MEDIA_SUFFIX[ctx.req.optionId]
  const name = suffix ? suffixedName(item.name, suffix, ext, { dir }) : convertedName(item.name, ext, { dir })
  ctx.out.stage(temp, dir, name)
}

// --- pdf --------------------------------------------------------------------------------------

/** "page-01.png" … zero-padded to the page count (at least 2 digits). */
export function pageFileName(index: number, total: number, ext: string): string {
  const width = Math.max(2, String(total).length)
  return `page-${String(index).padStart(width, '0')}.${ext}`
}

const pdfEach: EachHandler = async (ctx, item, progress) => {
  const dir = dirname(item.path)
  const pdf = await import('./tools/pdf')
  if (ctx.req.optionId === 'pdf-rotate') {
    progress(-1, 'Turning pages')
    await stageData(ctx, dir, suffixedName(item.name, '-rotated', 'pdf', { dir }), await pdf.rotatePdf(item.path, ctx.signal))
    return
  }
  if (ctx.req.optionId === 'pdf-split') return splitPdfItem(ctx, item, progress)
  if (ctx.req.optionId === 'to-txt') {
    progress(-1, 'Reading')
    const text = await pdf.pdfToText(item.path, ctx.signal, (p) => progress(p, 'Reading'))
    await stageData(ctx, dir, convertedName(item.name, 'txt', { dir }), text)
    return
  }
  const ext = ctx.req.optionId === 'pdf-to-jpg' ? 'jpg' : 'png'
  const sharp = ext === 'jpg' ? (await import('./tools/sharp-safe')).safeSharp : undefined
  const folder = await ctx.out.tempDir(dir)
  const { join } = await import('node:path')
  let lastFile = ''
  const total = await pdf.renderPdfPages(item.path, ctx.signal, async (page, count) => {
    const data = sharp ? await sharp(page.png).flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer() : page.png
    lastFile = join(folder, pageFileName(page.index, count, ext))
    await writeFile(lastFile, data)
    progress(page.index / count, `Page ${page.index} of ${count}`)
  }, ctx.adapters.renderPdfPages?.bind(ctx.adapters))
  if (total === 0) throw new EngineError('INPUT_INVALID', 'This PDF has no pages.')
  if (total === 1) {
    ctx.out.track(lastFile)
    ctx.out.stage(lastFile, dir, convertedName(item.name, ext, { dir }))
  } else {
    ctx.out.stage(folder, dir, pagesFolderName(item.name, { dir }), 'dir')
  }
}

/**
 * Split (D30): "<name> (pages)/<name>-p001.pdf …" next to the original, like PDF → PNG pages; a
 * one-page PDF gives a single "<name>-p001.pdf".
 */
async function splitPdfItem(ctx: JobContext, item: DroppedItem, progress: ProgressFn): Promise<void> {
  const { splitPdf, splitPageSuffix } = await import('./tools/pdf')
  const { join } = await import('node:path')
  const { splitName, fitStem, utf8Bytes } = await import('./output')
  const dir = dirname(item.path)
  const stem = splitName(item.name).base
  const folderTemp = await ctx.out.tempDir(dir)
  // Room inside the folder for "<stem>-p0001.pdf" (stem possibly shortened below).
  const folderName = pagesFolderName(item.name, { dir, childReserve: Math.min(utf8Bytes(stem), 64) + 12 })
  let lastFile = ''
  let lastName = ''
  const total = await splitPdf(item.path, ctx.signal, async (index, count, bytes) => {
    const tail = `${splitPageSuffix(index, count)}.pdf`
    lastName = fitStem(stem, tail, { dir: join(dir, folderName) }, item.name) + tail
    lastFile = join(folderTemp, lastName)
    await writeFile(lastFile, bytes)
    progress(index / count, `Page ${index} of ${count}`)
  })
  if (total === 1) {
    ctx.out.track(lastFile)
    ctx.out.stage(lastFile, dir, suffixedName(item.name, splitPageSuffix(1, 1), 'pdf', { dir }))
  } else {
    ctx.out.stage(folderTemp, dir, folderName, 'dir')
  }
}

async function pdfMergeJob(ctx: JobContext): Promise<void> {
  const { mergePdfs } = await import('./tools/pdf')
  const n = ctx.items.length
  const bytes = await mergePdfs(
    ctx.items.map((i) => i.path),
    ctx.signal,
    (i) => ctx.progress(i / n, 'Stacking pages')
  )
  const first = ctx.items[0]!
  await stageData(ctx, dirname(first.path), mergedName(first.name, 'pdf', { dir: dirname(first.path) }), bytes)
}

// --- document / text --------------------------------------------------------------------------

async function docOrTextToBytes(ctx: JobContext, item: DroppedItem, optionId: OptionId): Promise<{ data: Uint8Array | string; ext: string }> {
  const text = await import('./tools/text')
  const { splitName } = await import('./output')
  const title = splitName(item.name).base
  const htmlToPdf = (html: string): Promise<Uint8Array> => ctx.adapters.htmlToPdf(html)
  return ctx.category === 'document'
    ? text.convertDocx(optionId, item.path, title, htmlToPdf, ctx.signal)
    : text.convertText(optionId, item.path, item.ext, title, htmlToPdf)
}

const docEach: EachHandler = async (ctx, item, progress) => {
  progress(-1, 'Chewing')
  const res = await docOrTextToBytes(ctx, item, ctx.req.optionId)
  await stageData(ctx, dirname(item.path), convertedName(item.name, res.ext, { dir: dirname(item.path) }), res.data)
}

/** to-pdf is a 'merge' option: several documents become one PDF. */
async function docsToPdfJob(ctx: JobContext): Promise<void> {
  const first = ctx.items[0]!
  if (ctx.items.length === 1) {
    await docEach(ctx, first, ctx.progress)
    return
  }
  await mergeEachToPdf(ctx, async (item) => (await docOrTextToBytes(ctx, item, 'to-pdf')).data as Uint8Array)
}

/** One PDF per input (all-or-nothing, D7), merged in input order into "<first> (merged).pdf" (or "<name>.pdf" for one input). */
async function mergeEachToPdf(ctx: JobContext, toPdf: (item: DroppedItem) => Promise<Uint8Array>): Promise<void> {
  const first = ctx.items[0]!
  const at = { dir: dirname(first.path) }
  if (ctx.items.length === 1) {
    ctx.progress(-1, 'Printing')
    await stageData(ctx, at.dir, convertedName(first.name, 'pdf', at), await toPdf(first))
    return
  }
  const { PDFDocument } = await import('pdf-lib')
  const merged = await PDFDocument.create()
  merged.setProducer("Let's Drag!")
  const n = ctx.items.length
  for (let i = 0; i < n; i++) {
    throwIfAborted(ctx.signal)
    ctx.progress(i / n, 'Printing')
    const item = ctx.items[i]!
    try {
      const src = await PDFDocument.load(await toPdf(item))
      const pages = await merged.copyPages(src, src.getPageIndices())
      pages.forEach((p) => merged.addPage(p))
    } catch (err) {
      throw aboutFile(err, item.name)
    }
  }
  await stageData(ctx, at.dir, mergedName(first.name, 'pdf', at), await merged.save())
}

// --- data → PDF, SVG (D30) ----------------------------------------------------------------------

async function tableToPdf(ctx: JobContext, item: DroppedItem): Promise<Uint8Array> {
  const { readTablesForPdf, tablesToHtml } = await import('./tools/table-pdf')
  const { renderPdf } = await import('./tools/text')
  const { splitName } = await import('./output')
  const title = splitName(item.name).base
  const tables = await readTablesForPdf(item.path, item.ext, title, ctx.signal)
  return renderPdf(tablesToHtml(tables), title, (html) => ctx.adapters.htmlToPdf(html))
}

async function svgToPdf(ctx: JobContext, item: DroppedItem): Promise<Uint8Array> {
  const { readSvg, svgPdfHtml } = await import('./tools/svg')
  const { renderPdf } = await import('./tools/text')
  const { splitName } = await import('./output')
  return renderPdf(svgPdfHtml(await readSvg(item.path)), splitName(item.name).base, (html) => ctx.adapters.htmlToPdf(html))
}

const svgEach: EachHandler = async (ctx, item, progress) => {
  const { readSvg, svgToRaster } = await import('./tools/svg')
  const dir = dirname(item.path)
  const ext = ctx.req.optionId === 'to-jpg' ? 'jpg' : ctx.req.optionId === 'to-png' ? 'png' : undefined
  if (!ext) throw new EngineError('UNSUPPORTED')
  progress(-1, 'Cleaning the SVG')
  const svg = await readSvg(item.path)
  progress(-1, 'Painting')
  const temp = await ctx.out.tempFile(dir, ext)
  await svgToRaster(svg, ext, temp)
  ctx.out.stage(temp, dir, convertedName(item.name, ext, { dir }))
}

// --- data -------------------------------------------------------------------------------------

const dataEach: EachHandler = async (ctx, item, progress) => {
  const { convertData } = await import('./tools/data')
  progress(-1, 'Crunching numbers')
  const res = await convertData(ctx.req.optionId, item.path, item.ext, ctx.signal)
  await stageData(ctx, dirname(item.path), convertedName(item.name, res.ext, { dir: dirname(item.path) }), res.data)
}

// --- archive ----------------------------------------------------------------------------------

const unzipEach: EachHandler = async (ctx, item, progress) => {
  const { unzipTo } = await import('./tools/archive')
  const dir = dirname(item.path)
  const folder = await ctx.out.tempDir(dir)
  await unzipTo(item.path, folder, ctx.signal, (p) => progress(p, 'Unpacking'))
  ctx.out.stage(folder, dir, unzipFolderName(item.name, { dir }), 'dir')
}

async function zipJob(ctx: JobContext): Promise<void> {
  const { zipTo } = await import('./tools/archive')
  const first = ctx.items[0]!
  const dir = dirname(first.path)
  const temp = await ctx.out.tempFile(dir, 'zip')
  await zipTo(ctx.items, temp, ctx.signal, (p) => ctx.progress(p, 'Packing'))
  ctx.out.stage(temp, dir, zipName(ctx.items.map((i) => i.name), first.isDirectory, { dir }))
}

// --- dispatch ---------------------------------------------------------------------------------

export async function dispatch(ctx: JobContext): Promise<void> {
  const id = ctx.req.optionId
  if (id === 'zip') return zipJob(ctx)
  switch (ctx.category) {
    case 'image':
      if (id === 'to-pdf') return imagesToPdfJob(ctx)
      return forEachItem(ctx, id === 'to-mp4' ? gifToMp4Each : imageEach)
    case 'video':
    case 'audio':
      return forEachItem(ctx, mediaEach)
    case 'pdf':
      return id === 'pdf-merge' ? pdfMergeJob(ctx) : forEachItem(ctx, pdfEach)
    case 'document':
    case 'text':
      return id === 'to-pdf' ? docsToPdfJob(ctx) : forEachItem(ctx, docEach)
    case 'data':
      return id === 'to-pdf' ? mergeEachToPdf(ctx, (item) => tableToPdf(ctx, item)) : forEachItem(ctx, dataEach)
    case 'vector':
      return id === 'to-pdf' ? mergeEachToPdf(ctx, (item) => svgToPdf(ctx, item)) : forEachItem(ctx, svgEach)
    case 'archive':
      return forEachItem(ctx, unzipEach)
    default:
      throw new EngineError('UNSUPPORTED')
  }
}

/** Run a job start to finish. Never throws; the outcome is reported through onEvent. */
export async function runJob(
  req: JobRequest,
  onEvent: (e: JobEvent) => void,
  signal: AbortSignal,
  adapters: EngineAdapters,
  options: EngineRuntimeOptions
): Promise<void> {
  const jobId = typeof (req as Partial<JobRequest> | null)?.id === 'string' ? req.id : ''
  const emit = (e: JobEvent): void => {
    try {
      onEvent(e)
    } catch {
      // a listener failure must never break the job
    }
  }
  const timeout = new AbortController()
  const timer = setTimeout(
    () => timeout.abort(new EngineError('TOOL_FAILED', 'This took too long, so I gave up. Try a smaller file.')),
    options.jobTimeoutMs ?? DEFAULT_JOB_TIMEOUT_MS
  )
  timer.unref?.()
  const jobSignal = AbortSignal.any([signal, timeout.signal])
  const out = new OutputStager()
  try {
    assertJobRequest(req)
    throwIfAborted(jobSignal)
    const items = await describePaths(req.inputPaths)
    const category = validateRequest(req, items)
    if (req.optionId !== 'zip') assertInputSizes(category, items) // zip streams any size
    const progress = createThrottledProgress((p, stage) => emit(stage === undefined ? { type: 'progress', jobId, progress: p } : { type: 'progress', jobId, progress: p, stage }))
    progress(0, 'Chewing')
    let ffmpegPath: string | undefined
    const ctx: JobContext = {
      req,
      items,
      category,
      signal: jobSignal,
      progress,
      out,
      adapters,
      options,
      ffmpeg: () => (ffmpegPath ??= resolveFfmpeg(options, options.env ?? process.env))
    }
    await dispatch(ctx)
    if (jobSignal.aborted) throw cancelledOrTimeout(jobSignal)
    const outputPaths = await out.commitAll()
    emit({ type: 'done', jobId, outputPaths })
  } catch (err) {
    const error = jobSignal.aborted ? toJobError(cancelledOrTimeout(jobSignal)) : toJobError(err)
    emit({ type: 'error', jobId, error })
  } finally {
    clearTimeout(timer)
    await out.cleanup()
  }
}
