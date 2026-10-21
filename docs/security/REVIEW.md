# Security review of develop (phase 2)

Owner: Security analyst. Reviewed commit: `develop@a6c0d94` ("Bug ledger: ffmpeg fixes, Windows CI findings
B-016..B-018"; phase 1 merged, contains 4183a51). Date: 2026-10-21. Branch of this document: `fix/security-p2`.

The requirements are in [CHECKLIST.md](CHECKLIST.md) (`SEC-xx`); the threat context is in
[THREAT_MODEL.md](THREAT_MODEL.md). Platform and Engine developers are fixing items in parallel, so this
records **what is on develop@a6c0d94**, and section 4 lists which IDs each owner is expected to close, so the
TPM can re-verify after their merges.

Status values: **PASS**, **PARTIAL** (some of the requirement is met), **FAIL**, **NOT-YET** (the code or doc
does not exist yet), **WAIVE?** (a waiver is recommended; the TPM decides). Evidence is `file:line` on
a6c0d94 unless stated otherwise.

## 1. How this review was done

Commands and probes, all run in this container (Linux x64, Node 22) on 2026-10-21:

- `npm ci`; `npm run build`; `npm audit --omit=dev` (5 moderate, unchanged from phase 1).
- Grep gates of CHECKLIST §J over `src/` (no `shell.openPath`, `openExternal`, `innerHTML`-family,
  `crashReporter`, `shell: true`, `exec`/`execSync`; the only network code is `src/engine/tools/model.ts`).
- **Packaged Linux build** with the real `electron-builder.yml`:
  `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --linux dir --x64 --publish never -c.directories.output=<scratch>`
  (output outside the repo; no config file changed). Then:
  - `npx @electron/fuses read --app <scratch>/linux-unpacked/let-us-drag` →
    RunAsNode **Disabled**, EnableCookieEncryption Enabled, EnableNodeOptionsEnvironmentVariable **Disabled**,
    EnableNodeCliInspectArguments **Disabled**, EnableEmbeddedAsarIntegrityValidation Disabled,
    OnlyLoadAppFromAsar Disabled, LoadBrowserProcessSpecificV8Snapshot Disabled,
    GrantFileProtocolExtraPrivileges Enabled.
  - Fuse probes on the packaged binary (each under `xvfb-run`, 12 s timeout): `ELECTRON_RUN_AS_NODE=1 … -e
    "console.log(424242)"` → no output, the app starts normally; `NODE_OPTIONS=--require <inject.js>` → not
    loaded; `--inspect=0` → no "Debugger listening". Control: the unfused `node_modules/electron/dist/electron`
    **does** print 424242 with `ELECTRON_RUN_AS_NODE=1`.
  - **Env-var bypass probes on the packaged binary** (new findings F-15 and F-09, section 2):
    `LUD_E2E=1 LUD_E2E_ENGINE_WORKER=/abs/evil.cjs` → `evil.cjs` ran in the engine utilityProcess and wrote a
    marker file. `ELECTRON_RENDERER_URL=http://127.0.0.1:39517` with a local HTTP server → the packaged app loaded
    `/overlay/index.html` and `/settings/index.html` **from that server**, and the served page could call
    `window.lud.getSettings()` successfully (IPC trusted it).
  - `npx @electron/asar list|extract` of `app.asar`: 248 npm package directories ship; `@napi-rs/**` does not;
    `onnxruntime-node/script`, `adm-zip`, `global-agent` and `@types/*` do; every shipped package keeps its
    licence file (electron-builder only strips top-level READMEs, `app-builder-lib/out/util/NodeModuleCopyHelper.js:12-42`).
- ffmpeg: downloaded the pinned ffmpeg-static b6.1.1 linux/win assets again (hashes match the pins), ran the Linux
  binary (`-version`, `-buildconf`, `-L`), read the Windows configuration string; macOS data from the CI probe run
  39672571045 (`gh run view`; the build server itself is blocked from this container).
- A percent-sign probe with the system ffmpeg 6.1 (finding F-20).
- Electron 45.0.0 release assets (`SHASUMS256.txt`, `electron-v45.0.0-win32-x64.zip`,
  `electron-v45.0.0-darwin-arm64.zip`) downloaded from the Electron GitHub release; SHA-256 matched
  `SHASUMS256.txt`; used for the file listings in S3 and the licensing section, then deleted.

## 2. Findings that are new or changed since phase 1

| ID | Severity | Where | Finding | Fix | Owner | Status |
|---|---|---|---|---|---|---|
| F-15 | **High** | `src/main/test-hooks.ts:17-19`, `src/main/app.ts:148-150`, `src/main/index.ts:13-14`, `src/main/windows/common.ts:26` | E2E mode is enabled by `LUD_E2E=1` alone, also in a **packaged** app. With `LUD_E2E_ENGINE_WORKER=/abs/file.cjs` the packaged app runs arbitrary JavaScript in its engine utilityProcess [V: probe above]. This defeats the `runAsNode`/`nodeOptions` fuses (F-11) and lets local malware borrow the app's macOS Accessibility grant (AT-7). It also exposes `__ludTest` and the `--lud-e2e` preload surface in production. Violates TPM decision D12 and SEC-18. | `isE2E()` must return `env.LUD_E2E === '1' && !app.isPackaged` (D12), and every `LUD_E2E_*` override must sit behind that same check. Load `test-hooks` with a dynamic `import()` inside the branch. Add a unit test for `isE2E` with `isPackaged: true`. | Platform | open (D12 work in progress) |
| F-09 | Medium (re-verified, still open) | `src/main/app.ts:103`, `src/main/paths.ts:58-79`, `:127-130` | `ELECTRON_RENDERER_URL` is still honoured when `app.isPackaged`; phase 1 narrowed it to loopback only. A local process that serves `http://127.0.0.1:<port>` gets its page loaded into our windows **with our preload**, and `isTrustedRendererUrl` then trusts that origin for IPC [V: probe above]. Same impact class as F-15 (startJob on any path, setSettings incl. launchAtLogin, requestAccessibility). | In `app.ts`: `devServerUrl: app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']`. Optionally also make `safeDevServerUrl` take `isPackaged` and return `undefined` when true (defence in depth, unit-testable). | Platform | open |
| F-16 | Medium | `src/engine/tools/ffmpeg.ts:26-27`, `src/engine/tools/model.ts:56-61`, `src/main/app.ts:71` | The engine honours `LUD_FFMPEG_PATH` (which executable to spawn) and `LUD_MODEL_PATH` (an un-hashed model file) in packaged builds; `utilityProcess.fork` passes the full `process.env` (default). A local process can make our app spawn any program (on macOS, child processes are attributed to the responsible app for TCC [unverified on a real Mac]) and load an unverified ONNX file (AT-6/AT-7). | In `forkEngine`, pass `env` explicitly; in packaged builds drop every `LUD_*` key (keep them only when `!app.isPackaged`). `ForkOptions.env` exists in Electron 45 (`electron.d.ts`, checked in phase 1). | Platform (env filter) + Engine (document the dev-only vars) | open |
| F-17 | Medium | `src/engine/tools/text.ts:64`, `:103` | SEC-81: MD→HTML and DOCX→HTML outputs are written **unsanitised and without the CSP meta** (`wrapHtmlDocument(html, title)` without `{ csp: true }` and without `sanitizeHtml`). Only the PDF path sanitises (`text.ts:31`). A hostile `.md`/`.docx` yields an `.html` file next to the user's file that runs script when opened in a browser (from `file://`). | Use `wrapHtmlDocument(sanitizeHtml(html), title, { csp: true })` for both `to-html` paths; add the engine test from SEC-81 (`<script>` + `[x](javascript:alert(1))`). | Engine | open |
| F-18 | Medium | `src/engine/tools/image.ts:76-98` | SEC-52: HEIC (HEVC) is decoded fully by libheif (WASM) before any dimension check, and the decoded RGBA goes into `sharp(…, { raw })` **without** `limitInputPixels` (`image.ts:98`). A small HEIC that declares a huge image can exhaust memory in the engine process. | Read the HEIF dimensions first (heic-decode/libheif-js expose the image handle's width/height before `decode`; verify the API in `node_modules/libheif-js`) and reject above the pixel cap; pass `limitInputPixels` on the raw `sharp` call too. | Engine | open |
| F-19 | Medium | `src/engine/tools/model.ts:20`, `:82`, `:89-102` | SEC-120: the download follows redirects to any host, has **no size cap** (the stream is written until the end, then hashed; a hostile/MITM'd server can fill the disk), and the primary URL is still our own mirror `models-v1`, which contradicts D10 ("do not mirror"; download from upstream). | Use only `MODEL_UPSTREAM_URL`; check `res.url`'s host against an allowlist (`github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com` [the last one observed today for Electron's assets]); abort when `received > MODEL_SIZE_BYTES`. | Engine | open |
| F-20 | Low | `src/engine/tools/image.ts:38`, `src/engine/tools/ffmpeg.ts:199` | SEC-63: an input named `a%03d.bmp` is opened by ffmpeg's image2 demuxer as a **sequence pattern**, so ffmpeg decodes the sibling `a001.bmp` instead [V: system ffmpeg 6.1: `a%03d.bmp` (16×16) was read as 8×8 = `a001.bmp`]. The checklist's suggested `file:` prefix does **not** prevent this [V]. `-pattern_type none` does [V], but it is an image2-only option (with a WAV input ffmpeg fails "Option not found" [V]). | For BMP/ICO inputs force the demuxer: `-f image2 -pattern_type none -i <path>` (or `-f bmp_pipe`); for audio/video, SEC-62's `-format_whitelist` (without `image2`) closes it. Add an engine test with `a%03d.bmp` + a different `a001.bmp`. | Engine | open |
| F-21 | Low | `src/main/html-to-pdf.ts:74-98`, `src/main/engine-host.ts:222` | SEC-82 details: no HTML size cap in main before writing/loading the HTML; the window is reused (navigated to `about:blank`) instead of destroyed per job. The core controls are good (JS off, sandbox, in-memory partition, request filter = exact file URL + `data:`, CSP meta, 30 s timeout, private `mkdtemp` dir). | Cap `html.length` (e.g. 50 MB) in the `htmlToPdf` handler; optional: destroy the window after each job. | Platform | open |
| F-22 | Info | `src/engine/tools/removebg.ts:80-86`, onnxruntime-node win32 | S3 result: `onnxruntime.dll` needs the MSVC runtime, which Electron does not ship (section 5.2). On a Windows PC without the VC++ 2015-2022 x64 redistributable, `onnxruntime-node` fails to load and Remove BG silently uses the WASM fallback (slower). Functional, not a security issue. | Accept and document, or add a Windows smoke test on a clean image; see section 5.2 for options. | TPM + Engine | open (decision) |

Phase-1 findings: F-01 **closed** (macOS ffmpeg replaced by GPL Martin Riedl 9.0.2 builds; CI licence gate,
`scripts/fetch-ffmpeg.mjs:84-94`); F-02 **closed** for the binaries (`fetch-ffmpeg.mjs:21`, `:68`), still open
for the extras (licence/README files are not hashed, `:77`); F-03 **partially closed** (notices rewritten in this
branch; Corresponding Source still to be attached: R-1 in THIRD_PARTY_NOTICES); F-04 **closed**; F-05 open;
F-06 open (libuiohook source still stripped: `electron-builder.yml:17-18`; notice now present); F-07 partially
closed (this branch); F-08 open; F-09 open (narrowed, see above); F-10 open; F-11 partially closed; F-12 open;
F-13 open; F-14 unchanged (accepted).

## 3. Status per checklist ID

### A. Electron hardening

| ID | Status | Evidence | Expected to close |
|---|---|---|---|
| SEC-01 | PASS | `src/main/security.ts:6-19` (contextIsolation, sandbox, nodeIntegration set after the caller's extras, so they cannot be weakened); used by every app window via `src/main/windows/common.ts:22-30`; htmlToPdf window `src/main/html-to-pdf.ts:53-67`. E2E-60 (`tests/e2e/security.spec.ts:22`). | — |
| SEC-02 | PARTIAL | App windows set all flags except `experimentalFeatures: false` (`security.ts:7-19`); the htmlToPdf window omits `nodeIntegrationInWorker`, `nodeIntegrationInSubFrames`, `allowRunningInsecureContent`, `experimentalFeatures`, `navigateOnDragDrop` (`html-to-pdf.ts:58-67`). All omitted values are Electron's safe defaults, so the risk is low. No `enableBlinkFeatures` anywhere. | Platform: add the missing explicit flags (or build the pdf window prefs with `secureWebPreferences({ javascript: false, session, preload: undefined })`). |
| SEC-03 | FAIL (F-15) | `additionalArguments` depends on `ctx.e2e` (`windows/common.ts:26`), which is env-controlled in packaged builds (`test-hooks.ts:17-19`). | Platform (D12) |
| SEC-04 | PASS | `src/preload/index.ts:24-49` exposes exactly `LudApi`; `subscribe` strips the event and returns an unsubscribe (`:16-22`); `onTestDrop` is a no-op unless `--lud-e2e` (`:46`). E2E-60. | — |
| SEC-05 | PARTIAL | `app.ts:113` + `security.ts:23-28`: will-navigate, will-redirect, will-attach-webview → preventDefault; window.open denied. `will-frame-navigate` is not handled (subframes); the renderer CSP has no `frame-src 'none'` (SEC-09). E2E-61 (`security.spec.ts:42`). | Platform: add `will-frame-navigate` → `preventDefault()` (also closes most of the gap until F-10 lands). |
| SEC-06 | PARTIAL | `security.ts:31-35` request/check/device handlers deny; applied to the default session (`app.ts:112`) and the pdf session (`html-to-pdf.ts:41`). `setDisplayMediaRequestHandler` is missing. | Platform |
| SEC-07 | **FAIL (F-09)** | `app.ts:103`; probe in section 1. | Platform |
| SEC-08 | PASS | No `dangerouslySetInnerHTML`/`innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write` in `src/renderer` (outside `src/renderer/dev`, which is not shipped). | — |
| SEC-09 | FAIL (F-10) | `src/renderer/{feed,overlay,settings}/index.html:5`: `default-src 'self'; script-src 'self'; …; connect-src 'self'`, no `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `frame-src 'none'`. No `'unsafe-eval'` (good). E2E-63 checks presence of a CSP, not these directives. | Frontend |
| SEC-10 | PASS | No `createObjectURL`/`file:` in `src/renderer` (outside dev); CSP `img-src 'self' data: blob:` (no `file:`). | — |
| SEC-11 | PASS (undermined by F-09) | `src/main/ipc.ts:52-58`: own webContents, main frame (`frame.parent !== null` rejected), URL checked with `new URL` + `fileURLToPath` + `path.relative` (`paths.ts:120-140`). | Closes fully with F-09. |
| SEC-12 | PARTIAL | Overlay-only allowlist for `overlayInteractive`, `overlayDone`, `overlayEngaged` (`ipc.ts:96-104`). `setSettings`, `requestAccessibility`, `startJob`, `revealPath` are accepted from any of our windows (e.g. the overlay can change settings). | Platform: per-window table (settings/feed for `setSettings`; settings for `requestAccessibility`). |
| SEC-13 | PASS | `ipc-validation.ts:125-150` (strict job request, enum option ids, ≤ 500 paths, ≤ 4096 chars, bounded job id), `settings-store.ts:28` (`.partial().strict()`); friendly errors (`ipc.ts:64-70`); unit tests `tests/unit/platform/pure-helpers.test.ts:180-211`, `settings-store.test.ts`. | — |
| SEC-14 | PARTIAL | Absolute, no NUL, normalised (`ipc-validation.ts:134-140`). Windows device namespaces (`\\.\`, `\\?\`) and UNC paths are not rejected or decided. | Platform: reject `^\\\\[.?]\\`; decide UNC (record the decision). |
| SEC-15 | PASS | `ipc.ts:85-89` only reveals paths in `JobRegistry` and uses `shell.showItemInFolder`; no `shell.openPath` in `src`. Unit test `pure-helpers.test.ts:213`. | — |
| SEC-16 | PASS | No `openExternal` in `src`. | — |
| SEC-17 | PARTIAL (F-11) | `electron-builder.yml:52-58`; verified on the packaged Linux build (section 1). `enableEmbeddedAsarIntegrityValidation: false`, `onlyLoadAppFromAsar: false`, `grantFileProtocolExtraPrivileges` not set (Enabled). The fuses are bypassed by F-15/F-16 until those are fixed. | TPM (config, section 6) |
| SEC-18 | **FAIL (F-15)** | `test-hooks.ts:17-19`; static imports of `test-hooks` in `app.ts:53` and `index.ts:7`; probe in section 1. | Platform (D12) |
| SEC-19 | PASS | `windows/common.ts:27` `devTools: !isPackaged` (the hidden pdf window has no devTools flag but cannot be focused or opened by the user). | — |

### B. Global hook, overlay, privacy

| ID | Status | Evidence | Expected to close |
|---|---|---|---|
| SEC-30 | PASS | `uiohook-napi` is used only in `src/main/platform/trigger.ts` (lazy import `:44-49`); the only log lines are start/stop error messages (`:100`, `:110`); the logger writes to stderr and only in development or with `LUD_DEBUG=1` (`src/main/logger.ts`). No fs calls in `platform/`. | — |
| SEC-31 | PASS | Only `onArm`/`onDisarm` leave the trigger (`trigger.ts:73-74`); overlay position from `screen.getCursorScreenPoint()` (`windows/overlay.ts:111`). | — |
| SEC-32 | PARTIAL | Non-modifier key codes are dropped before they are stored (`trigger-logic.ts:126`), and modifier flags of mouse events are used (`trigger.ts:51-53`). But `trigger-logic.ts:38-44` takes raw `keycode` and `x`/`y`, not the abstract events the checklist asks for; the drag start point is kept in state for the movement threshold. Low risk (memory only). | Platform (optional) or WAIVE (TPM) |
| SEC-33 | PASS | No `console.*` in `src/main/platform`; libuiohook logging is not enabled by uiohook-napi. | — |
| SEC-34 | PARTIAL | Starts only when permitted (`gesture.ts:54-63`, `gesture-env.ts`); stops on pause and quit (`gesture.ts:66-78`, `app.ts:207`). Not handled: revocation of Accessibility while the hook runs (no periodic re-check), and there is no "gesture off" setting (only the tray pause, which is not persisted). | Platform |
| SEC-35 | PASS | Hook callbacks run a pure reducer and synchronous window calls, no I/O, no IPC round-trip (`trigger.ts:89-93`). uiohook-napi posts events to JS with `napi_tsfn_nonblocking` (`uiohook-napi/src/lib/addon.c:20`), so a slow JS callback cannot stall the OS event tap. | — |
| SEC-36 | PARTIAL | `focusable: false`, `showInactive()`, level `screen-saver` (not above), safety timeouts (`overlay.ts:57-64`, `:111-122`; `overlay-session.ts`, documented in `src/main/README.md`). Missing: hide on `powerMonitor` `lock-screen`/`suspend`. `setIgnoreMouseEvents` is not used because the sensor must be a drop target (PLAN §3.5). | Platform (lock/suspend); WAIVE? for click-through (by design) |
| SEC-37 | FAIL | README (6 lines) says "100% local — nothing is uploaded" but not what the hook sees and that nothing is stored; onboarding strings (`src/renderer/settings/labels.ts:19-29`) offer the Feed Window but do not explain the hook. | Frontend (onboarding copy) + TPM (README) |

### C. Engine generic

| ID | Status | Evidence | Expected to close |
|---|---|---|---|
| SEC-40 | FAIL | No magic-byte allowlist before parsing (no `magic`/`sniff` logic in `src/engine`); sharp still sniffs content (an SVG named `.png` reaches librsvg unless SEC-50 lands). | Engine |
| SEC-41 | PARTIAL | Limits exist but are scattered and partly above the recommendation: `image.ts:24` (268 402 689 px = sharp's default maximum), `pdf.ts:25-26`, `archive.ts:13-14` (50 000 entries, 4 GB), `data.ts:17-20`, `jobs.ts:12` (30 min). No input-byte caps per category, no PDF page cap, no HTML size cap; no single limits file. | Engine |
| SEC-42 | PARTIAL | Crash → restart with backoff (`engine-host.ts:9-10`, `:35-36`, `:130`, `:249-258`). Hangs rely on the in-engine job timeout; the main-side kill of a still-running cancelled job (D3, ~5 s) is not on develop. | Platform (D3) |
| SEC-43 | PASS | `src/engine/registry.ts:26-34` `stat()` + `isFile()`/`isDirectory()` → FIFOs, sockets and devices are rejected (symlinks to regular files are followed, which is acceptable for a dropped link). | — |
| SEC-44 | PARTIAL | Friendly messages (`errors.ts`), `detail` never shown in the UI (renderer shows `message`); `detail` is not truncated to 4 KB at the source (ffmpeg stderr is capped at 8 KB, `ffmpeg.ts:113`). | Engine (truncate in `toJobError`) |

### D. Formats

| ID | Status | Evidence | Expected to close |
|---|---|---|---|
| SEC-50 | FAIL | No `sharp.block`/`sharp.unblock` in `src/engine`. | Engine |
| SEC-51 | PARTIAL | `SHARP_OPTS` with explicit `limitInputPixels` (`image.ts:24-26`), no `unlimited`. Raw-input calls pass no limit: `image.ts:98` (HEIC, F-18), `removebg.ts:152-164`, `jobs.ts:131`. The cap is 268 M px, not the recommended 100 M. | Engine |
| SEC-52 | FAIL (F-18) | `image.ts:76-98`. | Engine |
| SEC-60 | PASS | `ffmpeg.ts:139` `spawn(…, { shell: false, windowsHide: true })`; `-hide_banner -nostdin` in `ffmpeg.ts:189`, `:199` and `image.ts:38`. | — |
| SEC-61 | FAIL | No `-protocol_whitelist` (`ffmpeg.ts:199`, `image.ts:38`). | Engine |
| SEC-62 | FAIL | No `-format_whitelist`. | Engine |
| SEC-63 | FAIL (F-20) | Plain paths after `-i`; `image.ts:38` lets image2 expand `%` patterns. Outputs use our own temp names (`output.ts:137-147`), palette uses `-update 1` (`media.ts:163`). Note: the checklist's `file:` advice is wrong for this case (section 2, F-20); CHECKLIST.md is corrected in this branch. | Engine |
| SEC-64 | PASS (equivalent) | ffmpeg writes with `-y` only to our own freshly reserved temp file (`ffmpeg.ts:202-211`, `output.ts:137-147`), and the final name is committed with `link()` (SEC-110). That meets the intent of `-n`. | — |
| SEC-65 | PASS | SIGTERM, then SIGKILL after 2 s (`ffmpeg.ts:152-156`); test `tests/engine/media.test.ts:153` ("cancellation kills ffmpeg and leaves no partial output"). | — |
| SEC-70 | PASS | pdfjs-dist 6.4.299. | — |
| SEC-71 | PARTIAL | Local `standardFontDataUrl`/`cMapUrl`/`wasmUrl`/`iccUrl`, `useSystemFonts: false` (`pdf.ts:96-106`); canvas caps (`pdf.ts:25-26`, `:85-92`). Missing: `maxImageSize`, a page-count cap. (PDF→PNG/JPG inside Electron currently throws `TOOL_MISSING` at `pdf.ts:132` because no `renderPdfPages` adapter is wired in main; when it is added it is new attack surface to review.) | Engine (+ Platform for the adapter) |
| SEC-72 | PARTIAL | Job timeout applies (`jobs.ts:12`); no total-input cap for merge. | Engine |
| SEC-80 | PASS | `text.ts:90-91` `externalFileAccess: false`; mammoth 1.13.0. | — |
| SEC-81 | **FAIL (F-17)** | `text.ts:64`, `:103`. | Engine |
| SEC-82 | PARTIAL (F-21) | `html-to-pdf.ts:38-98`, `pdf-csp.ts`. A file URL in a private temp dir is used instead of a custom protocol; the request filter only allows that exact URL and `data:`, so other `file://` subresources are cancelled. No E2E test with the beacon/iframe fixtures yet. | Platform (size cap) + QA (test) |
| SEC-83 | PARTIAL | `docx-writer.ts:54` turns links into `ExternalHyperlink` (an external relationship, clickable only); no images are written. Acceptable; record as a decision. | Engine (decision) |
| SEC-90 | PARTIAL | `data.ts:162` `CORE_SCHEMA`, `maxAliases: 1000` (checklist: ≤ 100), `maxDepth: 200`; compensating expansion cap `assertExpandable` 2 000 000 nodes (`data.ts:20`, `:145`). | Engine (lower to 100) or WAIVE? |
| SEC-91 | FAIL | No yauzl pre-scan before `wb.xlsx.readFile` (`data.ts:116-119`). | Engine |
| SEC-92 | NOT-YET | No documentation of formula-injection behaviour. | Engine/TPM docs |

### E. Archives and output

| ID | Status | Evidence | Expected to close |
|---|---|---|---|
| SEC-100 | PARTIAL | `archive.ts:80`: `decodeStrings`, `validateEntrySizes`; `strictFileNames: false` (backslashes are normalised by our own `safeEntryPath` instead); entries are read with the async iterator. | Engine (or accept: our checks cover it) |
| SEC-101 | PARTIAL | `safeEntryPath` (`archive.ts:29-40`): absolute, drive letters, `..`, resolve-inside with separator check; on Windows invalid characters and trailing dot/space are replaced. Missing: reserved names (`CON`, `NUL`, `COM1`…), case-insensitive duplicates (a later entry silently overwrites an earlier one inside the new folder: `createWriteStream(target)` at `archive.ts:128`), component length. | Engine |
| SEC-102 | PASS | Symlink entries skipped (`archive.ts:94`); files are created with default modes (attacker modes not applied). | — |
| SEC-103 | PARTIAL | 50 000 entries / 4 GB (`archive.ts:13-14`) vs 10 000 / 2 GB; no ratio cap, no free-space check; encrypted zips refused as a whole (`:101`); no recursion. | Engine |
| SEC-104 | PASS | Extraction goes to a fresh temp dir committed with `commitDir` (`output.ts:101-115`); a non-empty existing folder is never merged into (`ENOTEMPTY` → next name). | — |
| SEC-105 | NOT-YET | No quarantine/MotW propagation. | Engine (SHOULD) |
| SEC-106 | PARTIAL | `lstat`, links skipped, regular files only (`archive.ts:178-187`), entry cap (`:183`); no total-bytes cap. | Engine |
| SEC-110 | PARTIAL | `commitFile` uses `link()` (`output.ts:74-98`), but the FAT/exFAT fallback is check-then-`rename` (`:86-90`), which can replace a file created in between; should be `copyFile(…, COPYFILE_EXCL)`. | Engine |
| SEC-111 | PASS | Output names from the input base name (`output.ts`, `zipName` `:55-60`). | — |
| SEC-112 | PASS | `OutputStager` tracks and removes temps (`output.ts:132-160`); cancellation test above. | — |
| SEC-113 | PASS | `writeError` → `OUTPUT_NOT_WRITABLE` (`output.ts:62-71`), D8. | — |

### F. Model download

| ID | Status | Evidence | Expected to close |
|---|---|---|---|
| SEC-120 | PARTIAL (F-19) | HTTPS constants (`model.ts:20-22`); no redirect allowlist, no size cap; primary URL contradicts D10. User confirmation is a UI matter (D10 "one-time-download stage message") — not verified here. | Engine |
| SEC-121 | PARTIAL (F-16) | Pinned SHA-256 (`model.ts:30`), `.part` → rename only on match (`:87-107`), re-hash once per engine process (`:64-70`). `LUD_MODEL_PATH` skips the hash in packaged builds (`:56-61`). | Engine + Platform (F-16) |
| SEC-122 | PASS (by D10) | The model is not redistributed; licence status recorded in THIRD_PARTY_NOTICES §9. Mirroring stays a product-owner decision (R-6). | — |
| SEC-123 | NOT-YET | No check for ONNX external-data initialisers (one-off check of the pinned file not done; the model cannot be downloaded from huggingface here, but the rembg GitHub asset could be checked with a protobuf parse). | Engine |
| SEC-124 | FAIL (F-12) | `electron-builder.yml:13-14` ships all of `bin/napi-v6/win32/x64/**`, including `DirectML.dll`, `dxcompiler.dll`, `dxil.dll`. | TPM (section 6) |

### G. Packaging

| ID | Status | Evidence | Expected to close |
|---|---|---|---|
| SEC-130 | PARTIAL | `asar: true`, no source maps (`electron-builder.yml:10`); verified listing (section 1). Ships unneeded `@types/*`, `onnxruntime-node/script`, install-time deps (SEC-149). `asarUnpack` still lists `node_modules/@napi-rs/**` (harmless, nothing to unpack). | TPM |
| SEC-131 | NOT-YET | `docs/REPORT.md` does not exist yet. | TPM |
| SEC-132 | PASS | No `--no-sandbox` outside tests/CI. | — |
| SEC-133 | NOT-YET | Docs not written. | TPM |
| SEC-134 | NOT-YET | README has no update notice; Electron 45.0.0 (re-check at release). | TPM |

### H. Supply chain, CI, licensing

| ID | Status | Evidence | Expected to close |
|---|---|---|---|
| SEC-140 | PARTIAL | Binaries fail closed (`scripts/fetch-ffmpeg.mjs:20-21`, `:66-68`); the `extras` (FFMPEG-LICENSE/README, linux and win) are downloaded without a hash (`:77`). | TPM: add `sha256` per extra. Observed today: linux-x64.LICENSE and win32-x64.LICENSE `8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903`, linux-x64.README `72f4b1b06d419d22ace6e7cc75f06826f90737345aa0b1736158929f4aacc537`, win32-x64.README `a636a7183c58006351acbaf35303c0ed85c6e1320fd4e80de453ba6157de6311` (TOFU over HTTPS). |
| SEC-141 | PASS | Gate in `fetch-ffmpeg.mjs:84-94`; it runs on the matching runner in every package job (`package.yml:129-131`, matrix `:111-115`) and in CI tests. | — |
| SEC-142 | PASS | `ci.yml:9-10`, `package.yml:102-103` `contents: read`; `contents: write` only on `draft-release` (`package.yml:186-188`), which does not run `npm ci` or project scripts. | — |
| SEC-143 | PASS | `persist-credentials: false` on every checkout (`ci.yml:28-30`, `package.yml:121-123`, `ffmpeg-probe.yml:25-27`). | — |
| SEC-144 | FAIL (F-05) | `uses:` with mutable tags: `ci.yml:28,31,55,85`, `package.yml:121,124,172,190`, `ffmpeg-probe.yml:25`. | TPM (section 6) |
| SEC-145 | PASS | `npm audit --omit=dev`: 5 moderate (sprintf-js via mammoth→argparse; uuid via exceljs), same as phase 1 and not reachable (THREAT_MODEL §9.1). | — |
| SEC-146 | FAIL (F-08) | `eslint.config.js:10-13`, `:20-27` unchanged. | TPM (section 6) |
| SEC-147 | PARTIAL | THIRD_PARTY_NOTICES.md rewritten in this branch (all shipped npm packages from a packaged build, Electron/Chromium, FFmpeg per platform, libvips, libheif/libde265, libuiohook, ONNX Runtime, model). Remaining: R-3 (macOS Electron licence files), R-4 (ship ORT notices), R-7 (DirectML terms), R-5 (`buffers`). | TPM |
| SEC-148 | FAIL | No Corresponding Source attached to releases yet (R-1); libuiohook source stripped (`electron-builder.yml:17-18`). | Product owner + TPM |
| SEC-149 | FAIL (F-13) | Verified in the packaged build: `onnxruntime-node/script/`, `adm-zip`, `global-agent` (+ `matcher`, `serialize-error`, `type-fest`, `sprintf-js@1.0.3`) ship. | TPM |

### I. Network and telemetry

| ID | Status | Evidence | Expected to close |
|---|---|---|---|
| SEC-150 | FAIL | No `webRequest.onBeforeRequest` on the default session (only on the pdf session, `html-to-pdf.ts:42`). Our pages' CSP `connect-src 'self'` limits `fetch`, but not e.g. `<img>`/CSS from `'self'`-less origins in injected content, and it does not protect against F-09 content. E2E-64 (`security.spec.ts:124`) observes no remote requests while idle. | Platform |
| SEC-151 | PASS | Only `src/engine/tools/model.ts:81-102` uses `fetch`. | — |
| SEC-152 | PASS | No `crashReporter`, no analytics SDK. | — |

## 4. Who is expected to close what (for the TPM's post-merge check)

- **Platform:** SEC-03, SEC-07 (F-09), SEC-18 (F-15), F-16 (env filter for the utilityProcess), SEC-02 (pdf
  window flags), SEC-05 (`will-frame-navigate`), SEC-06 (`setDisplayMediaRequestHandler`), SEC-12, SEC-14,
  SEC-34 (revocation), SEC-36 (lock/suspend), SEC-42 (D3 watchdog), SEC-82 size cap (F-21), SEC-150.
- **Engine:** SEC-40, SEC-41, SEC-44, SEC-50, SEC-51, SEC-52 (F-18), SEC-61, SEC-62, SEC-63 (F-20), SEC-71,
  SEC-72, SEC-81 (F-17), SEC-90, SEC-91, SEC-100, SEC-101, SEC-103, SEC-106, SEC-110, SEC-120 (F-19), SEC-121,
  SEC-123; SEC-92/SEC-83 decisions.
- **Frontend:** SEC-09 (F-10), SEC-37 (onboarding copy).
- **TPM:** SEC-17 (fuses, section 6), SEC-124 (F-12), SEC-130, SEC-140 (extras hashes), SEC-144 (F-05),
  SEC-146 (F-08), SEC-147 (R-3, R-4, R-7), SEC-148 (R-1, with the product owner), SEC-149 (F-13), SEC-131/133/134
  (REPORT/README).
- **QA:** tests for F-15 (packaged app ignores `LUD_E2E`; see section 6.4), SEC-82 fixtures, F-20 (`a%03d.bmp`).

## 5. S3: answers to the open "unverified" items

### 5.1 Which macOS permission does uiohook's event tap need?

**Answer: Accessibility.** Evidence from the libuiohook source shipped in `node_modules/uiohook-napi` (1.5.5):

- `hook_run()` first calls `is_accessibility_enabled()` and fails with `UIOHOOK_ERROR_AXAPI_DISABLED` when it
  returns false (`libuiohook/src/darwin/input_hook.c:1272`, `:1403-1407`).
- `is_accessibility_enabled()` calls `AXIsProcessTrustedWithOptions` with `kAXTrustedCheckOptionPrompt = true`
  (`libuiohook/src/darwin/input_helper.c:43-72`). So **calling `uIOhook.start()` while untrusted shows the
  system Accessibility prompt by itself.** Our code avoids a surprise prompt by checking
  `systemPreferences.isTrustedAccessibilityClient(false)` before starting (`src/main/platform/permissions.ts:23-26`,
  `gesture.ts:80-83`).
- The tap is an **active** tap: `CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap,
  kCGEventTapOptionDefault, mask, …)` with key down/up, flags-changed, all mouse buttons/drags/moves, scroll and
  `NX_SYSDEFINED` (`input_hook.c:1152-1183`). A disabled-by-timeout tap is re-enabled (`:989-995`).
- No Input Monitoring API is used (`IOHIDCheckAccess`, `IOHIDRequestAccess`, `CGPreflightListenEventAccess`,
  `CGRequestListenEventAccess`: 0 matches in `libuiohook/src/darwin/`).

Apple's TCC model gates **active** (filtering) event taps by Accessibility, while **listen-only** taps of
keyboard events are gated by Input Monitoring (`kTCCServiceListenEvent`) **[from Apple's macOS 10.15 security
changes; not re-verified against Apple's site from this container]**. Since the tap is active and the code
requires Accessibility up front, the app needs **Accessibility only**; it does not request Input Monitoring.
Remaining manual check (plan U7): on macOS 14/15, grant only Accessibility and confirm that key events
(the Shift trigger) arrive; confirm the app does not appear under Input Monitoring.

### 5.2 Does onnxruntime-node on Windows need an MSVC runtime that Electron does not ship?

**Answer: yes, it needs it, and Electron does not ship it.**

- `onnxruntime-node/bin/napi-v6/win32/x64/onnxruntime.dll` imports `MSVCP140.dll`, `MSVCP140_1.dll`,
  `MSVCP140_ATOMIC_WAIT.dll`, `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll` (+ UCRT `api-ms-win-crt-*`, part of
  Windows 10/11); `onnxruntime_binding.node` imports `MSVCP140.dll`, `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll`
  [V: `objdump -p`].
- The Electron 45.0.0 win32-x64 distribution contains no `msvcp140*.dll`/`vcruntime140*.dll`
  (its DLLs are only `ffmpeg.dll`, `d3dcompiler_47.dll`, `dxcompiler.dll`, `vk_swiftshader.dll`,
  `vulkan-1.dll`, `electron_wer.dll`; the rest are `electron.exe`, paks, `icudtl.dat`, snapshots, locales,
  `LICENSE`, `LICENSES.chromium.html`), and `electron.exe` imports no VC runtime or UCRT DLL (static CRT)
  [V: zip listing + `objdump -p`; zip SHA-256 `ae53887a…` matched Electron's `SHASUMS256.txt`].
- Consequence: on a Windows PC without the "Microsoft Visual C++ 2015-2022 Redistributable (x64)",
  `import('onnxruntime-node')` fails and `removebg.ts:80-86` falls back to `onnxruntime-web` (WASM), so Remove BG
  still works, more slowly [code read; not run on Windows]. GitHub's Windows runners have the redistributable
  installed **[unverified]**, so CI will not notice.
- Options for the TPM: (a) accept the fallback and say so in REPORT.md; (b) ship the VC++ runtime DLLs next to
  `onnxruntime.dll` (Microsoft allows app-local deployment of these redistributable files under the Visual
  Studio licence terms **[unverified: check the current terms before shipping]**); (c) have the NSIS installer
  run `vc_redist.x64.exe`. Security note (Info): with app-local loading, a same-user process could plant a DLL in
  the per-user install folder; that is the same-user threat already out of scope.

### 5.3 `buffers@0.1.1`: who pulls it, is it shipped, what licence?

- Pulled by `exceljs@4.4.0 → unzipper@0.10.14 → binary@0.3.0 → buffers@0.1.1` [V: `npm ls`].
- **Shipped and loaded:** it is in the packaged `app.asar` [V], and `exceljs`'s Node entry requires
  `./stream/xlsx/workbook-reader` (`exceljs/lib/exceljs.nodejs.js:7`), which requires `unzipper`
  (`lib/stream/xlsx/workbook-reader.js:5`), so it loads whenever the XLSX code loads. It cannot be dropped
  with a files filter without breaking `require('exceljs')`.
- **Licence:** none. Its `package.json` has no `license` field and the package has no licence file [V]; the
  npm registry metadata has no licence for any version (0.0.1-0.1.1) [V: `npm view buffers`]. The upstream
  repository `github.com/substack/node-buffers` is not reachable for us (`raw.githubusercontent.com` → 404 for
  `master/LICENSE`, `package.json`, `README.markdown`; GitHub API access not granted to this session).
  The same author's sibling packages `binary@0.3.0` and `chainsaw@0.1.0` declare MIT / "MIT/X11".
- Risk: Low. Recommendation (R-5): product owner decides between (1) asking the author/checking the archived
  repo for a licence statement, (2) accepting the risk for test builds, or (3) a future exceljs/unzipper upgrade
  that drops `binary` (dependencies are frozen now).

## 6. Exact recommended configuration (verified option names)

All names below were checked in `node_modules/app-builder-lib/scheme.json` (`FuseOptionsV1`) and
`app-builder-lib/out/platformPackager.js:259-298` for electron-builder 26.15.3.

### 6.1 Fuses (F-11, SEC-17)

```yaml
electronFuses:
  runAsNode: false
  enableCookieEncryption: true
  enableNodeOptionsEnvironmentVariable: false
  enableNodeCliInspectArguments: false
  enableEmbeddedAsarIntegrityValidation: true   # macOS and Windows only; ignored on Linux
  onlyLoadAppFromAsar: true
  # grantFileProtocolExtraPrivileges: leave unset (Enabled) -> WAIVE, see below
```

- electron-builder 26.15.3 computes the asar integrity data and writes it into `Info.plist`
  (`ElectronAsarIntegrity`, `app-builder-lib/out/electron/electronMac.js:182-193`) and into the Windows
  executable resources (`electronWin.js:9-28`) unless `disableAsarIntegrity` is set
  (`platformPackager.js:225-228`). So enabling the integrity fuse needs no other config.
- Verify in the package job: `npx @electron/fuses read --app <path>` and a smoke start of the packaged app on
  each OS (a tampered `app.asar` must make the app refuse to start on macOS/Windows).
- `grantFileProtocolExtraPrivileges: false` is **not** recommended now: our pages are loaded from `file://`
  (`windows/common.ts:38-41`) with Vite's `type="module"` scripts, which a plain-browser `file://` origin cannot
  load **[expected from Chromium behaviour, not tested]**. WAIVE until the pages move to a custom protocol.
- LGPL note: once asar integrity is on, users can no longer replace `libheif-js` inside `app.asar`. Add
  `node_modules/libheif-js/**` to `asarUnpack` so the LGPL library stays replaceable (the integrity check covers
  only `app.asar`).
- E2E is unaffected (it runs the unpackaged app; Playwright needs `--inspect`).

### 6.2 Licensing files (R-3, R-4, R-7, F-13, F-06)

```yaml
mac:
  extraResources:
    - from: node_modules/electron/dist/LICENSE          # electron-builder deletes it from the .app
      to: LICENSE.electron.txt
    - from: node_modules/electron/dist/LICENSES.chromium.html
      to: LICENSES.chromium.html
extraResources:            # (add to the existing top-level list)
  - from: docs/security/licenses
    to: licenses           # ONNX Runtime LICENSE + ThirdPartyNotices
files:                     # (add to the existing list)
  - '!node_modules/onnxruntime-node/bin/napi-v6/win32/x64/{DirectML.dll,dxcompiler.dll,dxil.dll}'  # only after a Windows CI check that the CPU EP still loads
  - '!node_modules/onnxruntime-node/script/**'
  - '!node_modules/adm-zip/**'          # verify first that nothing else requires them: they are onnxruntime-node install-time deps
  - '!node_modules/global-agent/**'
```

- On the macOS runner `node_modules/electron/dist/` holds the unpacked macOS Electron zip, whose top level has
  `LICENSE` and `LICENSES.chromium.html` [V: listing of `electron-v45.0.0-darwin-arm64.zip`].
  `mac.extraResources` is added to the top-level list, not a replacement for it
  (`app-builder-lib/out/fileMatcher.js:250-253`: `addPatterns(config[name])` then
  `addPatterns(options.customBuildOptions[name])`). Still check `Contents/Resources` in the mac job's output.
- For F-06 either remove `'!node_modules/uiohook-napi/libuiohook/**'` and `'!node_modules/uiohook-napi/src/**'`
  (`electron-builder.yml:17-18`, ~550 KB) or attach `uiohook-napi-1.5.5.tgz` to each release (R-1).

### 6.3 CI action pins (F-05, SEC-144)

Newest tag of the major version in use, resolved today with `git ls-remote --tags` (peeled commit SHAs):

```yaml
- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262          # v4.4.0
- uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020        # v4.4.0
- uses: actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830             # v4.3.0
- uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02   # v4.6.2
- uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0
```

Plus `.github/dependabot.yml` with `package-ecosystem: github-actions` (weekly) to keep them updated. Note: the
v4 actions run on Node 20, which GitHub already forces to Node 24 (annotation on run 39672571045); moving to
newer majors is a separate, optional change.

### 6.4 Lint gate (F-08, SEC-146)

Unchanged from phase 1 (THREAT_MODEL §12): add `{ name: 'node:child_process', importNames: ['exec', 'execSync'] }`
next to the `child_process` entries, and

```js
'no-restricted-syntax': ['error',
  { selector: "Property[key.name='shell'][value.value=true]", message: 'shell: true is forbidden' },
  { selector: "CallExpression[callee.property.name=/^(exec|execSync)$/][callee.object.name=/^(cp|child_process|childProcess)$/]", message: 'Use spawn/execFile with an args array.' }]
```

### 6.5 Suggested QA test for F-15 (packaged build, Linux CI)

Package with `--linux dir`, then launch `LUD_E2E=1 LUD_E2E_ENGINE_WORKER=<abs marker-writing .cjs> xvfb-run -a
<app> --no-sandbox` for ~10 s and assert that the marker file does **not** exist (it does today). Same for
`ELECTRON_RENDERER_URL=http://127.0.0.1:<port>` with a local server that must receive **no** request.
