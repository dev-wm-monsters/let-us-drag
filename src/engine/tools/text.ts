// Document (DOCX via mammoth) and text (Markdown / plain text / HTML) conversions.
// HTML → PDF always goes through EngineAdapters.htmlToPdf (Chromium printToPDF in the app) with
// SANITIZED markup inside a document carrying a no-network, no-script CSP.
import { readFile } from 'node:fs/promises'
import type { OptionId } from '../../shared/types'
import { EngineError, invalidInput } from '../errors'
import { htmlToDocx, plainTextToDocxHtml } from './docx-writer'
import { htmlToMarkdown, htmlToText, plainTextToHtml, sanitizeHtml, wrapHtmlDocument } from './html'

export interface TextOutput {
  data: Uint8Array | string
  ext: string
}

export type HtmlToPdf = (html: string) => Promise<Uint8Array>

/** Read a text file as UTF-8 and drop a BOM. */
export async function readText(path: string): Promise<string> {
  const buf = await readFile(path)
  if (buf.includes(0)) {
    // NUL bytes: binary file with a text extension (or UTF-16, which we do not support).
    const utf16 = (buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)
    if (!utf16) throw invalidInput("This doesn't look like a text file.")
    return new TextDecoder(buf[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(buf)
  }
  return buf.toString('utf8').replace(/^﻿/, '')
}

/** Render an HTML fragment/document to PDF bytes through the adapter, sanitized. */
export async function renderPdf(html: string, title: string, htmlToPdf: HtmlToPdf): Promise<Uint8Array> {
  const doc = wrapHtmlDocument(sanitizeHtml(html), title, { csp: true })
  let pdf: Uint8Array
  try {
    pdf = await htmlToPdf(doc)
  } catch (err) {
    throw new EngineError('TOOL_FAILED', "I couldn't print this to PDF.", err instanceof Error ? err.message : String(err))
  }
  if (!(pdf instanceof Uint8Array) || pdf.byteLength < 5) throw new EngineError('TOOL_FAILED', "I couldn't print this to PDF.", 'empty PDF from adapter')
  return pdf
}

async function markdownToHtml(md: string): Promise<string> {
  const { marked } = await import('marked')
  return marked.parse(md, { async: false, gfm: true })
}

/** Input of the text category normalised to HTML (and kept as source where useful). */
async function textInputToHtml(path: string, ext: string): Promise<{ html: string; source: string; kind: 'md' | 'txt' | 'html' }> {
  const source = await readText(path)
  const e = ext.toLowerCase()
  if (e === 'md' || e === 'markdown') return { html: await markdownToHtml(source), source, kind: 'md' }
  if (e === 'html' || e === 'htm') return { html: source, source, kind: 'html' }
  return { html: plainTextToHtml(source), source, kind: 'txt' }
}

/** md / markdown / txt / html → pdf | html | docx | txt */
export async function convertText(optionId: OptionId, path: string, ext: string, title: string, htmlToPdf: HtmlToPdf): Promise<TextOutput> {
  const input = await textInputToHtml(path, ext)
  switch (optionId) {
    case 'to-pdf':
      return { data: await renderPdf(input.html, title, htmlToPdf), ext: 'pdf' }
    case 'to-html':
      if (input.kind === 'html') throw new EngineError('UNSUPPORTED')
      return { data: wrapHtmlDocument(input.html, title), ext: 'html' }
    case 'to-docx': {
      const html = input.kind === 'txt' ? plainTextToDocxHtml(input.source) : input.html
      return { data: await htmlToDocx(html, title), ext: 'docx' }
    }
    case 'to-txt':
      if (input.kind === 'txt') throw new EngineError('UNSUPPORTED')
      return { data: htmlToText(input.html), ext: 'txt' }
    default:
      throw new EngineError('UNSUPPORTED')
  }
}

type Mammoth = {
  convertToHtml(input: { path: string }, options?: { externalFileAccess?: boolean }): Promise<{ value: string }>
  extractRawText(input: { path: string }): Promise<{ value: string }>
}

async function loadMammoth(): Promise<Mammoth> {
  const mod = (await import('mammoth')) as unknown as Mammoth & { default?: Mammoth }
  return mod.default ?? mod
}

async function docxHtml(path: string): Promise<string> {
  const mammoth = await loadMammoth()
  try {
    // externalFileAccess stays false: a DOCX must not make us read other files on disk.
    return (await mammoth.convertToHtml({ path }, { externalFileAccess: false })).value
  } catch (err) {
    throw invalidInput("I couldn't read this Word document. It may be damaged, or it isn't a .docx file.", err)
  }
}

/** docx → pdf | html | md | txt */
export async function convertDocx(optionId: OptionId, path: string, title: string, htmlToPdf: HtmlToPdf): Promise<TextOutput> {
  switch (optionId) {
    case 'to-pdf':
      return { data: await renderPdf(await docxHtml(path), title, htmlToPdf), ext: 'pdf' }
    case 'to-html':
      return { data: wrapHtmlDocument(await docxHtml(path), title), ext: 'html' }
    case 'to-md':
      return { data: htmlToMarkdown(await docxHtml(path)), ext: 'md' }
    case 'to-txt': {
      const mammoth = await loadMammoth()
      try {
        const text = (await mammoth.extractRawText({ path })).value
        return { data: text.replace(/\n{3,}/g, '\n\n').trim() + '\n', ext: 'txt' }
      } catch (err) {
        throw invalidInput("I couldn't read this Word document. It may be damaged, or it isn't a .docx file.", err)
      }
    }
    default:
      throw new EngineError('UNSUPPORTED')
  }
}
