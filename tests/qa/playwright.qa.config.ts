// QA exploratory suite (phase 3b): long-running, on demand, NOT part of CI's `npx playwright test`.
//   npm run build
//   LUD_FFMPEG_PATH=/usr/bin/ffmpeg QA_MODEL_PATH=<BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx> QA_HEIC=<real .HEIC> \
//   QA_PHOTOS=<a.jpg,b.jpg> xvfb-run -a npx playwright test -c tests/qa/playwright.qa.config.ts
// Results: test-results/qa-explore/results.jsonl (summarised in docs/qa/QA_REPORT.md).
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'explore',
  timeout: 15 * 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: '../../test-results/qa-explore/pw'
})
