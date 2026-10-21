# Security review checklist (v0.1)

Owner: Security analyst. The post-implementation security review goes through this list item by item.
Rationale and threat context for each item: [THREAT_MODEL.md](THREAT_MODEL.md).

**How to use.** For each item, record `PASS`, `FAIL (bug ID)`, `N/A (reason)` or `WAIVED (TPM, reason)`,
plus the evidence (file:line, command output, test name). "MUST" items block the release (plan §8.4).
"SHOULD" items are Medium/Low; a FAIL there is filed in `docs/qa/BUGS.md` but does not block the release.

Status column: the state on the scaffold baseline `develop@e9fae72`. "—" means it cannot be judged yet
because the code does not exist. "FAIL F-xx" refers to the baseline findings in §K.

**Current status (final review, `develop@c2c4bfa`): see [REVIEW.md](REVIEW.md)**, which records PASS / WAIVED (Dxx) /
FAIL per ID with file:line evidence, the probes run on a packaged build, new findings F-23..F-30, the public
release blockers and the private-test-build verdict. The phase-2 review is in git history (`c23aad7`).

Shorthand used in the "Verify" column:
- `grep:` means `git grep -nE '<regex>' -- <paths>` must return the stated result.
- `test:` means an automated test (vitest or Playwright) that the owner adds; its name goes into the evidence.
- `manual:` means a manual step on the given OS.

---

## A. Electron hardening (owner: Platform; renderer items: Frontend)

| ID | Level | Requirement | Verify | Baseline |
|---|---|---|---|---|
| SEC-01 | MUST | Every `BrowserWindow` (overlay, feed, settings, htmlToPdf) sets `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` **explicitly**. | grep: `new BrowserWindow` in `src/main`; each has all three. Plus test: in E2E, `app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().map(w => w.webContents.getLastWebPreferences()))` shows the values. | Partial: the scaffold sets sandbox and contextIsolation, not nodeIntegration |
| SEC-02 | MUST | Also explicitly set: `webSecurity: true`, `webviewTag: false`, `nodeIntegrationInWorker: false`, `nodeIntegrationInSubFrames: false`, `allowRunningInsecureContent: false`, `experimentalFeatures: false`, `navigateOnDragDrop: false`. No `enableBlinkFeatures`. | grep the window factory; the same E2E dump as SEC-01. | — |
| SEC-03 | MUST | No `additionalArguments`, `preload` or `contextIsolation` toggled by env/flags in production. | Code review of the window factory. | — |
| SEC-04 | MUST | The preload exposes exactly the `LudApi` surface (`src/shared/api.ts`). It does not expose `ipcRenderer`, a generic `invoke/send(channel)`, `require`, `process` or `Buffer`. `on*` helpers strip the event object and return an unsubscribe function. | Read `src/preload/index.ts`; test: `Object.keys(window.lud)` equals the `LudApi` keys. | — (placeholder exposes `{}`) |
| SEC-05 | MUST | `app.on('web-contents-created')` installs: `setWindowOpenHandler(() => ({action:'deny'}))`; `will-navigate`/`will-redirect`/`will-frame-navigate` → `preventDefault()` for any URL other than the page's own; `will-attach-webview` → `preventDefault()`. | grep: `setWindowOpenHandler`, `will-navigate`; test: `window.open('https://example.com')` and `location.href='https://example.com'` from the renderer have no effect. | — |
| SEC-06 | MUST | The default session and the htmlToPdf session deny every permission: `setPermissionRequestHandler` → `callback(false)`, `setPermissionCheckHandler` → `false`, `setDevicePermissionHandler` → `false`, `setDisplayMediaRequestHandler` → no source. | grep the handlers; test: `navigator.permissions.query({name:'geolocation'})` → `denied`/`prompt`, and `getUserMedia` rejects. | — |
| SEC-07 | MUST | A dev-server URL (`ELECTRON_RENDERER_URL`) is honoured only when `!app.isPackaged`. Production loads only bundled files. | grep: `ELECTRON_RENDERER_URL` is guarded by `app.isPackaged`; manual: a packaged app with `ELECTRON_RENDERER_URL=https://example.com` still shows the bundled UI. | **FAIL F-09** |
| SEC-08 | MUST | Renderers never insert untrusted strings as HTML: no `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write`. | grep: `-e dangerouslySetInnerHTML -e innerHTML -e insertAdjacentHTML -e document.write -- src/renderer` → no matches (or reviewed constants only). | PASS (no renderer code yet) |
| SEC-09 | MUST | The CSP in every `src/renderer/*/index.html` contains at least `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'` and **no** `'unsafe-eval'`. `connect-src 'self'` (no remote hosts). `style-src 'unsafe-inline'` is accepted. | Read the three HTML files; test: no CSP violation reports in the console during E2E. | **FAIL F-10** (object-src/base-uri/form-action/frame-src missing) |
| SEC-10 | SHOULD | Renderers do not decode or preview user files (no `file://` or blob previews of dropped content). | Code review of `src/renderer/**`; CSP `img-src` has no `file:`. | PASS (nothing yet) |
| SEC-11 | MUST | Every `ipcMain.handle`/`on` validates the sender: `event.senderFrame` is the main frame (`=== event.sender.mainFrame`), the sender is one of our windows, and the frame URL equals our bundled page URL (parsed with `new URL`; no `startsWith` on the raw string). | Code review of `src/main/ipc.ts`; test: a unit test of the validator with forged frames. | — |
| SEC-12 | MUST | Per-window channel allowlist (e.g. `overlayInteractive`/`overlayDone` only from the overlay; `setSettings` only from settings/feed; `requestAccessibility` only from settings/onboarding). | Code review; unit test of the allowlist table. | — |
| SEC-13 | MUST | Every IPC payload is parsed with a zod `.strict()` schema: `optionId` is an enum of `OptionId`; `inputPaths` has length 1..1000 and each string is ≤ 4096 chars; `Partial<Settings>` is strict (unknown keys are rejected); `jobId` matches a bounded pattern. Invalid payloads → a rejected promise with a friendly message, and no crash. | Unit tests in `src/main/**.test.ts` with invalid payloads (wrong types, extra keys, huge arrays). | — |
| SEC-14 | MUST | Paths from IPC are absolute and normalised; they contain no NUL; Windows device namespaces (`\\.\`, `\\?\`) are rejected. UNC paths are accepted only as a documented decision. | Unit test of the path validator. | — |
| SEC-15 | MUST | `revealPath` only accepts paths in the in-memory set of outputs produced by jobs in this session, and calls `shell.showItemInFolder` only. No `shell.openPath` anywhere. | grep: `shell.openPath` → none; unit test: reveal of a non-output path is rejected. | — |
| SEC-16 | MUST | `shell.openExternal` is only called with hard-coded `https://` constants. | grep: `openExternal` → each call has a literal argument. | PASS (none yet) |
| SEC-17 | MUST | `electron-builder.yml` sets `electronFuses`: `runAsNode: false`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `onlyLoadAppFromAsar: true`, `enableEmbeddedAsarIntegrityValidation: true`, `enableCookieEncryption: true`; `grantFileProtocolExtraPrivileges: false` if the pages are not served from `file://` (otherwise WAIVE with the reason). | Read `electron-builder.yml`; on packaged output run `npx @electron/fuses read --app <path>` [U: CLI availability; `@electron/fuses` is installed as a transitive dev dep]; manual: `ELECTRON_RUN_AS_NODE=1 <app> -e "console.log(1)"` does **not** print 1. | **FAIL F-11** (no fuses) |
| SEC-18 | MUST | E2E hooks are installed only when `process.env.LUD_E2E === '1' && !app.isPackaged`, through a dynamic import inside that branch. `globalThis.__ludTest` is `undefined` in a packaged build even with `LUD_E2E=1`. | grep: `__ludTest` guarded by both conditions; manual (packaged, Linux CI): launch with `LUD_E2E=1` and confirm no hook (e.g. the hook writes a marker log line only in E2E mode; assert it is absent). | — |
| SEC-19 | SHOULD | `devTools: !app.isPackaged` on every window. | grep the window factory. | — |

## B. Global hook, overlay, privacy (owner: Platform; overlay UI: Frontend)

| ID | Level | Requirement | Verify | Baseline |
|---|---|---|---|---|
| SEC-30 | MUST | **No storage**: nothing derived from uiohook events (key codes, characters, coordinates, timestamps) is written to disk, logs, settings or crash dumps. | grep: `uIOhook` usages are only in `src/main/platform/trigger.ts`; review that the file has no fs, log or console calls; grep `console\.` in `src/main/platform`. | — |
| SEC-31 | MUST | **No transmission**: no uiohook data goes over IPC (only armed/disarmed signals and cursor points from `screen.getCursorScreenPoint()` while armed) or over the network. | Code review of `trigger.ts` → `index.ts` → `webContents.send` calls. | — |
| SEC-32 | MUST | **Minimisation**: the trigger uses modifier flags and the left-button state only. A key listener (if any) compares against the modifier key codes and drops the rest without storing them. `trigger-logic.ts` takes only abstract events (`{type:'down'|'up'|'move', modifiers}`), not raw key codes. | Read `trigger-logic.ts` types; unit tests feed abstract events. | — |
| SEC-33 | MUST | No logging of hook events in production paths; libuiohook logging not enabled. | grep `console\.` / logger calls near `uIOhook`. | — |
| SEC-34 | MUST | The hook is started only when gesture mode is enabled and permitted, and `uIOhook.stop()` is called on quit, on disable and on permission loss. The Feed Window works with the hook off. | Code review; E2E: toggling the setting calls stop (spy via a test hook). | — |
| SEC-35 | SHOULD | Hook callbacks do no synchronous I/O and no IPC round-trips; work is deferred (`setImmediate`/queue). | Code review. | — |
| SEC-36 | MUST | Overlay: `focusable: false` (except in feedMe), `showInactive()`, `setIgnoreMouseEvents(true, {forward:true})` when not engaged, an auto-hide timeout, Esc dismiss, hidden on `lock-screen`/`suspend`; window level not above `screen-saver`. | Code review; E2E: after `disarm()` the overlay is not visible within 3 s. | — |
| SEC-37 | MUST | The onboarding/permission copy and the README state what the hook sees and that nothing is stored or sent; the Feed Window alternative is offered. | Read the onboarding strings + README. | — |

## C. Engine: generic (owner: Engine)

| ID | Level | Requirement | Verify | Baseline |
|---|---|---|---|---|
| SEC-40 | MUST | Content sniffing: each tool checks the magic bytes / detected format against a per-category allowlist before it parses; a mismatch gives `INPUT_INVALID`. | Engine tests: an SVG renamed `.png`, a text file renamed `.mp4`, an HTML file renamed `.docx` → `INPUT_INVALID`. | — |
| SEC-41 | MUST | Limits are documented in one place (`src/engine/limits.ts` or similar): max input bytes per category, max decoded pixels, max PDF pages, max ZIP entries and uncompressed bytes, max HTML size for printToPDF, max JSON/YAML/CSV input bytes, and a per-job wall-clock timeout. | Read the file; engine tests hit each limit with a small crafted fixture (e.g. a PNG header that declares 30000×30000). | — |
| SEC-42 | MUST | Engine crash or hang → main kills and restarts the utilityProcess and emits `error` with `INTERNAL`; the UI recovers. | Integration test with a test-only "hang" job, or a manual kill of the engine pid. | — |
| SEC-43 | MUST | Inputs are `lstat`-ed; FIFOs, sockets and devices are rejected (`INPUT_INVALID`). | Engine test (POSIX only): `mkfifo` input → error within 1 s. | — |
| SEC-44 | SHOULD | `JobError.message` is friendly; `detail` (stderr, stack) is never shown in the UI and is truncated to ≤ 4 KB. | Code review; test the error mapping. | — |

## D. Images, video/audio, PDF, documents, data (owner: Engine; htmlToPdf adapter: Platform)

| ID | Level | Requirement | Verify | Baseline |
|---|---|---|---|---|
| SEC-50 | MUST | At engine start: `sharp.block({operation:['VipsForeignLoad']})`, then `sharp.unblock` only the needed loaders (PNG, JPEG, WebP, GIF, TIFF, HEIF; File/Buffer variants as used). SVG, PDF, VIPS-native and Magick loaders stay blocked. | grep `sharp.block`; engine test: an SVG renamed `.png` is rejected; all §5 image fixtures still convert. | — |
| SEC-51 | MUST | Every `sharp(...)` call passes `limitInputPixels` (explicit, ≤ 268 402 689; recommended 100 000 000) and does not pass `unlimited: true`. | grep `sharp\(` calls; grep `unlimited` → none. Test: a PNG that declares 20000×20000 → `INPUT_INVALID`. | — |
| SEC-52 | MUST | HEIC: dimensions are checked against the pixel cap before full decode; remove-bg resizes before inference. | Code review + test with a large-dimension HEIC if available (otherwise review only). | — |
| SEC-60 | MUST | ffmpeg is spawned with `spawn(path, argsArray, {shell:false, windowsHide:true})` and `-nostdin -hide_banner`; never `exec`/`execSync`/`shell:true`, never string-joined commands. | grep: `shell:\s*true` → none; grep `exec\(`/`execSync` in `src` → none; see SEC-146 for the lint gate. | — |
| SEC-61 | MUST | Every ffmpeg input is preceded by `-protocol_whitelist file` (plus `pipe` only if used). | Unit test of the args builder; engine test: an HLS playlist fixture that references `http://127.0.0.1:9/x.ts` fails without a network attempt. | — |
| SEC-62 | MUST | Every ffmpeg input is preceded by `-format_whitelist <category list>` (video/audio: `mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mp3,wav,ogg,flac,aac`; ICO/BMP: `ico,bmp_pipe`; verify with `ffmpeg -demuxers` of each shipped build). | Unit test of the args builder; engine test: `ffconcat version 1.0\nfile x.wav` saved as `.mp3` → `INPUT_INVALID`. | — |
| SEC-63 | MUST | Paths given to ffmpeg are absolute (and may be prefixed with `file:`, which only stops protocol confusion); **inputs** are never opened by the `image2` demuxer as a sequence pattern (BMP/ICO: `-f image2 -pattern_type none`, or `-f bmp_pipe`; audio/video: the SEC-62 whitelist without `image2`); image outputs do not use `image2` pattern expansion (`-update 1` or an explicit muxer); a `%` in a file name works. Phase 2 correction: `file:` does **not** stop the sequence expansion [V, REVIEW.md F-20]. | Engine test: input named `a%03d -x.mp4` converts correctly; `a%03d.bmp` next to a different `a001.bmp` converts its own content. | — |
| SEC-64 | MUST | ffmpeg is passed `-n` (never overwrite), and the output goes through the SEC-110 commit. | Args-builder unit test. | — |
| SEC-65 | MUST | Cancel and timeout kill the ffmpeg process (and children) and delete partial outputs. | Engine test: cancel during a long encode → no process left, no output file. | — |
| SEC-70 | MUST | `pdfjs-dist` ≥ 4.2.67 (CVE-2024-4367). | `npm ls pdfjs-dist`. | PASS (6.4.299) |
| SEC-71 | MUST | `getDocument` gets `maxImageSize`, `enableXfa: false`, local-only `standardFontDataUrl`/`cMapUrl`/`wasmUrl` (or none); a page-count cap; rendered canvas area capped (scale reduced for huge pages). | Code review; test: a PDF with a 14400×14400 pt page renders within the cap. | — |
| SEC-72 | SHOULD | pdf-lib merge runs under the job timeout and the total input cap. | Code review. | — |
| SEC-80 | MUST | mammoth is called without `externalFileAccess: true`; mammoth ≥ 1.12.2. | grep `externalFileAccess` → none or `false`; `npm ls mammoth`. | PASS (1.13.0; no code yet) |
| SEC-81 | MUST | Generated `.html` outputs (MD→HTML, DOCX→HTML) contain `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`, and `javascript:` hrefs are neutralised. | Engine test: an `.md` with `<script>` and `[x](javascript:alert(1))` → the output has the CSP meta and no `javascript:` href. | — |
| SEC-82 | MUST | htmlToPdf: a hidden window in a non-persistent dedicated session; `javascript: false`, `sandbox: true`, no preload; `onBeforeRequest` allows only the document URL and `data:`; deny permissions, navigation and window.open; served via a custom protocol or `data:` (never a `file://` URL in the user's folder); HTML size cap; render timeout; window destroyed after the job. | Integration/E2E test: render HTML that contains `<img src="http://127.0.0.1:PORT/beacon">` (a local test server counts hits → 0), `<iframe src="file:///etc/hostname">` (the PDF text does not contain the hostname), `<script>document.title='x'</script>` (no effect), `<meta http-equiv=refresh content="0;url=https://example.com">` (no navigation). | — |
| SEC-83 | SHOULD | DOCX output from text: no external relationships, no remote images. | Code review. | — |
| SEC-90 | MUST | js-yaml `load` uses `maxAliases` (≤ 100) and the default schema; output size is capped. | grep `load(` options; engine test: the alias-bomb fixture → `INPUT_INVALID`. | — |
| SEC-91 | MUST | XLSX input is pre-scanned with yauzl (entries, total uncompressed bytes) before exceljs reads it. | Engine test: an XLSX zip bomb → `INPUT_INVALID` quickly. | — |
| SEC-92 | SHOULD | Formula-injection behaviour is documented; text → XLSX writes strings, never formulas. | Code review + docs. | — |

## E. Archives and output paths (owner: Engine)

| ID | Level | Requirement | Verify | Baseline |
|---|---|---|---|---|
| SEC-100 | MUST | yauzl opened with `lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true`. | grep the open call. | — |
| SEC-101 | MUST | Extra name checks: NUL/control chars, `:`, Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9, with or without extension), trailing dot/space, component > 255 bytes, case-insensitive duplicates; the final resolved path is inside the destination. | Unit tests (pure function) with a table of evil names: `../x`, `/abs`, `C:/x`, `a\\..\\b`, `a/../../b`, `CON.txt`, `x:stream`, `a.`, `A.txt` + `a.txt`. | — |
| SEC-102 | MUST | Symlink entries are never created as symlinks; extracted modes are fixed (0o644 / 0o755). | Engine test: a zip with a symlink entry → a regular file or skipped; `lstat` is not a symlink. | — |
| SEC-103 | MUST | Bomb limits: ≤ 10 000 entries, total ≤ 2 GB and ≤ free disk, ratio cap, no recursive extraction, encrypted entries skipped with a message. | Engine tests with generated fixtures (many entries; 1 GB of zeros compressed). | — |
| SEC-104 | MUST | Extraction goes into a newly created folder (`name/`, `name (1)/`…), never into an existing one. | Engine test: run unzip twice → two folders, the first unchanged. | — |
| SEC-105 | SHOULD | Quarantine/MotW propagation for extracted files (macOS `com.apple.quarantine`, Windows `Zone.Identifier`). | manual (macOS, Windows): extract a downloaded zip; check `xattr -l` / `Get-Item -Stream Zone.Identifier`. | — |
| SEC-106 | MUST | The ZIP creator does not follow symlinks, skips special files, caps total bytes and entries, and stores only relative forward-slash names. | Engine test: a folder with a symlink to `/` → the archive is small and holds no target content. | — |
| SEC-110 | MUST | Never overwrite: temp file opened with `wx` → `fs.link` (or `copyFile(..., COPYFILE_EXCL)` fallback) → `unlink(tmp)`; no `fs.rename` onto the final name; `name (n).ext` on `EEXIST`. Multi-output folders use non-recursive `mkdir` of the final component. | grep `rename(` in `src/engine/output*` → none; unit tests: an existing `a.png` stays byte-identical after converting `a.jpg` → `a.png`, and the output is `a (1).png`; parallel jobs racing to the same name produce distinct files. | — |
| SEC-111 | MUST | Output names derive only from the input base name + the tool's extension; no content-derived names. | Code review. | — |
| SEC-112 | MUST | Temp files are removed on success, error and cancel. | Engine tests assert no `*.lud-*.tmp` remains after failing and cancelled jobs. | — |
| SEC-113 | SHOULD | Unwritable folder → `OUTPUT_NOT_WRITABLE`, no silent fallback location. | Engine test with a read-only dir (POSIX). | — |

## F. Model download (owner: Engine; model choice: TPM)

| ID | Level | Requirement | Verify | Baseline |
|---|---|---|---|---|
| SEC-120 | MUST | The download is user-initiated (an explicit confirm with size and source), HTTPS, a hard-coded URL, a redirect-host allowlist and a size cap. | Code review; unit test of the URL/redirect validator. | — |
| SEC-121 | MUST | SHA-256 pinned in source; verified after download (`.partial` → rename on match, delete on mismatch) **and** before each session load. | Unit test: a tampered model file → `MODEL_DOWNLOAD_FAILED` / re-download prompt; grep the pinned constant. | — |
| SEC-122 | MUST | The model license allows redistribution (no RMBG-1.4/2.0); the license and source are recorded in THIRD_PARTY_NOTICES. | Read the notices + the primary-source license link. | — (plan U6 open) |
| SEC-123 | SHOULD | The model has no external-data initialisers and is loaded only from cacheDir. | One-off check of the chosen model file; code review. | — |
| SEC-124 | SHOULD | DirectML/dxil DLLs either excluded (CPU EP only, verified on Windows CI) or their license terms included. | `electron-builder.yml` files filter + Windows CI smoke test. | **FAIL F-12** |

## G. Packaging and distribution (owner: TPM)

| ID | Level | Requirement | Verify | Baseline |
|---|---|---|---|---|
| SEC-130 | MUST | `asar: true`; only native modules (and their data) in `asarUnpack`; no source maps; no `.env`, test fixtures or `resources/bin` of other platforms in the package. | Read `electron-builder.yml`; list the packaged files (`npx asar list`, or unpack) in CI. | PASS (config), — (output) |
| SEC-131 | MUST | macOS ad-hoc signing implications are documented in the README/REPORT (Open Anyway flow on macOS 15+, Accessibility re-grant after updates); no advice to disable Gatekeeper globally. | Read the docs. | — |
| SEC-132 | MUST | No launcher, desktop file or doc passes `--no-sandbox` for end users. | grep `no-sandbox` outside `tests/` and CI → none. | PASS |
| SEC-133 | SHOULD | Docs recommend the NSIS installer over the portable exe. | Read the docs. | — |
| SEC-134 | MUST | The release notes/README say there is no auto-update; the Electron version is the latest patch of a supported major at release time. | `npm ls electron` vs the Electron releases page. | PASS (45.0.0), re-check at release |

## H. Supply chain, CI, licensing (owner: TPM)

| ID | Level | Requirement | Verify | Baseline |
|---|---|---|---|---|
| SEC-140 | MUST | `scripts/fetch-ffmpeg.mjs` fails closed: every downloaded asset (binary **and** LICENSE/README) must have a committed SHA-256 in `scripts/ffmpeg-sources.json`; a missing entry is an error. | Run the script with a pin removed → non-zero exit; the licence gate must also fail when the binary cannot run (REVIEW.md F-26). | **FAIL F-02** |
| SEC-141 | MUST | Every shipped ffmpeg is redistributable: the CI gate fails if `ffmpeg -hide_banner -L` contains `not legally redistributable` or `-buildconf` contains `--enable-nonfree`. | Package workflow step + its log. | **FAIL F-01** |
| SEC-142 | MUST | Workflow default `permissions: contents: read`; `contents: write` only on the job that creates the draft release; that job does not run `npm ci` or any project scripts. | Read `.github/workflows/*.yml`. | **FAIL F-04** |
| SEC-143 | MUST | `actions/checkout` uses `persist-credentials: false` in jobs that run `npm ci`/builds. | Read the workflows. | **FAIL F-04** |
| SEC-144 | SHOULD | All `uses:` are pinned to a full 40-char commit SHA (with a version comment); Dependabot keeps them updated. | `grep -nE 'uses: [^@]+@[0-9a-f]{40}' .github/workflows/*.yml` covers every `uses:`. | **FAIL F-05** |
| SEC-145 | MUST | `npm audit --omit=dev` has no High/Critical; Moderates are triaged (reachable or not) in the release report. | Run `npm audit --omit=dev`. | PASS (5 moderate, unreachable; see THREAT_MODEL §9.1) |
| SEC-146 | MUST | The lint gate catches unsafe process APIs: `no-restricted-imports` also covers `node:child_process` (both `exec` and `execSync`), and `no-restricted-syntax` flags `shell: true` (`Property[key.name='shell'][value.value=true]`) and member calls `.exec(`/`.execSync(` on a `child_process` default/namespace import. | Lint a probe file (see THREAT_MODEL §12) → errors on each variant. | **FAIL F-08** |
| SEC-147 | MUST | THIRD_PARTY_NOTICES.md covers every shipped component: all production npm packages (generated from `package-lock.json`, with license texts), Electron + Chromium (`LICENSES.chromium.html`), ffmpeg per platform with the **actual** version, configure flags and GPL source location, libvips and its LGPL/MPL deps, libuiohook (LGPL-3.0-or-later, not "MIT"), libheif-js (LGPL-3.0), Skia/@napi-rs/canvas (incl. MPL-2.0 parts), onnxruntime ThirdPartyNotices, the Remove-BG model. | Diff the notices against the license walk output (THREAT_MODEL §9.2). | **FAIL F-03, F-06, F-07** |
| SEC-148 | MUST | Corresponding Source for GPL/LGPL binaries we ship (ffmpeg + its GPL libs, libuiohook, libvips stack, libheif) is provided with each release (tarballs attached to the release) or by a valid written offer. | Read the release assets/notes. | **FAIL F-03, F-06** |
| SEC-149 | SHOULD | Install-time-only deps are excluded from the package (`onnxruntime-node/node_modules/{adm-zip,global-agent,…}`, `onnxruntime-node/script`). | Packaged file listing. | FAIL (Info, F-13) |

## I. Network and telemetry (owners: Platform, Engine)

| ID | Level | Requirement | Verify | Baseline |
|---|---|---|---|---|
| SEC-150 | MUST | In production, the default session cancels all `http(s)`/`ws(s)`/`ftp` requests from renderers. | Code review; E2E: `fetch('https://example.com')` in a renderer rejects. | — |
| SEC-151 | MUST | The only runtime network code is the model downloader. | `git grep -nE "fetch\(|https?\.request|net\.request|new WebSocket|XMLHttpRequest" -- src` → only the downloader (and tests). | PASS (none yet) |
| SEC-152 | MUST | No telemetry/analytics; `crashReporter` not started or `uploadToServer: false`. | grep `crashReporter`, analytics SDK names → none. | PASS |

## J. Re-verification protocol (for the post-implementation review)

1. Check out the release candidate; `npm ci`; `npm run typecheck && npm run lint && npm test`.
2. Run the grep checks above and record the outputs.
3. Run `npm audit --omit=dev`, `npm audit`, and the license walk; diff them against §9 of the threat model.
4. Build the Linux package locally (`npm run dist:linux`); inspect the asar listing, the fuses, the `resources/bin` contents and the notices.
5. Run the E2E security tests (SEC-05/06/82/150) under `xvfb-run`.
6. On the CI artifacts for mac/win: check the package logs for the SEC-141 gate and `codesign -dv` output.
7. File every FAIL in `docs/qa/BUGS.md` with the SEC ID; MUST items become High/Critical bugs.

## K. Baseline findings on the current scaffold (`develop@e9fae72`)

| ID | Severity | File | Finding | Fix suggestion | Owner |
|---|---|---|---|---|---|
| F-01 | **Critical** (license; release blocker for macOS arm64) | `scripts/fetch-ffmpeg.mjs`, `.github/workflows/package.yml` | The ffmpeg-static `b6.1.1` **darwin-arm64** asset is FFmpeg **6.0** built with `--enable-nonfree`; the binary itself says "nonfree and unredistributable" / "not legally redistributable" [V: strings + embedded configure line]. Shipping it in the arm64 DMG is a license violation. | Use another source for darwin-arm64 (e.g. build ffmpeg in CI with `--enable-gpl --enable-version3` and **without** `--enable-nonfree`, or a vetted GPL build) and add the SEC-141 CI gate on every platform. | TPM |
| F-02 | High | `scripts/fetch-ffmpeg.mjs:28-33` | Integrity pinning fails **open**: `scripts/ffmpeg-checksums.json` does not exist, so every download is "NOT PINNED" and still shipped. The LICENSE/README downloads are never hashed. | Commit the checksums file and make a missing entry fatal. Observed SHA-256 values (TOFU, 2026-10-21) are in THREAT_MODEL §12. | TPM |
| F-03 | High (license) | `THIRD_PARTY_NOTICES.md` | It says "release b6.1.1 … 6.1.1" for all platforms, but linux-x64 is 7.0.2 (johnvansickle), darwin-x64 is 6.1.1-tessus, win32-x64 is 6.1.1 gyan.dev essentials and darwin-arm64 is 6.0 nonfree [V]. No GPL Corresponding Source or written offer is provided; the statically linked GPL libs (x264, x265, xvid, rubberband…) are not listed. | Generate per-platform notices from `ffmpeg -version`/`-buildconf` in CI; attach the source (FFmpeg tag tarball + build scripts) to releases or add a GPLv3 §6 offer. | TPM |
| F-04 | High | `.github/workflows/package.yml:12-13` (+ `actions/checkout` steps in both workflows) | Workflow-level `permissions: contents: write` applies to the `package` job, which runs `npm ci` (install scripts of onnxruntime-node, protobufjs and uiohook-napi run [V: `hasInstallScript`]) and electron-builder. `actions/checkout` persists the token in `.git/config` by default, so a compromised dependency could push tags or commits or create releases. | Top-level `permissions: contents: read`; add `permissions: contents: write` only to `draft-release`; `persist-credentials: false` on every checkout. | TPM |
| F-05 | Medium | `.github/workflows/ci.yml`, `package.yml` | `uses:` pinned to mutable tags (`@v4`). | Pin to full commit SHAs with `# v4.x.y` comments; enable Dependabot for actions. | TPM |
| F-06 | High (license) | `electron-builder.yml:15-17`, `THIRD_PARTY_NOTICES.md` | `uiohook-napi` declares MIT, but the compiled `uiohook-napi.node` embeds **libuiohook (LGPL-3.0-or-later)** [V: source headers]. The builder config strips `libuiohook/**` and `src/**` (~550 KB) from the package, and the notices do not mention it. | Keep those folders in the package (or attach the uiohook-napi@1.5.5 source to releases), and add the LGPL notice + license texts (GPLv3 + LGPLv3) to the notices. | TPM |
| F-07 | Medium (license) | `THIRD_PARTY_NOTICES.md`, `electron-builder.yml` | The notices list only ffmpeg. Missing: ~290 npm packages, libvips stack (LGPL/MPL), libheif-js (LGPL-3.0), Skia/canvas (MPL-2.0 parts), onnxruntime notices, Electron/Chromium (electron-builder **deletes** `LICENSES.chromium.html` and `LICENSE` on macOS [V: `electronMac.js`]). `buffers@0.1.1` has no declared license. | Generate the notices from the lockfile in CI; add `extraResources` for Electron's `LICENSE` and `LICENSES.chromium.html`; resolve `buffers`. | TPM |
| F-08 | Medium | `eslint.config.js:9-12, 18-27` | The "no shell" lint guard is bypassable [V: probe]: `import { exec } from 'node:child_process'`, `import cp from 'child_process'; cp.execSync()` and `spawn(x, [], { shell: true })` all pass lint (in `src/main` and `src/engine`). | Add `node:child_process` path entries; add `no-restricted-syntax` for `shell: true` and for `exec`/`execSync` member calls; optionally ban `child_process` entirely outside a single `src/engine/tools/spawn.ts` wrapper. | TPM |
| F-09 | Medium | `src/main/index.ts:12` (scaffold) | `ELECTRON_RENDERER_URL` is honoured in packaged builds, so an env var makes the app load an arbitrary (remote) URL into a window with our preload. | `if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL'])`. | Platform |
| F-10 | Low | `src/renderer/{feed,overlay,settings}/index.html:5` | The CSP lacks `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `frame-src 'none'` (the `default-src 'self'` fallback still allows same-origin objects/frames; `base-uri`/`form-action` do not fall back to `default-src`). | Append those directives. | Frontend |
| F-11 | High (because the app holds a macOS Accessibility grant) | `electron-builder.yml` | No `electronFuses`: `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` all work on the shipped binary [U: not tested on a packaged build; these are Electron's documented defaults], so local malware can run code as our app and inherit its TCC permissions. | Add the `electronFuses` block from SEC-17. E2E is unaffected (it runs the unpackaged app). | TPM |
| F-12 | Medium (license, unverified) | `electron-builder.yml:11-13` | The Windows package will include `DirectML.dll`, `dxcompiler.dll` and `dxil.dll` from onnxruntime-node [V: files present]; their redistribution terms are not in the notices [U]. | Exclude them if only the CPU EP is used (verify on Windows CI), or add the terms. | TPM + Engine |
| F-13 | Info | `electron-builder.yml` | onnxruntime-node install-time deps (`adm-zip`, `global-agent`, `script/`) ship but are unused at runtime [V: grep]. `@img/sharp-wasm32` is reported "extraneous" by `npm ls` [V]. | Exclude them via `files` filters. | TPM |
| F-14 | Info | `npm audit` | 5 moderate (prod) / 12 moderate (all), none reachable at runtime (THREAT_MODEL §9.1). | Accept; re-run per release; never `audit fix --force`. | TPM |
