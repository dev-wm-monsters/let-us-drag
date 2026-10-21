// Shared helpers for the QA exploratory suite (tests/qa/explore, run with tests/qa/playwright.qa.config.ts).
import type { ElectronApplication, TestInfo } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { JobEvent, OptionId } from '../../../src/shared/types'
import { REPO_ROOT } from '../../e2e/support/paths'
import { convertViaDrop, expectOverlayHidesItself } from '../../e2e/support/flows'
import { sha256 } from '../../e2e/support/fixtures'
import { ffmpegPath } from './validate'

export const RESULTS_DIR = join(REPO_ROOT, 'test-results', 'qa-explore')
const RESULTS_FILE = join(RESULTS_DIR, 'results.jsonl')

export interface Check {
  id: string
  what: string
  result: 'PASS' | 'FAIL' | 'NOTE'
  evidence: string
}

/** Append one check to test-results/qa-explore/results.jsonl (source for docs/qa/QA_REPORT.md). */
export function record(check: Check): void {
  mkdirSync(RESULTS_DIR, { recursive: true })
  appendFileSync(RESULTS_FILE, `${JSON.stringify({ ...check, at: new Date().toISOString() })}\n`)
}

export function resetResults(): void {
  mkdirSync(RESULTS_DIR, { recursive: true })
  writeFileSync(RESULTS_FILE, '')
}

export interface Conversion {
  event: JobEvent
  ms: number
  states: string[]
}

/**
 * Overlay flow: arm → drop on option → wait for done/error → wait until the overlay hid itself.
 * Also checks that every input is byte-identical afterwards.
 */
export async function convert(app: ElectronApplication, testInfo: TestInfo, label: string, inputs: string[], option: OptionId): Promise<Conversion> {
  const before = inputs.map((p) => {
    try {
      return sha256(p)
    } catch {
      return null // folders
    }
  })
  const t0 = Date.now()
  const { event, timeline } = await convertViaDrop(app, testInfo, label, inputs, option)
  const ms = Date.now() - t0
  await expectOverlayHidesItself(app)
  inputs.forEach((p, i) => {
    if (before[i] === null) return
    if (sha256(p) !== before[i]) throw new Error(`input changed by the conversion: ${p}`)
  })
  return { event, ms, states: dedupe(timeline.map((s) => s.state)) }
}

export function dedupe(items: readonly string[]): string[] {
  const out: string[] = []
  for (const i of items) if (out[out.length - 1] !== i) out.push(i)
  return out
}

export function outputs(event: JobEvent): string[] {
  if (event.type !== 'done') throw new Error(`expected done, got ${JSON.stringify(event)}`)
  return event.outputPaths
}

export function ff(args: string[]): void {
  const r = spawnSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], {
    shell: false,
    encoding: 'utf8',
    timeout: 300_000
  })
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed: ${r.stderr}`)
}

/** 1280x720 30 fps H.264 + AAC test clip with sound. */
export function makeVideo(path: string, seconds = 6, extra: string[] = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac']): string {
  ff([
    '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`,
    ...extra, '-shortest', path
  ])
  return path
}

export function makeAudio(path: string, seconds = 4, extra: string[] = []): string {
  ff(['-f', 'lavfi', '-i', `sine=frequency=523:duration=${seconds}`, '-ac', '2', ...extra, path])
  return path
}

export function short(s: string, n = 160): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}
