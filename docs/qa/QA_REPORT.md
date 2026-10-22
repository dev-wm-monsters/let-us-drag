# QA report — phase 4 regression + phase 3b final verification (v0.1, product-owner run)

QA engineer, 2026-10-21. Branch `qa/final`, based on `origin/develop` @ `5afa281` (rebased from `c2c4bfa`
when develop moved on during this phase; all numbers below are from `5afa281` unless marked).
Environment: Linux container + Xvfb only. macOS/Windows evidence comes from GitHub CI (not re-run here).

> **Read this first.** Section 0 is the phase-4 regression run (2026-10-22) on the fixes for B-046..B-063.
> Sections 1-5 below are the phase-3b report (2026-10-21) and are kept as history; where they disagree,
> section 0 wins.

## 0. Phase 4 regression (2026-10-22)

QA engineer, branch `qa/regression` from `origin/develop`. Gates and exploratory runs on `ba36ffa`
(phase-4 integration), then gates repeated on `a2fd77d` (develop moved on during the run: TPM ledger +
an Engine change to the Windows ENOENT message for over-long paths). Linux container + Xvfb
(1920x1080) only; macOS/Windows come from GitHub CI and the manual checklist.

### 0.1 Gates

| Gate | Command | `ba36ffa` | `a2fd77d` + this branch |
|---|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 | exit 0 |
| Lint | `npm run lint` | exit 0 | exit 0 |
| Unit + engine, **real model** | `LUD_FFMPEG_PATH=/usr/bin/ffmpeg LUD_MODEL_PATH=<isnet-general-use.onnx> npm test` | 38 files, **551 passed, 1 skipped** (read-only folder test: container runs as root). Real-model tests ran: `removebg.test.ts` 20/20 incl. D24 session lifecycle, `qa-removebg-repeat.test.ts` 1/1 | 39 files, **551 passed, 5 expected-fail, 1 skipped** (the 5 are QA's new `it.fails` repro of QA-P4-01) |
| Build | `npm run build` | exit 0 | exit 0 |
| E2E run 1 / 2 | `LUD_FFMPEG_PATH=/usr/bin/ffmpeg LUD_MODEL_PATH=<model> xvfb-run -a npx playwright test` | **63 passed, 1 skipped** (E2E-33, root) each, 3.9 min each; includes the new E2E-RMBG-REPEAT (3 Remove BG in one session, 24 s) | **63 passed, 1 skipped** each (3.8 min, 3.9 min) |
| Packaged Linux build | `node scripts/fetch-ffmpeg.mjs && npx electron-builder --linux --dir` then `xvfb-run -a node scripts/ci-smoke-packaged.mjs` | built (fuses applied), smoke: boots, settings written, alive after grace period | — |
| Security probes (packaged) | `node docs/security/tools/probes/run-probes.mjs release/linux-unpacked/let-us-drag` | 12/12 PASS (LUD_* stripped from the engine, ELECTRON_RUN_AS_NODE, NODE_OPTIONS, --inspect, --remote-debugging-port, cmd-prefix switches) | — |
| GitHub CI | `gh run list --branch develop` | CI on `ba36ffa` **failed** (Windows: over-long path reported as ENOENT), fixed by `a2fd77d`: CI on `a2fd77d` **success**. Package workflow on develop (00:46) success | — |

Flakiness: 4 E2E runs (2 per commit), identical results, no retries.

### 0.2 Phase-4 fixes, verified independently

Exploratory suite: `tests/qa/explore/*.spec.ts` incl. the new `phase4.spec.ts`, run with
`LUD_FFMPEG_PATH=/usr/bin/ffmpeg QA_MODEL_PATH=<model> QA_PHOTOS=girl-1.jpg,animal-1.jpg QA_DOWNLOAD=1 xvfb-run -a -s "-screen 0 1920x1080x24" npx playwright test -c tests/qa/playwright.qa.config.ts`
→ **23/23 tests passed, 103 recorded checks: 101 PASS, 2 FAIL** (both FAILs are the new bugs QA-P4-01/02 below;
two checks first failed for test reasons and were fixed in the test and re-run: FLOW-RMBG-DL-CANCEL, which sent
its cancel after the 179 MB had already arrived in ~5 s, and P4-MXSS, which put all payloads in one file so the
first unclosed `<math>` hid the rest). All 30 options of PLAN §5 still convert and validate with independent
decoders (CAT-*), all nasty inputs and cancel flows still PASS (no regression from phase 3b). `phase4.spec.ts`
re-run on the rebuilt `a2fd77d` (no download): 10/10 tests passed, same 12 verdicts.

| Bug | Verdict | My repro and evidence |
|---|---|---|
| B-046 Remove BG every 2nd time | **Fixed** | P4-RMBG-REPEAT, one app session, real ISNet model, real photos: girl → animal → girl again → *to-webp* → rotated photo → animal → **batch of 3** → girl: 8/8 jobs `done`, every cut-out 74-83 % transparent, 4-6 s each (batch 13 s), no `engine exited` in the log. Also CAT-IMG-RMBG-1/2 and FLOW-RMBG-DL/CACHED (5 Remove BG in the flows session). |
| B-047 download text | **Fixed** | P4-DL-STAGE: fresh userData, no `LUD_MODEL_PATH`, real download from github.com/danielgatis/rembg: caption "One-time download of my scissors (179 MB AI model) · N%" visible 0.8 s after the drop, 14-17 distinct rising values (1 % → 95 %), then "Finding the subject…"; box always inside the 560x560 window; job `done`. FLOW-RMBG-DL-CANCEL: cancel at the first download event → `CANCELLED`, caption read "· 4%", `models/` empty, no output. |
| B-048 hints clipped | **Fixed** | P4-HINTS (real app, feedMe, every option of image/video/audio/pdf/docx/md/csv/zip/folder/2 images, 49 hints): all inside the window, none covers another bubble, no text overflow. Remove BG hint fully readable ("Remove the background (first use downloads a 179 MB AI model, once)", x 92-322). Visual harness over white, black and grey: all hints readable (`tests/qa/visual-contrast.mjs`). Cosmetic: the Remove BG pill now sits over the Uncle's moustache. |
| B-049 long error cards | **Fixed** | P4-ERR-CARDS: real 138-char engine message (batch of two JSON → CSV, the second `42`) and an injected 200-char message (the engine's cap) on a running job: card 404-546 px of 560, inside, text not clipped, full text shown. |
| B-050 Esc during chew | Decided (D19) | FLOW-NOFOCUS-CHEW: while chewing the overlay is not focused and not focusable; the "Spit it out" click cancels without focus. |
| B-051 overlay catches clicks | **Fixed in code, Linux N/A by design; macOS/Windows = manual** | P4-CLICKTHROUGH-LINUX (real X11 clicks via XTest, another app window focused behind the overlay): the renderer requests click-through after the drop (`T`) and turns it off over the cancel button (`F`); main ignores it on Linux (0 native `setIgnoreMouseEvents(true)`), so a click next to the Uncle still hits the overlay (as before D20); a real click on "Spit it out" cancels. P4-CLICKTHROUGH-EMU (the test applies the renderer's requests to the real window, i.e. what main does on macOS/Windows, minus `forward`): a real click next to the chewing Uncle **reaches the window behind**, then moving onto "Spit it out" makes it clickable and the real click cancels. Not verifiable here: `forward: true` mouse-move forwarding on macOS/Windows, acceptFirstMouse, Windows UIPI. Checklist A.16/A.18b/B.14/B.16b. |
| B-052 focus after conversions | **Fixed** (Linux), manual on macOS/Windows | Both click-through tests sample the focused window every 100 ms through a cancel and a full conversion with spit card: overlay focused 0/43 samples, the other app window kept focus. Remaining by design (D20): feedMe (drop on the mouth) takes focus. |
| B-053 names > 255 bytes | **Fixed** | P4-LONG-NAMES: 246×"L" → Compress (248 B, `…-compressed.png`), 250×"W" → WEBP twice (248 B, then 252 B `… (1).webp`), 125×"é" → Compress (247 B), 61×"😀" → Compress (247 B, no split surrogate, valid UTF-8), 246×"M" → JPG, 246×"P" PDF → PNG pages; all exist and are ≤ 255 bytes. NASTY-LONG-2 (was FAIL) PASS. Windows: CI only (`a2fd77d`). |
| B-054 bold+italic → MD | **Fixed** | P4-MD-EMPHASIS: own DOCX with bold→italic (space in either run), bold+italic run, touching bold/italic in one word, literal `*`/`_`: Markdown renders back (marked) to exactly the original sentences. CAT-DOC-MD now `**great** *this time.*`. |
| B-055 dropFilesOnFeed | **Fixed** | P4-FEED-FIRST: right after launch, without opening the window: resolves in ~250 ms, converts (option) / shows held files (null). Workaround removed from `flows.spec.ts`; FLOW-FEED-1/2 PASS without it. |
| B-056 new gesture over a card | **Fixed** | P4-REARM: arm over a spit card, a choke card and the leave animation: card dismissed immediately, new drop converts (3/3); arm 120-360 ms after leave started (stale `overlayDone` race, `ba36ffa`): 5/5 OK. NASTY-B2B (was NOTE) PASS. |
| B-057 capture overwrites docs/art | **Fixed** | `LUD_SCREENS_DIR=<scratch> node src/renderer/dev/capture.mjs`: 35 files written there, `git status` clean. |
| B-058 --remote-debugging-port | **Fixed** | `node tests/qa/probes/debug-switches.mjs release/linux-unpacked/let-us-drag`: 11 spellings (`--remote-debugging-port=N`, with a space, single dash, UPPER CASE, `=0`, `-pipe`, with `-address=0.0.0.0`, after `--`, `--inspect`, `--inspect-brk`, `--js-flags`): every one exits 1 with "refusing to start with --…", no CDP answer, no new listening port; control run without switches stays up. Polling the port every 10 ms during startup: 0/925 connects. |
| B-059 dictionary download | **Fixed** | `node docs/security/tools/probes/netlog-proxy.mjs release/linux-unpacked/let-us-drag 30` → `[]` (zero requests in 30 s, first-run welcome window open). Positive control, stock Electron through the same proxy: `CONNECT redirector.gvt1.com:443` at 0.36 s. macOS uses the OS spell checker (not affected); Windows = same code path as Linux. |
| B-060 svg/math mXSS | **Fixed** (security); see QA-P4-01 | P4-MXSS: 17 payloads (svg/math/style/noscript/template/foreignObject/annotation-xml/xlink javascript:/entity-obfuscated javascript:/srcdoc/xmp/select-style), one Markdown file each, batch → HTML; every output rendered **without its CSP** in a throw-away window and re-parsed: no script ran, no svg/math/script/iframe/template/noscript, no `on*`, no `javascript:` (also after the second parse); CSP meta in 17/17. |
| B-061 licence gate | Happy path only | `fetch-ffmpeg.mjs` linux-x64: SHA-256 verified, "licence gate: ok (GPL build, no nonfree)". Fail-closed branches not exercised here. |
| B-062 ESLint child_process | **Fixed**, small gap (QA-P4-03) | default/namespace import, `exec`, `require()`, `shell: true` all rejected. `shell: '/bin/sh'` and a variable options object pass. |

### 0.3 Uncle visuals (regression look)

`LUD_SCREENS_DIR=<scratch> node src/renderer/dev/capture.mjs` (35 shots + 2 GIFs) and
`tests/qa/visual-contrast.mjs` (126 shots, white / near-black / grey): the Uncle is unchanged (bald head, wild
hair, moustache, glasses, gold tooth, mole with its hair in every state, head turn, happy squint, sweat + cough on
choke). New: the download caption is a dark pill under the ring with the percentage (readable on all three
backgrounds); hints stay inside the window; long error cards are moved up to stay inside. No visual regression.
Cosmetic only: the Remove BG hint now covers the moustache/mouth while hovered; a 200-char error card covers the
Uncle's coughing hand. **Found:** the held-files card covers bubbles (QA-P4-02, below), invisible in `docs/art`
because that capture holds a `.md` (5 options).

### 0.4 New bugs (proposed for docs/qa/BUGS.md; IDs to be assigned by the TPM)

| QA ID | Sev | Owner | Summary | Exact repro |
|---|---|---|---|---|
| QA-P4-02 | **Medium** | Frontend | **Held-files card covers option bubbles.** After dropping files on the Uncle's mouth (feedMe "Pick an option"), the `lud-held` card sits on the bottom of the ring and captures the mouse: overlay (560 px) with a picture: **ICO and Remove BG** centres covered (labels hidden, only the lower rim clickable); video: **MOV and ZIP**; 2+ pictures: ICO, Remove BG. **Feed Window** (default size) with a picture: **PDF, ICO, Remove BG, Compress** covered. Pre-existing (CSS unchanged since phase 2), not a phase-4 regression. Workaround: drop directly on the bubble, or Esc and redo. | Overlay: arm → `__ludTest.dropFiles([photo.png], null)` → `document.elementFromPoint(centre of option-to-ico)` is inside `[data-testid=held-files]` (P4-HELD-COVER). Feed: `__ludTest.dropFilesOnFeed([photo.png], null)` → same check, 4 of 8 covered. Manually: Feed Window → drop `photo.png` on the Uncle → try to click ICO / Remove BG. |
| QA-P4-01 | Low | Engine | **Unclosed `<svg>`/`<math>`/`<noscript>`/`<template>` swallows the rest of the document** in MD/HTML → HTML/PDF: the sanitizer drops "with content" until the matching end tag, so with no end tag everything after it is silently missing from the output (a browser would end it at the enclosing block). Not a security issue. svg/math are new in this list (B-060 fix `2acc16f`); noscript/template were already affected. | `notes.md` = `Before.\n\n<svg><circle r="4">\n\nAfter.\n` → HTML (or PDF): output has "Before." only. `npx vitest run tests/engine/qa-sanitizer-truncation.test.ts` (5 cases as `it.fails`; flip to `it` when fixed). P4-SANITIZER-TRUNCATION. |
| QA-P4-03 | Low | TPM | ESLint SEC-146 rule matches only the literal `shell: true`; `spawn(f, a, { shell: '/bin/sh' })` and `spawn(f, a, opts)` with `opts.shell = true` pass. No such code exists today. | `printf "import { spawn } from 'node:child_process'\nspawn('x', [], { shell: '/bin/sh' })\n" \| npx eslint --stdin --stdin-filename src/main/x.ts` → no error. |

Observations (not filed): the click-through state only re-evaluates on a pointer move or a cursor-poll
change, so if the pointer already rests exactly on "Spit it out" when it appears, the very first click without
moving could pass through on macOS/Windows (very unlikely: the button appears away from the drop point).
`docs/qa/BUGS.md` already lists B-046..B-062 as Fixed (TPM, `018dc7c`); my verdicts above agree, with the B-051/
B-052 macOS/Windows parts still to be confirmed by hand.

### 0.5 Confidence that v0.1 works for the product owner (macOS + Windows), phase 4

**Overall: 72 / 100** (was 62).

| Area | Score | Why |
|---|---|---|
| Install + first launch | 80 | Unchanged: packaged apps smoke-start in CI on macOS arm64/x64 and Windows; packaged Linux build re-checked here (smoke, 12/12 security probes, debug switches refused, zero network at launch). Gatekeeper "Open Anyway" (macOS 15) and SmartScreen remain the friction. |
| The gesture (Shift-drag summons the Uncle) | 60 | Still never run on real macOS/Windows hardware by us: uiohook during OS drags, a 1 %-alpha window as drop target, Accessibility grant. Phase 4 adds a new native path in the same window (`setIgnoreMouseEvents` toggled per state, `acceptFirstMouse`); it is reset to "clickable" on every arm, which I verified at the logic level only. The Feed Window remains a working fallback. |
| Conversions (all §5 options) | 90 | All options convert and validate independently; no regression; long/multibyte names fixed; Windows path fixes CI-verified only. |
| Remove BG | 80 | Was 40. 13 Remove BG jobs incl. a batch of 3 in single sessions, all correct, engine never restarts; download caption visible; cancel during the download clean. Not verified on Apple silicon / Windows natively (same onnxruntime-node path as Linux, CI engine tests green), Intel-Mac wasm speed unknown. |
| Cancel / errors / robustness | 85 | Cancel at every stage, friendly errors, long cards fit, re-arm over cards works. Esc during chew is by design button-only. Risk: the cancel button's first click without focus on macOS (acceptFirstMouse) and Windows is manual-only. |
| The Uncle (look and feel) | 80 | Charming and unchanged; hints/cards now fit. Down from 85 because of QA-P4-02: in the Feed Window "drop on the Uncle, then pick" (checklist A.23) half the bubbles are hidden under the file card. |
| Settings, modes, tray, Feed Window | 80 | Persistence, Plain/Hungry, Feed conversions verified; tray, login items, window-to-front manual-only; QA-P4-02 hits the Feed Window's held flow. |
| Click-through / no focus (new D20 behaviour) | 60 | Renderer logic verified end to end with real X11 clicks (emulated macOS/Windows semantics); the OS-specific parts (`forward` move events, first click on an inactive window, focus staying in Finder/Explorer) can only be checked by hand. If it misbehaves, the likely symptom is a cancel button that needs two clicks, or clicks next to the Uncle that do nothing (the pre-phase-4 state). |

The score rises mainly because B-046 (the bug the PO was most likely to hit) is fixed and verified in depth. It
stays below 80 because the gesture and the new click-through/no-focus behaviour exist only on macOS/Windows and
have no automated coverage there, and because QA-P4-02 is visible in a flow the checklist asks for.

---

## 1. Automated gates (exact numbers)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 (c2c4bfa and 5afa281) |
| Lint | `npm run lint` | exit 0 (both) |
| Unit + engine | `LUD_FFMPEG_PATH=/usr/bin/ffmpeg npm test` | c2c4bfa: 31 files, **440 passed, 3 skipped**. 5afa281 + this branch: 31 files passed + 1 skipped file, **441 passed, 5 skipped** (the 2 extra skips are QA's new real-model test and an existing one; both need `LUD_MODEL_PATH`) |
| Unit + engine with the real model | `LUD_MODEL_PATH=<isnet-general-use.onnx> npx vitest run tests/engine/removebg.test.ts tests/engine/qa-removebg-repeat.test.ts` | 11/11 + 1/1 passed (plain Node; see QA3-01 for why this misses the in-app crash) |
| Build | `npm run build` | exit 0 |
| E2E run 1 / 2 (c2c4bfa) | `LUD_FFMPEG_PATH=/usr/bin/ffmpeg xvfb-run -a npx playwright test` | **62 passed, 1 skipped** (E2E-33, root ignores folder permissions) — 3.6 min each, identical |
| E2E run 3 / 4 (5afa281) | same | **62 passed, 1 skipped** each (3.5 min, 3.4 min) |
| Flakiness | 4 runs | none: 4/4 runs identical (62 passed, 1 skipped), no retries configured |
| GitHub CI | `gh run list --branch develop` | CI on `c2c4bfa` **failed on windows-latest** (unit + engine step); fixed by `a3012ec`/`5afa281`, CI on `5afa281` **success** (Linux/macOS/Windows). Package workflow on `c2c4bfa` success. |

## 2. Exploratory testing through the real app

How: Playwright `_electron` against the built unpackaged app with the E2E hooks (`arm` → `dropFiles(paths, option)`,
i.e. the overlay flow, the same renderer path as a real drop once paths are known), outputs decoded with tools
**independent of the app's code path**: ffprobe + full ffmpeg decode, poppler `pdfinfo`/`pdftotext`, sharp,
mammoth, exceljs, yauzl, js-yaml. Inputs are checked byte-identical after every job.
Code: `tests/qa/explore/*.spec.ts` (run with `tests/qa/playwright.qa.config.ts`, see its header), probes and the
visual script `tests/qa/visual-contrast.mjs`. Raw results: `test-results/qa-explore/results.jsonl`.

Real-world fixtures: a real **HEVC HEIC** made with libheif/x265 (pillow-heif; sharp can only write AV1 HEIF),
two real photos from the rembg examples (`girl-1.jpg` 600x399 with EXIF, `animal-1.jpg` 1000x667 progressive),
the real ISNet model fetched with `node scripts/fetch-model.mjs` (SHA-256 `60920e99…` verified).

### 2.1 Every option of PLAN §5, plus nasty inputs and flows (automated exploratory run on 5afa281)

**90 checks: 84 PASS, 4 FAIL, 2 NOTE.** All 30 options of §5 convert a realistic fixture through the overlay flow; the
only option failure is the second Remove BG of a session (QA3-01). Same results on c2c4bfa (earlier run).

| ID | What | Result | Evidence |
|---|---|---|---|
| CAT-IMG-PNG | Phone JPG (EXIF orientation 6) → PNG | PASS | Phone photo.png png 1500x2000; 1865 ms; states hidden→feedMe→eat→chew→spit |
| CAT-IMG-JPG | Transparent PNG → JPG | PASS | logo.jpg jpeg 512x512, corner rgb 255,255,255 (white expected); 2061 ms; states hidden→feedMe→eat→chew→spit |
| CAT-IMG-WEBP | PNG → WEBP | PASS | shot.webp webp 800x600 83334 B; 1334 ms; states hidden→feedMe→eat→chew→spit |
| CAT-IMG-AVIF | PNG → AVIF | PASS | shot2.avif avif(heif/av1) 800x600; 3969 ms; states hidden→feedMe→eat→chew→spit |
| CAT-IMG-PDF | 3 images (jpg, png, webp) → one PDF | PASS | scan1 (merged).pdf 3 pages (pdfinfo); 1385 ms; states hidden→feedMe→eat→chew→spit |
| CAT-IMG-ICO | PNG → ICO | PASS | logo.ico ICO sizes 16,32,48,64,128,256; ffprobe png; 1357 ms; states hidden→feedMe→eat→chew→spit |
| CAT-IMG-COMPRESS | Big photo PNG → Compress | PASS | big shot-compressed.png 5770580 → 406627 B (7 %); 1339 ms; states hidden→feedMe→eat→chew→spit |
| CAT-IMG-HEIC | iPhone-style HEIC (HEVC, x265) → JPG | PASS | IMG_0042.jpg jpeg 1200x900; 1345 ms; states hidden→feedMe→eat→chew→spit |
| CAT-IMG-BMP | BMP → PNG | PASS | paint.png png 320px; 1357 ms; states hidden→feedMe→eat→chew→spit |
| CAT-IMG-ICOIN | ICO → PNG | PASS | favicon.png png 64px; 2048 ms; states hidden→feedMe→eat→chew→spit |
| CAT-IMG-TIFF | TIFF → JPG | PASS | scan.jpg jpeg; 2084 ms; states hidden→feedMe→eat→chew→spit |
| CAT-IMG-GIF | GIF → WEBP | PASS | meme.webp webp; 2056 ms; states hidden→feedMe→eat→chew→spit |
| CAT-VID-MP4 | MOV → MP4 (H.264/AAC) | PASS | iphone clip.mp4 h264+aac 1280x720 4.02 s; 2957 ms; states hidden→feedMe→eat→chew→spit |
| CAT-VID-MOV | MP4 → MOV | PASS | holiday.mov h264+aac 6.01 s; 2927 ms; states hidden→feedMe→eat→chew→spit |
| CAT-VID-WEBM | MKV → WEBM (VP9/Opus) | PASS | show.webm vp9+opus 3.05 s; 1919 ms; states hidden→feedMe→eat→chew→spit |
| CAT-VID-GIF | MP4 → GIF (≤15 fps, ≤480 px) | PASS | holiday.gif gif 480x270 14.3 fps 1189072 B; 2975 ms; states hidden→feedMe→eat→chew→spit |
| CAT-VID-MP3 | AVI (mpeg4+mp3) → MP3 audio | PASS | old.mp3 mp3 3.06 s; 1331 ms; states hidden→feedMe→eat→chew→spit |
| CAT-VID-WAV | MP4 → WAV audio | PASS | holiday.wav pcm_s16le 6.01 s; 1336 ms; states hidden→feedMe→eat→chew→spit |
| CAT-VID-COMPRESS | MP4 → Compress (H.264 CRF 28) | PASS | holiday-compressed.mp4 h264+aac 2064234 → 905135 B; 2958 ms; states hidden→feedMe→eat→chew→spit |
| CAT-AUD-MP3 | FLAC → MP3 | PASS | song.mp3 mp3 5.04 s; 1804 ms; states hidden→feedMe→eat→chew→spit |
| CAT-AUD-WAV | M4A → WAV | PASS | voice.wav pcm_s16le 5.02 s; 1349 ms; states hidden→feedMe→eat→chew→spit |
| CAT-AUD-M4A | WAV → M4A | PASS | memo.m4a aac 5.00 s; 1352 ms; states hidden→feedMe→eat→chew→spit |
| CAT-AUD-OGG | OPUS → OGG | PASS | call.ogg vorbis 5.00 s; 1338 ms; states hidden→feedMe→eat→chew→spit |
| CAT-AUD-FLAC | WAV → FLAC | PASS | memo.flac flac 5.00 s; 1382 ms; states hidden→feedMe→eat→chew→spit |
| CAT-AUD-COMPRESS | MP3 320k → Compress (MP3 128k) | PASS | podcast-compressed.mp3 mp3 30.04 s; 1202721 → 481115 B; 1939 ms; states hidden→feedMe→eat→chew→spit |
| CAT-PDF-PNG | 3-page PDF → PNG pages | PASS | contract (pages)/ {page-01.png, page-02.png, page-03.png} magic 89504e47; 1995 ms; states hidden→feedMe→eat→chew→spit |
| CAT-PDF-JPG | 3-page PDF → JPG pages | PASS | contract (pages) (1)/ {page-01.jpg, page-02.jpg, page-03.jpg} magic ffd8ffdb; 1338 ms; states hidden→feedMe→eat→chew→spit |
| CAT-PDF-TXT | PDF → TXT | PASS | contract.txt 50 chars, has "Contract page 1..3"; 2042 ms; states hidden→feedMe→eat→chew→spit |
| CAT-PDF-MERGE | 3-page + 2-page PDF → Merge | PASS | contract (merged).pdf 5 pages (pdfinfo); 1331 ms; states hidden→feedMe→eat→chew→spit |
| CAT-DOC-PDF | DOCX → PDF | PASS | Quarterly report.pdf 1 page(s), text has heading + table; 1350 ms; states hidden→feedMe→eat→chew→spit |
| CAT-DOC-HTML | DOCX → HTML | PASS | Quarterly report.html 1996 chars, CSP meta, table, no script; 2053 ms; states hidden→feedMe→eat→chew→spit |
| CAT-DOC-MD | DOCX → Markdown | PASS | Quarterly report.md: "# Quarterly Report\n\nRevenue was **great***this time.*\n\n- First point\n- Second po"; 2031 ms; states hidden→feedMe→eat→chew→spit |
| CAT-DOC-TXT | DOCX → TXT | PASS | Quarterly report.txt: "Quarterly Report\n\nRevenue was great this time.\n\nFirst point\n\nSecond point\n\nRegio"; 2048 ms; states hidden→feedMe→eat→chew→spit |
| CAT-TXT-PDF | Markdown (unicode + emoji) → PDF | PASS | notes.pdf 1 page(s); CJK present: true; emoji present: true; 1348 ms; states hidden→feedMe→eat→chew→spit |
| CAT-TXT-HTML | Markdown → HTML | PASS | notes.html 2176 chars with h1 + table; 2039 ms; states hidden→feedMe→eat→chew→spit |
| CAT-TXT-DOCX | Markdown → DOCX | PASS | notes.docx mammoth text 152 chars; 1338 ms; states hidden→feedMe→eat→chew→spit |
| CAT-TXT-TXT | HTML → TXT | PASS | page.txt: "Hello HTML\n\nPara with bold.\n\n- apple\n- banana\n"; 2035 ms; states hidden→feedMe→eat→chew→spit |
| CAT-TXT-HTML2 | TXT → HTML | PASS | readme.html contains text: true; 2069 ms; states hidden→feedMe→eat→chew→spit |
| CAT-TXT-PDF2 | HTML → PDF | PASS | page.pdf 1 page(s); 1357 ms; states hidden→feedMe→eat→chew→spit |
| CAT-DAT-JSON | CSV (quotes, newline in cell, unicode) → JSON | PASS | people (1).json 3 rows; row3={"name":"Zoë \"Z\" Ünïc","age":"7","city":"Line\nbreak"}; 2279 ms; states hidden→feedMe→eat→chew→spit |
| CAT-DAT-YAML | JSON → YAML | PASS | people.yaml parsed [{"name":"Ann","age":31,"tags":["a","b"]},{"name":"Bob","age":42,"city":"Berlin"; 2056 ms; states hidden→feedMe→eat→chew→spit |
| CAT-DAT-XLSX | YAML → XLSX | PASS | config.xlsx rows [["name","age"],["Ann",31],["Bob",42]]; 1335 ms; states hidden→feedMe→eat→chew→spit |
| CAT-DAT-CSV | XLSX → CSV | PASS | budget.csv: "item,cost\nrent,1200\nfood,350.5\n"; 2071 ms; states hidden→feedMe→eat→chew→spit |
| CAT-ARC-UNZIP | ZIP (nested folders) → Unzip | PASS | photos/ has a.txt, sub/b.txt, sub/deeper/c.txt; 2030 ms; states hidden→feedMe→eat→chew→spit |
| CAT-ANY-ZIPDIR | Folder → ZIP | PASS | My stuff.zip entries My stuff/inner/two.txt, My stuff/one.txt; 2057 ms; states hidden→feedMe→eat→chew→spit |
| CAT-ANY-ZIPMIX | Mixed batch PNG + MP3 → ZIP | PASS | Archive.zip entries mixed.mp3, mixed.png; 2036 ms; states hidden→feedMe→eat→chew→spit |
| CAT-IMG-RMBG-1 | Real photo girl-1.jpg → Remove BG | PASS | girl-1-nobg.png 83 % transparent, corners clear: true; 5098 ms; states hidden→feedMe→eat→chew→spit |
| CAT-IMG-RMBG-2 | Real photo animal-1.jpg → Remove BG | **FAIL** (QA3-01) | job ended with {"type":"error","jobId":"45f5a8d4-37b0-4823-b953-5b0bacd7964f","error":{"code":"INTERNAL","message":"The converter stopped unexpectedly. Please try again."}} |
| NASTY-LONG-1 | 250-char file name → WEBP (same length) | PASS | done → L…LLLLLL.webp; states hidden→feedMe→eat→chew→spit |
| NASTY-LONG-2 | 250-char file name → Compress (adds "-compressed", 261 chars) | **FAIL** (QA3-08) | error OUTPUT_NOT_WRITABLE: "I can't save next to the original. That folder doesn't let me write."; states hidden→feedMe→eat→chew→choke |
| NASTY-LONG-3 | 250-char file name → PDF pages (folder " (pages)") | PASS | done → P…PPPPPP.png; states hidden→feedMe→eat→chew→spit |
| NASTY-NAME-1 | emoji + RTL + quotes + #%&$ in the name → JPG | PASS | done → Ünïcødé 😀🎉 שלום עולם "quoted" 'single' #1 %20 & more; $HOME ~ (copy) [x] {y}.jpg; states hidden→feedMe→eat→chew→spit |
| NASTY-NAME-2 | name that looks like ffmpeg flags ("-y -i evil.png") → ICO (ffmpeg path) | PASS | done → -y -i evil.ico; states hidden→feedMe→eat→chew→spit |
| NASTY-NAME-3 | NFD (decomposed) unicode name → AVIF | PASS | done → Café décomposé.avif; states hidden→feedMe→eat→chew→spit |
| NASTY-NAME-4 | file without extension → ZIP (only option) | PASS | done → README.zip; states hidden→feedMe→eat→chew→spit |
| NASTY-NAME-5 | dotfile ".hidden.png" → JPG | PASS | done → .hidden.jpg; states hidden→feedMe→eat→chew→spit |
| NASTY-NAME-6 | upper-case extension .PNG → WEBP | PASS | done → SCREAMING.webp; states hidden→feedMe→eat→chew→spit |
| NASTY-NAME-7 | PNG content with a .jpg extension → WEBP | PASS | done → actually-a-png.webp; states hidden→feedMe→eat→chew→spit |
| NASTY-DEEP-1 | deeply nested input (path 504 chars) → JPG | PASS | done → deep photo.jpg; states hidden→feedMe→eat→chew→spit |
| NASTY-RO-1 | read-only input file (0444) → JPG | PASS | done → readonly.jpg; states hidden→feedMe→eat→chew→spit |
| NASTY-ZERO-empty.png | 0-byte empty.png → to-jpg | PASS | error INPUT_INVALID: "This doesn't look like a picture I can read. It may be damaged, or it isn't what its name says."; states hidden→feedMe→eat→chew→choke |
| NASTY-ZERO-empty.mp4 | 0-byte empty.mp4 → to-gif | PASS | error INPUT_INVALID: "I couldn't find any audio or video in this file. It may be damaged, or it isn't what its name says."; states hidden→feedMe→eat→chew→choke |
| NASTY-ZERO-empty.pdf | 0-byte empty.pdf → pdf-to-png | PASS | error INPUT_INVALID: "This doesn't look like a PDF. It may be damaged, or it isn't what its name says."; states hidden→feedMe→eat→chew→choke |
| NASTY-ZERO-empty.docx | 0-byte empty.docx → to-pdf | PASS | error INPUT_INVALID: "I couldn't open this Word document. It may be damaged, or it isn't what its name says."; states hidden→feedMe→eat→chew→choke |
| NASTY-ZERO-empty.csv | 0-byte empty.csv → to-json | PASS | error INPUT_INVALID: "This CSV file is empty."; states hidden→feedMe→eat→chew→choke |
| NASTY-ZERO-empty.md | 0-byte empty.md → to-pdf | PASS | done → empty (1).pdf; states hidden→feedMe→eat→chew→spit |
| NASTY-ZERO-empty.zip | 0-byte empty.zip → unzip | PASS | error INPUT_INVALID: "I couldn't open this zip file. It may be damaged."; states hidden→feedMe→eat→chew→choke |
| NASTY-ZERO-empty.mp3 | 0-byte empty.mp3 → to-wav | PASS | error INPUT_INVALID: "I couldn't find any audio or video in this file. It may be damaged, or it isn't what its name says."; states hidden→feedMe→eat→chew→choke |
| NASTY-TEMP | no temp files left in the work folder after all of the above | PASS | none |
| NASTY-1GB-1 | 1 GB sparse "huge.mp4" (zeros) → Compress | PASS | moods seen none,struggle; error INPUT_INVALID: "I couldn't find any audio or video in this file. It may be damaged, or it isn't what its name says." after 4329 ms |
| NASTY-1GB-2 | 4 s H.264 clip padded to 1 GB (sparse tail) → GIF | PASS | moods seen struggle; done → real big.gif after 5853 ms |
| NASTY-BATCH-1 | 20 PNGs → JPG (each) | PASS | 20 outputs in 1397 ms; states hidden→eat→chew→spit |
| NASTY-BATCH-2 | 20 PNGs → one PDF (merge) | PASS | done → batch 01 (merged).pdf, 20 pages, 1412 ms |
| NASTY-TWICE | same file dropped twice within a few ms | PASS | 1 job(s), outputs twice.webp |
| NASTY-B2B | second drag+drop while the first result card is still visible (spit) | NOTE (QA3-11) | first done → first.jpg; second NO JOB STARTED (drop ignored); overlay visible now: false — the test hook can only drop on a resting overlay; a real drag onto the visible Uncle takes another path |
| NASTY-MODES | Plain + Hungry switched on while the Uncle chews; next gesture uses Plain | PASS | running job done → mid.webm; data-plain during that chew right after the switch=true; next job done → after switch.jpg data-plain=true |
| NASTY-TRUNC-MP4 | MP4 cut to 1/3 (no moov atom at end) → MP3 | PASS | error INPUT_INVALID: "I couldn't find any audio or video in this file. It may be damaged, or it isn't what its name says." |
| NASTY-TRUNC-PDF | PDF cut to 400 bytes → PNG pages | PASS | error INPUT_INVALID: "I couldn't open this PDF. It may be damaged." |
| NASTY-48MP | 48 MP PNG (8000x6000) → AVIF | PASS | done → portrait.avif 8000x6000 in 21084 ms |
| FLOW-CANCEL-EAT | cancel during "eat" (right after the drop) | PASS | cancelled at eat; error CANCELLED: "Cancelled." after 123 ms; bubble "Fine, keep it."; leftovers []; ffmpeg procs 0; overlay hid: true |
| FLOW-CANCEL-EARLY | cancel early in chew (first progress event) | PASS | cancelled at chew, progress 0.05; error CANCELLED: "Cancelled." after 598 ms; bubble "Fine, keep it."; leftovers []; ffmpeg procs 0; overlay hid: true |
| FLOW-CANCEL-LATE | cancel late in chew (progress ≥ 0.8) | PASS | cancelled at chew, progress 0.82; error CANCELLED: "Cancelled." after 389 ms; bubble "Fine, keep it."; leftovers []; ffmpeg procs 0; overlay hid: true |
| FLOW-ESC | Esc during chew (overlay drop on an option, not the held-files flow) | **FAIL** (QA3-05) | overlay focused=false, focusable=false while chewing → a real Esc key press goes to the app under the cursor, not to the Uncle. Synthetic Esc delivered to the page: error CANCELLED: "Cancelled." |
| FLOW-CANCEL-AFTER | conversion right after 4 cancels | PASS | done → after.jpg |
| FLOW-RMBG-DL-CANCEL | Remove BG first use: cancel during the 179 MB download | NOTE (test timing) | stages ["Chewing","One-time download of my scissors (179 MB AI model)"]; bubble "null"; ring ""; done → girl-1-nobg.png; models dir after: [isnet-general-use.onnx] — the cancel was sent only after a blocking read of the absent speech bubble, when the job had finished; PROBE-RMBG-CANCEL-DL shows cancel during the download works. Bubble null + ring empty = QA3-02 |
| FLOW-RMBG-DL | Remove BG first use: download + verify + cut-out | **FAIL** (QA3-01) | error INTERNAL: "The converter stopped unexpectedly. Please try again." after 5 s; ; models dir: [isnet-general-use.onnx] — this was the 2nd Remove BG of the session |
| FLOW-RMBG-CACHED | Remove BG second use (cached model) | PASS | done → girl-1-nobg (1).png in 6101 ms |
| FLOW-SETTINGS | trigger key, sounds, hungry, plain persist across a restart | PASS | store {"triggerKey":"alt","sounds":false,"hungryMode":true,"plainMode":true,"launchAtLogin":false,"firstRunDone":false}; UI {"triggerKey":"alt","sounds":"false","hungryMode":"true","plainMode":"true","launchAtLogin":"false"}; files settings.json |
| FLOW-FEED-1 | Feed Window drop on WEBP (Plain + Hungry on) | PASS | done → feed me.webp |
| FLOW-FEED-2 | Feed Window drop on the Uncle → pick AVIF | PASS | done → feed me.avif; window still open: true |

### 2.2 Targeted probes (QA3-01 minimal repro committed as `tests/qa/probes/ort-utility/`; the others are one-off scripts, repro commands in §4)

| ID | What | Result | Evidence |
|---|---|---|---|
| PROBE-RMBG-SEQ | Remove BG ×2 in one session (animal → girl), then girl ×2, girl → to-png → girl | **FAIL** | 1st done; 2nd `INTERNAL` "The converter stopped unexpectedly", main log `engine exited with code 5`; worker restarts, so the 3rd works again: every second Remove BG fails (QA3-01) |
| PROBE-ORT-MIN | Minimal: onnxruntime-node 1.30 `session.run` ×3 in an Electron 45 `utilityProcess` (no sharp, no app code) | **FAIL** | run 0 ok, then `child exit 5`. Same with a **new InferenceSession per run: 3/3 ok**. onnxruntime-**web** (wasm) ×3: 3/3 ok |
| PROBE-RMBG-CANCEL-DL | Cancel at the first "One-time download…" progress event (fresh userData, real upstream download) | PASS | `CANCELLED` 27 ms after the cancel; no `models/` file and no output left |
| PROBE-RMBG-CANCEL-INFER | Cancel at stage "Finding the subject" (real model) | PASS | `CANCELLED` after 2.8 s (ONNX run is not interruptible; aborts right after); no output |
| PROBE-RMBG-DL | First use: real 179 MB download from github.com/danielgatis/rembg, verify, cut-out | PASS (download) | download + verify + first cut-out OK (the earlier run's "cancel during download" arrived after the fast download had finished: not a bug) |
| PROBE-D15-TEXT | During the download, is "One-time download of my scissors (179 MB AI model)" visible? | **FAIL** | engine sends the stage; overlay `speech-bubble` absent, `progress-ring` text empty. `Model.stage` is stored but never rendered (QA3-02) |
| PROBE-LONG-ERR | Real app, 116-char engine message (JSON `42` → CSV) | **FAIL** | error card runs off the bottom of the 560 px overlay: "This file has a different shape." is cut (QA3-04) |
| PROBE-FEED-OPEN | `dropFilesOnFeed` when the Feed Window is not open yet | **FAIL** (test hook) | never resolves (30 s, 4 variants); works when the window was opened first (QA3-10) |
| PROBE-ESC | Overlay focus while chewing after a drop on a bubble | **FAIL** | `isFocused()=false`, `isFocusable()=false`: a real Esc goes to Finder/Explorer, only the × button cancels (QA3-05) |

### 2.3 Not testable here (left to the manual checklist)

Real Finder/Explorer drags + uiohook (U1), the near-transparent window as a drop target on macOS/Windows (U2),
MIME types during dragover (U3), Gatekeeper/SmartScreen, Accessibility grant/revoke/re-grant, fullscreen apps,
mixed-DPI, elevated windows, tray rendering, read-only **folders** (container runs as root), installed-app
PDF on Windows, Intel-Mac wasm Remove-BG speed, sounds.

## 3. Visual review (product-owner eyes)

Sources: `node src/renderer/dev/capture.mjs` (33 screenshots + GIFs), `tests/qa/visual-contrast.mjs` (126 shots
at the **real 560x560 overlay size** over white `#fff`, near-black `#111` and mid-grey, every option of 5
categories hovered, feedMe, held, spit/choke with long texts, Plain Mode), real-app screenshots from E2E
(`test-results/screens`, 500+), `docs/art/hero.gif` (90 frames, sampled at 2 fps).

- **Charm:** yes. Bald head, wild side hairs, bushy moustache, round glasses, gold tooth, waistcoat and bow tie,
  happy squint on spit, sweat drops and a hand-to-mouth cough on choke. Reads well at 560 px.
- **Mole:** visible in every state (dark brown dot left of the nose with a hair), also on black.
- **Head turn:** clearly visible (look-top-left/right/bottom shots and the hero GIF: face features shift, eyes aim at the cursor / hovered bubble).
- **Labels on light and dark desktops:** bubbles are cream with a dark ink ring and dark text: readable on white,
  black and grey. The hover hint is white text on a dark pill: fine on white and grey; on black the pill edge disappears but the text stays readable.
  The Uncle's dark outline merges into a black desktop (silhouette less crisp; skin and hair still read). Cosmetic.
- **Clipping/overlap (bugs):** QA3-03 hint of left-hand bubbles clipped at the window edge (worst: the Remove BG
  one-time-download notice reads "…round (first use downloads a 179 MB AI model, once)"); the hint pill also covers
  the ICO bubble. QA3-04 long error cards run off the bottom edge. Filenames in the result card are middle-ellipsised (good).
- **Cancel button:** red × with a "Spit it out" label on the ring: findable. In the hero GIF frames the × is small (≈ 20 px) but fine on screen.
- Dev tool note: `capture.mjs` rewrites `docs/art/hero.gif` and `uncle-eat-chew-spit.gif` even when `LUD_SCREENS_DIR` points elsewhere (QA3-12).

## 4. Bugs found in phase 3b (proposed for docs/qa/BUGS.md, IDs to be assigned by the TPM)

| QA ID | Sev | Owner | Summary | Exact repro |
|---|---|---|---|---|
| QA3-01 | **High** | Engine | **Remove BG fails every second time in a session.** The engine `utilityProcess` dies (exit code 5) on the second `session.run()` of the cached onnxruntime-node `InferenceSession`; the user sees "The converter stopped unexpectedly". The worker restarts, so the next try works. Affects onnxruntime-node platforms (Linux verified; Apple-silicon Mac and Windows-with-VC++-runtime use the same backend: expected, unverified). Intel Mac / Windows without VC++ (wasm) are not affected (probe). CI misses it: the real-model test runs in plain Node, where it passes. Fix hint: new `InferenceSession` per job (verified 3/3 in a utilityProcess) or run ORT outside the cached session; add an Electron-level test | `npm run build`; `node scripts/fetch-model.mjs <dir>`; `LUD_E2E=1 LUD_MODEL_PATH=<dir>/isnet-general-use.onnx` start the app, `__ludTest.dropFiles([photoA], 'remove-bg')` → done, then `dropFiles([photoB], 'remove-bg')` → `INTERNAL`, main log `[lud] engine exited with code 5`. Or `QA_PHOTOS=a.jpg,b.jpg QA_MODEL_PATH=… xvfb-run -a npx playwright test -c tests/qa/playwright.qa.config.ts catalog.spec.ts:468`. Minimal: `MODEL=<onnx> xvfb-run -a node_modules/electron/dist/electron --no-sandbox tests/qa/probes/ort-utility/main.js node` → `child exit 5` (`node-fresh` → 3/3 ok) |
| QA3-02 | Medium | Frontend | D15 not fully implemented: the engine's stage text ("One-time download of my scissors (179 MB AI model)", "Checking the download") is stored in `Model.stage` but never rendered; during the first Remove BG the user sees only a silent chewing ring (minutes on slow Wi-Fi) | Fresh userData, no `LUD_MODEL_PATH`; drop a photo on Remove BG; while progress events carry the download stage, `[data-testid=speech-bubble]` is absent and `[data-testid=progress-ring]` has no text (`src/renderer/overlay/state.ts` `speech()` returns null for chew) |
| QA3-03 | Medium | Frontend | Option hints of the left/right bubbles are clipped by the 560 px overlay edge; the Remove BG hint (the D15 download notice) loses its first words; the pill overlaps the ICO bubble | `node tests/qa/visual-contrast.mjs <dir>` → `white-image-hover-remove-bg.png`; also `docs/art/screens/overlay-03-hover-remove-bg.png` and the hero GIF |
| QA3-04 | Medium | Frontend | Error card is cut off at the bottom of the overlay for messages over ~100 chars (several engine messages are 110–140 chars) | Real app: JSON file containing `42` → CSV; card text "…This file has a different shape." cut at y=560 (E2E screenshot `QA-NASTY…zero-empty.mp3-04-choke.png` shows a 101-char message already touching the edge) |
| QA3-05 | Medium (docs) / Low (code) | Frontend + Platform | Esc cannot cancel a running conversion started by dropping on a bubble: the overlay is shown inactive and `setFocusable(false)` while chewing, so the key goes to the app under the cursor. D3 says "Esc when focused", so this is by design, but the old manual checklist (A.14/B.12) told the PO to press Esc. Checklist fixed; consider a global Esc shortcut while chewing | `flows.spec.ts` FLOW-ESC: during chew `BrowserWindow.isFocused()=false`, `isFocusable()=false` |
| QA3-06 | Medium | Platform | While a conversion runs (minutes for big videos) the 560x560 always-on-top overlay with its `rgba(0,0,0,0.01)` background keeps catching clicks: nothing under/around the Uncle is clickable. No `setIgnoreMouseEvents` anywhere. Needs confirmation on macOS/Windows (checklist A.16/B.14) | Code: `src/renderer/common/styles.css:40`, no `setIgnoreMouseEvents` in `src/main`; manual: convert a > 200 MB video and click next to the Uncle |
| QA3-07 | Low | Platform | After every conversion the overlay calls `win.focus()` for the result card (interactive), i.e. it takes keyboard focus from the user's app for ~2.5 s; whether focus returns afterwards is OS-dependent | `src/main/windows/overlay.ts` `setInteractive` → `focus()`; checklist A.9/B.7 |
| QA3-08 | Low | Engine | Output names that exceed 255 bytes (long names + "-compressed" / " (1)") fail with OUTPUT_NOT_WRITABLE and the misleading text "That folder doesn't let me write." Should shorten the base name or say the name is too long | 246×"L" + ".png" → Compress (NASTY-LONG-2) |
| QA3-09 | Low | Engine | DOCX → Markdown loses the space between a bold run and a following italic run: `**great***this time.*` renders as "greatthis time." | `tests/helpers/fixtures.ts` `docxFile()` → to-md (CAT-DOC-MD) |
| QA3-10 | Low | Platform | Test hook `dropFilesOnFeed` never resolves when it has to open the Feed Window itself (contract: "Opens the Feed Window if needed"); E2E-53/54 pass only because they open it first | `__ludTest.dropFilesOnFeed([png], 'to-webp')` right after launch → hangs; with `openFeedWindow()` first → OK |
| QA3-11 | Low | Platform/Frontend | A new Shift-drag elsewhere on screen while a result/error card is shown (~2.5 s) does not summon the Uncle (main ignores `arm` while the overlay is interactive). Dropping onto the still-visible Uncle should work (renderer allows ENGAGE in spit); not verifiable with the hooks | NASTY-B2B; `src/main/windows/overlay-session.ts` `isBusy` |
| QA3-12 | Low | Frontend | `capture.mjs` overwrites `docs/art/*.gif` even with `LUD_SCREENS_DIR` set | run it with `LUD_SCREENS_DIR=/tmp/x`, `git status` shows both GIFs modified |

Observations (not bugs): CSV → JSON keeps every value as a string (`"age": "31"`, papaparse `dynamicTyping:false`);
JSON → YAML/XLSX keep numbers. Empty `.md` → PDF produces a blank PDF (fine). Linux-only: sharp warns
"SharpElectronLinux" and GLib-GObject-CRITICAL lines flood stderr in the engine (cosmetic, not on macOS/Windows).
Error `JobEvent`s carry `detail` (parser excerpts) to the renderers; not displayed (SEC-44 allows it).

## 5. Confidence that v0.1 works for the product owner tomorrow (macOS + Windows)

**Overall: 62 / 100.**

| Area | Score | Reasoning |
|---|---|---|
| Install + first launch | 80 | Packaged apps smoke-start in CI on macOS arm64/x64 and Windows with ASAR-integrity fuses. Gatekeeper (ad-hoc signed, not notarized) and SmartScreen need the documented clicks; macOS 15's "Open Anyway" path is the main friction. |
| The gesture (Shift-drag summons the Uncle) | 60 | The core risk and never run on real hardware by us: uiohook during OS file drags (U1), a 1 %-alpha window accepting drops on macOS/Windows (U2), Accessibility grant without restart. Linux XTest gesture works; logic is unit-tested; the Feed Window is a working fallback either way. |
| Conversions (all §5 options) | 90 | Every option converts a realistic fixture end-to-end in the real app here and validates with independent decoders; engine tests green on macOS/Windows CI at 5afa281; Windows PDF fixes (B-016) are only CI-verified at engine level, not in an installed app. |
| Remove BG | 40 | First use (download, verify, cut-out) works; **every second use in a session fails on onnxruntime-node** (QA3-01; likely Apple silicon + most Windows PCs); no download text (QA3-02). Intel Mac (wasm) should be fine. |
| Cancel / errors / robustness | 85 | Cancel at eat/early/late chew and during the download: CANCELLED, no partial files, no orphan ffmpeg; friendly errors for 0-byte/corrupt/truncated inputs; 1 GB sparse inputs, 20-file batches, weird names OK. Esc does not cancel (QA3-05), long error cards clip (QA3-04). |
| The Uncle (look and feel) | 85 | Charming, mole visible, head turn obvious, readable on light and dark backgrounds; hint clipping (QA3-03) and click-blocking during long jobs (QA3-06) are the visible blemishes. |
| Settings, modes, tray, Feed Window | 85 | Persistence across restart, Plain/Hungry switched mid-chew, Feed Window conversions verified; tray/menu-bar behaviour, login items and window-to-front are manual-only. |

The weighted score is pulled down by the unverified gesture on real OSes and by QA3-01, which the PO will very likely hit
(trying Remove BG on two photos is natural). Fixing QA3-01 (small, verified workaround) would raise it to ~70.
