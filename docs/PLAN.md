# Let us drag! — Project Plan (v0.1)

Owner: Technical Project Manager (TPM). This document is the single source of truth for
scope, architecture, ownership and the definition of done. Agents must not change scope;
if something here is wrong or unverifiable, report it to the TPM instead of improvising.

## 1. Product in one paragraph

A free, open-source, local-only desktop file converter. While the user drags any file and
holds a trigger key (Shift by default), a cartoon character, **the Uncle**, appears at
the cursor with his mouth wide open and format options floating around him. The user drops the file
on an option; the Uncle eats the file, chews while the real conversion runs, and tosses
the converted file out. The output is saved next to the original. Nothing is uploaded.

Platforms: macOS (Apple silicon + Intel), Windows 10/11 x64, Linux x64 (X11 gesture; Wayland
uses the Feed Window fallback).

## 2. Scope of v0.1

### In scope
- Background app with tray / menu-bar icon (no Dock icon on macOS).
- Global trigger: left-button drag + trigger key (Shift | Alt/Option | Ctrl | Cmd/Win), configurable.
- Overlay window with the Uncle (SVG character, code-driven animation state machine).
- Conversions listed in §5, executed locally by a job engine in an Electron `utilityProcess`.
- Feed Window: an always-available small window you can drop files onto (fallback for Wayland,
  for users who deny macOS Accessibility, and for anyone who prefers it). Opened from the tray.
- Settings window: trigger key, sounds on/off, Hungry Mode (instant gulp, no chewing minimum),
  Plain Mode (no character, simple ring), launch at login, open Feed Window.
- macOS onboarding: explain + request Accessibility permission; app keeps working via Feed
  Window if denied.
- Procedurally generated sound effects (WebAudio, no audio assets), mute toggle.
- Installers: macOS `.dmg` (arm64, x64; ad-hoc signed), Windows NSIS installer + portable `.exe`,
  Linux AppImage + `.deb`.

### Out of scope for v0.1
Auto-update, code signing/notarization with paid certificates, cloud anything, telemetry,
community skin loader UI (the character is built so a skin system is possible later),
App Store builds.

## 3. Architecture

```
┌──────────────────────── main process (src/main) ─────────────────────────┐
│ index.ts: lifecycle, single-instance lock, tray, windows, IPC wiring      │
│ platform/trigger-logic.ts  (PURE state machine, unit tested)              │
│ platform/trigger.ts        (uiohook-napi adapter → trigger-logic)         │
│ platform/permissions.ts    (macOS Accessibility check / prompt)           │
│ windows/overlay.ts         (transparent always-on-top overlay window)      │
│ windows/feed.ts, windows/settings.ts                                       │
│ ipc.ts                     (all ipcMain handlers, zod-validated)          │
│ settings-store.ts          (JSON file in app.getPath('userData'))         │
│ engine-host.ts             (spawns + talks to the engine utilityProcess;   │
│                             serves the htmlToPdf adapter via Chromium)    │
└───────────────────────────────────────────────────────────────────────────┘
          ▲ IPC (contextBridge, typed)                ▲ MessagePort
┌─────────┴───────────────┐                ┌──────────┴──────────────────────┐
│ renderer (src/renderer) │                │ engine (src/engine) — pure Node │
│ overlay/  React + SVG   │                │ registry.ts  detect + options   │
│ feed/     React         │                │ jobs.ts      queue/progress/cancel│
│ settings/ React         │                │ output.ts    safe output naming  │
│ shared ui in common/    │                │ tools/*.ts   ffmpeg, sharp, pdf… │
└─────────────────────────┘                │ worker.ts    utilityProcess entry│
                                           └─────────────────────────────────┘
src/shared/   types + IPC channel names + option catalog types (imported by all)
src/preload/  contextBridge API exposed as window.lud
```

Key decisions (with reasons):
1. **Engine is pure Node and has no `electron` import** (except in `worker.ts` glue). It is unit/
   integration-testable with vitest without Electron. Anything that needs Chromium (HTML→PDF)
   is an injected adapter: `EngineAdapters.htmlToPdf(html: string): Promise<Uint8Array>`.
2. **Engine runs in `utilityProcess`** so CPU-heavy work (ONNX, sharp) never stalls the overlay.
3. **Trigger logic is a pure function/state machine** fed by events; uiohook is a thin adapter.
4. **Cursor position comes from `screen.getCursorScreenPoint()`** (DIP), never from uiohook
   coordinates (those are physical pixels on scaled Windows displays).
5. **Overlay appears only for real file drags**: when the trigger arms, the overlay window is
   placed under the cursor as an almost-invisible "sensor" (`rgba(0,0,0,0.01)` background, so the
   OS hit-tests it as a drop target on every platform). Only when the renderer receives a
   `dragenter` whose `dataTransfer.types` includes `"Files"` does the Uncle become visible.
   Text drags / window drags therefore never show the Uncle. The sensor follows the cursor
   (poll ~60 Hz) until engaged; after engaged the overlay stays put.
6. **File paths** are obtained on drop via `webUtils.getPathForFile(file)` in preload.
   During dragover only MIME types are known (`dataTransfer.items[i].type`), used to pick the
   option set. If the type is unknown/mixed, show the "Feed me!" state: drop on the Uncle's mouth,
   then options become clickable with the file "held" (window becomes focusable/clickable).
7. **Never overwrite**: outputs go next to the source; on collision use `name (1).ext`, `name (2).ext`.
   Multi-output conversions (PDF→PNG pages) write into a new folder `name (pages)/`.
8. **Binaries**: FFmpeg is resolved in this order: env `LUD_FFMPEG_PATH` → packaged
   `process.resourcesPath/bin/ffmpeg[.exe]` → `ffmpeg` on PATH. CI packaging places a pinned
   ffmpeg-static binary into `resources/bin` per platform/arch. No network calls at runtime
   except the optional, user-initiated Remove-BG model download.
9. **Child processes** always via `spawn(file, argsArray)` with `shell: false`. Never build
   shell strings.

## 4. Shared contracts (src/shared) — owned by TPM

The exact TypeScript lives in `src/shared/*.ts`. Additive changes are allowed by any agent
(add a field/channel); renaming or removing requires TPM sign-off via report.

- `Category = 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'text' | 'data' | 'archive' | 'blocked' | 'unknown'`
- `OptionId` (e.g. `'to-png'`, `'remove-bg'`, `'compress'`, `'zip'`…), `ConversionOption { id, label, short, category, batch: 'each' | 'merge' }`
- `JobRequest { id, optionId, inputPaths: string[] }`, `JobEvent` (`queued|progress|done|error`),
  `JobResult { outputPaths: string[] }`, `JobError { code, message }`
- `Settings { triggerKey, sounds, hungryMode, plainMode, launchAtLogin, firstRunDone }`
- IPC channels + preload API type `LudApi` in `src/shared/api.ts`; engine contract in `src/engine/api.ts`.
- E2E test hooks + DOM test-id contract in `src/shared/test-hooks.ts`.

## 5. Conversion catalog v0.1 (max 8 options per category)

| Category | Input extensions | Options (output) | Tool |
|---|---|---|---|
| image | png jpg jpeg webp avif gif tif tiff bmp ico heic heif | PNG, JPG, WEBP, AVIF, PDF (batch→one PDF), ICO, Remove BG (PNG), Compress (same fmt) | sharp; heic-decode for HEIC/HEIF input; ffmpeg for BMP/ICO in/out where sharp lacks support; pdf-lib for PDF; onnxruntime-node for Remove BG |
| video | mp4 mov m4v mkv webm avi | MP4 (H.264/AAC), MOV, WEBM (VP9/Opus, realtime preset), GIF (palette, ≤15 fps, ≤480 px), MP3 (audio), WAV (audio), Compress (H.264 CRF 28) | ffmpeg |
| audio | mp3 wav m4a aac ogg oga opus flac | MP3, WAV, M4A, OGG, FLAC, Compress (MP3 128k) | ffmpeg |
| pdf | pdf | PNG (pages), JPG (pages), TXT, Merge (batch only, ≥2 PDFs) | pdfjs-dist + @napi-rs/canvas; pdf-lib |
| document | docx | PDF, HTML, Markdown, TXT | mammoth (→HTML) then htmlToPdf adapter; LibreOffice is NOT required |
| text | md markdown txt html htm | PDF, HTML, DOCX, TXT | marked; docx; htmlToPdf adapter |
| data | csv json yaml yml xlsx | CSV, JSON, YAML, XLSX (excluding same format) | papaparse, js-yaml, exceljs (first sheet for xlsx→others) |
| archive | zip | Unzip | yauzl (zip-slip safe) |
| any | any file or folder, or mixed batch | ZIP | yazl |
| blocked | exe msi app dmg pkg bat cmd sh com scr dll | (none: Uncle refuses) | — |

Batch rules: all inputs same category → that category's options (`each` = one output per input,
`merge` = one output). Mixed categories → ZIP only. Folders → ZIP only.

## 6. The Uncle — UX & animation states

Character (product-owner requirements, mandatory):
- **Cartoonist style**: hand-drawn editorial-cartoon look (expressive, exaggerated proportions,
  bold ink-like outlines with varying stroke weight, flat warm colors with simple cel shading).
- **Animated, alive at all times** while visible: idle breathing, blinking, small squash & stretch.
- **A mole on his face** (on the cheek near the nose, with one tiny hair — it should be a
  recognisable, slightly funny signature detail).
- **Face and eyes follow the dragged file**: while the file is being dragged over the overlay,
  the whole head turns/tilts toward the cursor (parallax: face features shift more than the head
  outline, giving a 3D "turn"), and the pupils track the cursor precisely. Smoothed (spring/lerp),
  60 fps, no jitter. When the cursor is over an option, he looks at that option.

Look: friendly, slightly weird uncle: big round head, bald top with a few wild side hairs,
bushy moustache, huge expressive mouth (opens wide; teeth + tongue), round glasses, rosy
cheeks, the mole, small hands. Built as layered inline SVG (`head`, `face` group for parallax,
`jaw`, `upperLip`, `mouthInterior`, `eyes`, `pupils`, `brows`, `cheeks`, `mole`, `moustache`,
`hands`) so parts animate independently. Art must read well at 220–260 px.

State machine (renderer, pure reducer + effects; unit tested):

| State | Trigger | Visual |
|---|---|---|
| hidden | — | nothing (sensor may be active) |
| appear | file dragenter | pops in (scale 0.6→1, overshoot), mouth opens, options fan out |
| hover(option) | dragover option | eyes + head lean toward option, option enlarges, label shows |
| feedMe | unknown/mixed type | mouth open, "Feed me!" bubble, center is drop target |
| eat | drop on option | file icon flies into mouth, jaw snaps shut, gulp sound |
| chew(progress) | job running | jaw chews loop, cheeks bulge; progress ring around him; min 700 ms unless Hungry Mode |
| hamster | batch ≥ 3 files | cheeks extra puffed while chewing |
| struggle | any input > 200 MB | sweating, slower chew |
| spit(done) | job done | tosses output file card (name + "Saved next to original"), happy face; card click → reveal in folder |
| choke(error) | job error | coughs, file card bounces back with short human message |
| refuse | blocked type | arms crossed, shakes head, "Nope, not eating that." |
| leave | 2.5 s after spit/choke/refuse, Esc, or mouseup without drop | shrinks away |

Sounds (WebAudio synthesized): pop-in, gulp, chew-crunch loop, toss whoosh, cough, burp (on
>200 MB done). Plain Mode = same ring without character (still animated, minimal).

## 7. Team & ownership

| Role | Owns (may edit) | Must not edit |
|---|---|---|
| TPM (orchestrator) | docs/PLAN.md, src/shared (contract), config files, CI, merges, final report | — |
| Backend dev — Engine | src/engine/**, tests/engine/**, tests/helpers/**, scripts/fetch-model.mjs | src/renderer, src/main |
| Backend dev — Platform | src/main/**, src/preload/** | src/engine (except calling its API), src/renderer |
| Frontend dev | src/renderer/**, resources/icon.png, resources/tray/**, docs/art/** | src/main, src/engine |
| QA | tests/e2e/**, tests/qa/**, docs/qa/** (may extend tests/engine + tests/helpers after the build phase) | production code |
| Security analyst | docs/security/** | production code (findings go to owners) |

`package.json` dependencies are frozen after scaffolding. Need a new dependency? Report it
with justification + license; the TPM installs it.

All agents append a short entry to `docs/TEAM_LOG.md` (role, what was done, files touched,
open issues). Bugs are tracked in `docs/qa/BUGS.md` (ID, severity, owner, status, repro, fix ref).

## 8. Quality gates (Definition of Done)

1. `npm run typecheck`, `npm run lint`, `npm test` (unit + engine integration) pass on Linux,
   macOS and Windows in CI.
2. Every option in §5 has at least one integration test converting a real fixture and validating
   the output (magic bytes / decodable / page count / duration), run on all 3 OSes in CI.
3. E2E (Playwright `_electron`) on Linux CI under Xvfb: app boots, overlay shows on simulated
   trigger, simulated drop → conversion → output exists; screenshots of every Uncle state saved
   as CI artifacts.
4. Security review completed; all High/Critical findings fixed and re-verified.
5. QA bug ledger: no open Critical/High bugs. Medium/Low documented.
6. Installers built in CI for all targets and uploaded to a **draft** GitHub release.
7. `docs/REPORT.md`: who did what, bugs raised/fixed, test results, confidence score with
   reasoning, known limitations, manual test checklist for the human on macOS + Windows.

## 9. Known unknowns (must be verified, not assumed)

| # | Assumption | How we verify |
|---|---|---|
| U1 | uiohook-napi receives mouse events during OS file drags on macOS/Windows | Cannot verify in CI with real Finder/Explorer drags → manual checklist item; code must degrade gracefully (Feed Window always works) |
| U2 | Near-transparent overlay window is a valid drop target on all OSes | E2E on Linux; manual on mac/win |
| U3 | Chromium exposes MIME types of dragged files during dragover on all OSes | feedMe fallback guarantees function either way |
| U4 | ffmpeg-static binaries exist for darwin-arm64/x64, win32-x64, linux-x64 and include libx264, libvpx, libmp3lame, libopus, libvorbis | CI packaging job runs `ffmpeg -encoders` check |
| U5 | sharp prebuilt lacks HEIC/BMP/ICO support (hence fallbacks) | Engine dev checks `sharp.format` at runtime and tests |
| U6 | Remove-BG model license permits redistribution, and the model file is reachable from CI | Engine dev verifies license from primary source; CI job mirrors the model to our release with sha256 |
| U7 | ad-hoc signed arm64 macOS app opens after right-click → Open, and Accessibility grant works | manual checklist |
