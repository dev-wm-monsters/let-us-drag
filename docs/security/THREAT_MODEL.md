# Let us drag! — Threat model (v0.1)

Owner: Security analyst. Status: phase 1 (design-time model, written before the implementation exists).
Baseline reviewed: branch `develop` @ `e9fae72` (scaffold: contracts in `src/shared`, placeholder `src/main`,
`src/preload`, `src/engine/worker.ts`, CI workflows, `electron-builder.yml`, `scripts/fetch-ffmpeg.mjs`).
The verifiable requirements derived from this model are in [CHECKLIST.md](CHECKLIST.md) (`SEC-xx` IDs).
Every mitigation below names the checklist item that verifies it.

How claims are marked:

- **[V]** verified in this repo/container (command run, file read, or probe script executed; see §12).
- **[W]** taken from a web source (listed in §13); not re-verified by running code.
- **[U]** unverified assumption; must be confirmed before it is relied on.

---

## 1. What we are protecting (assets)

| ID | Asset | Why it matters |
|---|---|---|
| AS-1 | The user's files (inputs, the folders they live in, every other file the user account can read) | The app runs as the user and parses arbitrary files. A bug can read, overwrite or leak unrelated files. |
| AS-2 | Keyboard and mouse activity of the whole desktop session | `uiohook-napi` installs a **global** hook (macOS event tap, Windows `WH_KEYBOARD_LL`/`WH_MOUSE_LL`, X11 XRecord [V: libuiohook sources]). It sees every keystroke, including passwords typed into other apps. |
| AS-3 | OS permissions granted to the app (macOS Accessibility; Input Monitoring [U]) | Any code that runs inside our signed/approved process inherits these grants. Malware could abuse them to log keys. |
| AS-4 | Integrity of the shipped binaries (app.asar, native modules, ffmpeg, the ONNX model) | We execute them on users' machines. Tampering means code execution for every user. |
| AS-5 | The user's privacy expectation: "local only, nothing is uploaded" | Any network request that a document can trigger (a remote image, a font, a playlist segment) breaks this promise. It is a tracking beacon and leaks the user's IP address and the fact that a file was opened. |
| AS-6 | Availability and responsiveness of the desktop | An always-on-top window and a global input hook can freeze or block the whole desktop if they misbehave. |
| AS-7 | License compliance of the distribution | We ship GPL, LGPL, MPL and proprietary components. Non-compliance can force us to pull the release. |
| AS-8 | CI and release integrity (GitHub token, draft releases) | A compromised build pipeline ships malware under our name. |

## 2. System and data flows

```
 user drag + trigger key           real drop (File objects)
 ───────────────────────►  uiohook (main)  ──arm──►  overlay renderer (sandboxed, contextIsolation)
                                                     │ webUtils.getPathForFile (preload)
                                                     ▼
                                  IPC invoke (zod-validated) ─────► main process
                                                                    │  describePaths / startJob / revealPath / settings
                                                                    ▼
                                                     engine utilityProcess (pure Node, no Electron)
                                     ┌─────────────────────┼──────────────────────────┐
                                     ▼                     ▼                          ▼
                       in-process parsers:        child process:              htmlToPdf request ──► main
                       sharp/libvips, heic         ffmpeg (spawn,              (hidden BrowserWindow,
                       (wasm), pdf.js + canvas,    shell:false)                 JS off, network off)
                       mammoth, marked, exceljs,
                       js-yaml, papaparse, yauzl,
                       yazl, pdf-lib, onnxruntime
                                     │
                                     ▼
                 outputs written next to the inputs (never overwrite)

 optional, user-initiated: Remove-BG model download (HTTPS) → cacheDir → SHA-256 check → onnxruntime
```

## 3. Trust boundaries

| ID | Boundary | Data that crosses it | Trust stance |
|---|---|---|---|
| TB-1 | File content → parsers (engine, ffmpeg, Chromium printToPDF) | Bytes of any file the user drops, including files downloaded from the Internet | **Untrusted.** Treat every input as hostile, whatever its extension. |
| TB-2 | File *names and paths* → main / engine / output naming / zip extraction | Names inside ZIPs, user file names, folder contents (symlinks, FIFOs) | **Untrusted.** |
| TB-3 | Renderer → main (IPC) | Paths, option IDs, settings patches, "reveal" requests | **Semi-trusted.** Renderers load only our own bundled pages, but they render untrusted file names, and a Chromium bug could compromise them. Main must validate everything. |
| TB-4 | Main ↔ engine utilityProcess (MessagePort) | Job requests, events, HTML for printToPDF | Our own code, but the engine processes hostile data. Main treats engine output (especially `htmlToPdf` HTML) as untrusted. |
| TB-5 | Global input hook → main | Every key and mouse event of the session | Highly sensitive data. Minimise it, never persist it, never send it anywhere. |
| TB-6 | Network → model download | The ONNX model file (tens of MB) | **Untrusted until the pinned SHA-256 matches.** |
| TB-7 | Build-time supply chain → shipped artifact | npm packages (some run install scripts), ffmpeg binaries from a third-party GitHub release, GitHub Actions | Pin and verify. |
| TB-8 | Other local processes running as the same user → our app | Environment variables, command-line flags, files in `userData`, unpacked native modules | Same-user malware is mostly out of scope, **except** that it must not be able to borrow our OS permissions (AS-3). |

## 4. Attacker models

| ID | Attacker | Capability | Goal |
|---|---|---|---|
| AT-1 | **Malicious file author** (most important) | Crafts a file that the user downloads and feeds to the Uncle. Controls every byte and the file name. | Code execution (parser memory-safety bug), local file disclosure into the output, a network beacon, denial of service (CPU, RAM or disk exhaustion), overwriting the user's files. |
| AT-2 | **Malicious archive author** | A ZIP that holds traversal names, absolute paths, symlink entries, Windows reserved or ADS names, duplicate names, a huge expansion ratio, or a huge number of entries. Also nested ZIPs: DOCX and XLSX are ZIPs too. | Write outside the destination (zip-slip), overwrite files, fill the disk, skip macOS quarantine or the Windows Mark-of-the-Web. |
| AT-3 | **Malicious rich-content author** (HTML, Markdown, DOCX) | HTML/MD/DOCX that is converted to HTML or rendered to PDF by Chromium. | Run script in a privileged context, read local files into the PDF (`<iframe src=file:///…>`, `<img src=file:…>`), make network requests (tracking pixels, fonts, `<link>`), navigate the hidden window, hang the renderer. |
| AT-4 | **Compromised renderer** | Arbitrary JS in an overlay, feed or settings renderer (via a Chromium bug or an XSS bug in our UI). | Use IPC to convert or reveal arbitrary paths, change settings (launch at login), reach Node, escape the sandbox. |
| AT-5 | **Supply-chain attacker** | Publishes a malicious version of a dependency or a GitHub Action, swaps the ffmpeg release asset, or abuses an npm install script in CI. | Ship malware in our installers; steal the CI token to push tags or releases. |
| AT-6 | **Network attacker on the model download** | MITM or a compromised mirror. | Plant a malicious model (ONNX parser bugs, external-data path tricks [U]) or a huge file. |
| AT-7 | **Local same-user malware** | Runs code as the user and can set env vars or launch our binary with flags. | Borrow our macOS Accessibility grant via `ELECTRON_RUN_AS_NODE`, `--inspect` or `NODE_OPTIONS`; enable the E2E hooks; load a remote URL into our privileged windows. |
| AT-8 | **Curious or dishonest maintainer, or a future feature** | Adds logging, telemetry or crash upload. | Keystroke data or file names leave the machine. This is what the privacy invariants in §7 prevent. |

Out of scope for v0.1: an attacker with admin/root; a physical attacker; malicious OS components; side channels.

## 5. Threats and required mitigations by component

Each row gives the threat, the required mitigation, the owner and the checklist ID. "MUST" means a release blocker.

### 5.1 Electron shell (main, preload, renderers) — owner: Platform (main/preload), Frontend (renderer)

| Threat | Required mitigation | SEC |
|---|---|---|
| Renderer gets Node or Electron internals | Every `BrowserWindow` MUST set `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `nodeIntegrationInSubFrames: false`, `webSecurity: true`, `webviewTag: false`, `allowRunningInsecureContent: false`, `experimentalFeatures: false`, `navigateOnDragDrop: false`. Set them explicitly even where they are Electron's defaults [V: defaults read from `electron.d.ts` 45.0.0]. | SEC-01..03 |
| Preload over-exposes APIs | The preload exposes only the `LudApi` surface from `src/shared/api.ts`. Never expose `ipcRenderer` itself, generic `invoke(channel, …)`, `require`, or `process`. Event subscriptions MUST strip the `IpcRendererEvent` before calling back. | SEC-04 |
| Navigation or new windows to attacker content | `will-navigate`, `will-redirect` and `will-frame-navigate`: `preventDefault()` unless the URL equals the page's own URL. `setWindowOpenHandler(() => ({ action: 'deny' }))` on every webContents, installed through `app.on('web-contents-created')`. `will-attach-webview` → `preventDefault()`. | SEC-05 |
| Permission prompts (camera, mic, geolocation, notifications, HID/USB/serial) | `session.setPermissionRequestHandler` → deny all. `setPermissionCheckHandler` → false. `setDevicePermissionHandler` → false. `setDisplayMediaRequestHandler` → reject. Exception: WebAudio for the sound effects needs no permission [U: verify that the sounds still play with deny-all]. | SEC-06 |
| A remote URL loaded into a privileged window | Load only bundled pages. The dev-server URL (`ELECTRON_RENDERER_URL`) MUST be honoured only when `!app.isPackaged`. **The current scaffold honours it unconditionally (finding F-09).** | SEC-07 |
| XSS in our UI through a file name | Renderers MUST render file names and error messages as text: no `dangerouslySetInnerHTML`, no `innerHTML`. CSP: `default-src 'none'` or `'self'`, `script-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `frame-src 'none'`. No `'unsafe-eval'` (use `'wasm-unsafe-eval'` only if WASM is really needed in a renderer). | SEC-08, SEC-09 |
| Renderers decode hostile content | Renderers MUST NOT decode or preview the dropped files (no thumbnails of user images or PDFs in v0.1). The Chromium image decoders in an unsandboxed context are attack surface we do not need. | SEC-10 |
| IPC abuse by a compromised renderer (AT-4) | Every `ipcMain.handle` MUST: (1) check that `event.senderFrame` is the main frame of one of *our* windows and that its URL is our bundled page; (2) check that the channel is allowed for that window (e.g. `overlayInteractive` only from the overlay, `setSettings` only from settings or feed); (3) parse the arguments with a zod `.strict()` schema (bounded array lengths, bounded string lengths, enum option IDs); (4) return friendly errors without stack traces. | SEC-11..13 |
| Arbitrary path operations through IPC | `describePaths`/`startJob` paths MUST be absolute and normalised; no NUL bytes; reject Windows device paths (`\\.\`, `\\?\`) and, unless the drop really came from a network location, UNC paths (opening `\\host\share` makes Windows send NTLM credentials to that host [W: general Windows behaviour, not re-verified]). `revealPath` MUST accept only paths that a finished job produced (an in-memory allowlist), and MUST use `shell.showItemInFolder`, never `shell.openPath` or `openExternal`. | SEC-14, SEC-15 |
| `shell.openExternal` with attacker-controlled URLs | Use it only with hard-coded `https://` URLs (e.g. the project homepage). Never pass renderer-supplied strings. | SEC-16 |
| Local code injection that borrows our TCC grants (AT-7) | Set Electron fuses in `electron-builder.yml` (`electronFuses`, supported by electron-builder 26.15.3 [V: `app-builder-lib/scheme.json`]): `runAsNode: false`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `onlyLoadAppFromAsar: true`, `enableEmbeddedAsarIntegrityValidation: true` (macOS and Windows), `grantFileProtocolExtraPrivileges: false` (only if the pages are served from a custom protocol; otherwise leave it and record why). Note: Playwright `_electron` needs `--inspect` [V: playwright-core passes `--inspect=0`], so E2E MUST keep running against the unpackaged app, never the fused build. | SEC-17 |
| E2E hooks enabled in production (AT-7) | Install `__ludTest` and listen on `lud:test-drop` only when `process.env.LUD_E2E === '1' && !app.isPackaged`. Load the hook module with a dynamic `import()` inside that branch so it is never evaluated in production. The renderer side of `TEST_DROP_CHANNEL` may exist (main is the only sender), but it MUST NOT be callable from the page. | SEC-18 |
| DevTools in production | `devTools: !app.isPackaged`. This is defence in depth only, not a boundary. | SEC-19 |

### 5.2 Overlay window and the global input hook — owner: Platform (+ Frontend for overlay UI)

| Threat | Required mitigation | SEC |
|---|---|---|
| Keystroke capture leaks (AT-8, AS-2) | **Privacy invariants (§7), MUST.** Keep the trigger decision in memory as a boolean or modifier enum. Prefer the modifier flags carried on mouse events (`shiftKey`, `altKey`, `ctrlKey`, `metaKey` exist on `UiohookMouseEvent` [V: d.ts]) over key events. If a `keydown`/`keyup` listener is needed, it compares `keycode` against the modifier set and discards every other code immediately. | SEC-30..33 |
| Hook keeps running when it is not needed | Start the hook only when gesture mode is enabled and permission is present. `uIOhook.stop()` on quit, when the gesture is disabled, and on macOS permission revocation. Hide the overlay on `powerMonitor` `lock-screen`/`suspend`. | SEC-34 |
| Desktop freeze | On macOS libuiohook creates an **active** event tap (`kCGEventTapOptionDefault`, not listen-only) [V: `libuiohook/src/darwin/input_hook.c:1179`]. On Windows it installs low-level hooks [V]. Slow callbacks delay input system-wide, and reports say input locks up when Accessibility is revoked while an active tap runs [W, anecdotal]. So: no synchronous work in hook callbacks (no fs, no IPC round-trips; post to the event loop); watch for permission loss and stop the hook. | SEC-35 |
| Overlay steals clicks, focus or drops | Overlay: `focusable: false`, shown with `showInactive()`, `setIgnoreMouseEvents(true, { forward: true })` whenever it is not engaged, a hard timeout that hides it when no drop arrives, and Esc to dismiss. It MUST NOT stay up after disarm, and MUST NOT cover the lock screen or secure-input prompts (do not use a window level above `screen-saver`; hide on lock). | SEC-36 |
| Misleading permission request | The macOS onboarding text MUST say plainly that the app receives keyboard and mouse events system-wide, uses only the trigger key and drag state, stores nothing, and works without the permission (Feed Window). | SEC-37 |

### 5.3 Engine: generic input handling — owner: Engine

| Threat | Required mitigation | SEC |
|---|---|---|
| Wrong parser chosen through extension spoofing | The extension picks the *option list* (UX only). The engine MUST verify the content (magic bytes / detected format) against an **allowlist per category** before it parses, and fail with `INPUT_INVALID` otherwise. Example: `sharp` sniffs content, so an SVG renamed `x.png` reaches librsvg [V: probe]. | SEC-40 |
| Resource exhaustion (AT-1) | Per job: a wall-clock timeout (cancel the child or worker), an input size cap (configurable, e.g. 4 GB for video and 512 MB otherwise), decoded pixel caps, page and entry caps, a cap on output bytes, and a disk-space precheck where feasible. The engine runs in a utilityProcess, so a hang never freezes the UI; main restarts a dead engine and reports `INTERNAL`. | SEC-41, SEC-42 |
| Special files as inputs | `lstat` every input. Accept regular files (and directories for ZIP) only. Reject FIFOs, sockets and devices: reading a FIFO blocks forever. | SEC-43 |
| Leaking internals in errors | `JobError.message` is human-friendly. `detail` (stack, tool stderr) goes only to local logs, never to the UI, and is truncated. | SEC-44 |

### 5.4 Images (sharp/libvips, heic-decode, ICO/BMP via ffmpeg) — owner: Engine

- **MUST** call `sharp.block({ operation: ['VipsForeignLoad'] })` once at engine start, then `sharp.unblock` only the loaders that §5 needs (`VipsForeignLoadPngFile`, `…JpegFile`, `…WebpFile`, `…GifFile`, `…TiffFile`, `…HeifFile`, plus the `…Buffer` variants if buffers are used). This disables SVG (librsvg), the VIPS native format, PDF and the other loaders for hostile input. [V: probe — after the allowlist a real PNG loads and an SVG named `.png` is rejected with "unsupported image format".] (SEC-50)
- **MUST** pass `limitInputPixels` explicitly (the default 268 402 689 px ≈ 1 GiB RGBA is the documented default [V: d.ts]; recommended: 100 000 000) and keep `failOn: 'warning'` (the default) and `unlimited: false`. (SEC-51)
- HEIC/HEIF via `heic-decode` → libheif compiled to WASM: read the width and height first and reject above the pixel cap before decoding. (SEC-52)
- The `remove-bg` pre-processing resizes to the model input size before inference. (SEC-52)

### 5.5 Video and audio (ffmpeg child process) — owner: Engine; binary provenance — owner: TPM

ffmpeg is a huge C attack surface, and the builds we ship are network-capable (http, https, rtmp, tcp, udp, tls…) [V: `-protocols` on the shipped linux binary].

- **MUST** spawn with `spawn(ffmpegPath, args, { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })`, use absolute paths only, and add `-nostdin -hide_banner -nostats`. (SEC-60)
- **MUST** pass `-protocol_whitelist file` (add `pipe` only if pipes are used) **before** `-i`. [V: with it, an HLS playlist's `http://` segment is refused: "Protocol 'http' not on whitelist 'file'".] (SEC-61)
- **MUST** pass `-format_whitelist` with only the demuxers a category needs, for example video/audio: `mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mp3,wav,ogg,flac,aac`, and BMP/ICO: `bmp_pipe,ico` (exact names verified with `-demuxers` on the shipped linux build [V]). This blocks the `concat` and `hls` demuxers. [V: a file named `cc.mp3` that holds `ffconcat version 1.0\nfile secret.wav` **is** opened by the concat demuxer and reads a sibling file with ffmpeg 7.0.2. With the whitelist it fails with "Format not on whitelist".] (ffmpeg ≥ 6.1 already refuses HLS on non-`.m3u8` extensions [V: 6.1 and 7.0.2], but the darwin-arm64 build is 6.0 [V], so do not rely on that.) (SEC-62)
- **MUST** never let a path be read as a pattern or an option. Prefix paths with `file:`. For image outputs, avoid `image2` sequence semantics (`-update 1`, or an explicit muxer) so that a `%d` in a file name is not expanded. Never let a path start with `-`; absolute paths guarantee this. (SEC-63)
- **MUST** write to a temp name and then commit without clobbering (§5.10). Pass `-n` so ffmpeg itself never overwrites. (SEC-64)
- **MUST** kill the process tree on cancel or timeout and clean up the partial output. (SEC-65)
- Output limits: GIF ≤ 15 fps and ≤ 480 px (already in the plan); cap the output duration to the input duration.

### 5.6 PDF (pdf.js + @napi-rs/canvas, pdf-lib) — owner: Engine

- pdf.js `isEvalSupported` no longer exists in pdfjs-dist 6.4.299 [V: 0 occurrences in `legacy/build/pdf.mjs`]. The eval-based font path behind CVE-2024-4367 was removed in 4.2.67 [W]. Keep pdfjs-dist ≥ 4.2.67. (SEC-70)
- **MUST** set `maxImageSize` (e.g. 50 000 000 px), `enableXfa: false` (the default), and no `cMapUrl` or `standardFontDataUrl` pointing to the network (bundled files only). Cap the page count (e.g. 500 pages for PNG/JPG export) and the **rendered canvas size** (viewport width × height × scale ≤ e.g. 50 MP; reduce the scale for huge MediaBoxes). (SEC-71)
- pdf-lib (merge) on hostile PDFs: run in the engine with the job timeout and cap the total input size. pdf-lib 1.17.1 is old (2021) [V: version]; track it as a dependency risk. (SEC-72)
- `to-txt`: output is plain UTF-8 text. No HTML is produced.

### 5.7 Documents and rich text (mammoth, marked, docx, htmlToPdf) — owner: Engine + Platform (htmlToPdf adapter)

- mammoth: keep `externalFileAccess` at its default `false` [V: `options-reader.js:66`, README]. mammoth ≥ 1.12.2 fixes prototype pollution that could flip it [V: NEWS]. mammoth does **not** sanitise output (e.g. `javascript:` links) [V: README §Security]. Run it under the job timeout because "pathological performance" inputs exist [V: README]. (SEC-80)
- marked does **not** sanitise HTML [V: README]. For `to-html` outputs (from MD or DOCX), the generated HTML file MUST include a restrictive CSP meta (`default-src 'none'; img-src data:; style-src 'unsafe-inline'`). Then a `<script>` that a hostile `.md` smuggled in will not run when the user later opens the output in a browser. Also neutralise `javascript:` URLs in links. No sanitiser library is installed and dependencies are frozen, so this CSP is the conservative mitigation. (SEC-81)
- **htmlToPdf adapter (main), MUST:** a dedicated hidden `BrowserWindow` with `show: false`, `javascript: false`, `sandbox: true`, `contextIsolation: true`, **no preload**, `webSecurity: true`, `images: true`, and a dedicated **non-persistent** session (`partition` without `persist:`). In that session: `webRequest.onBeforeRequest` cancels **everything** except the single document URL and `data:` URLs; deny all permissions; `will-navigate` → `preventDefault`; `setWindowOpenHandler` → deny. Serve the HTML from a custom scheme handler (e.g. `protocol.handle` on that session) with a response CSP header `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:`, or from a `data:` URL when it is small. **Never** from a `file://` URL in the user's folder, because a relative `<iframe src="secret.txt">` or `<img src="file:///…">` would put local files into the PDF. Add a render timeout and destroy the window after every job. (SEC-82)
- The HTML handed over by the engine (TB-4) is untrusted. Main MUST cap its size (e.g. 50 MB) before loading it. (SEC-82)
- DOCX output (`docx` library) from text inputs: text only, no external relationships. (SEC-83)

### 5.8 Data (papaparse, js-yaml, exceljs) — owner: Engine

- js-yaml 5.5.0: aliases are shared references, so a 369-byte YAML file loads fine but `JSON.stringify` makes **69 MB** of it [V: probe]. **MUST** pass `maxAliases` (e.g. 100) and keep `maxDepth` (default 100) [V: d.ts]. With `maxAliases: 50` the probe throws "aliases exceeded maxAliases" [V]. Use the default (core) schema; never enable custom JS types. (SEC-90)
- exceljs reads XLSX = ZIP + XML. Pre-scan the XLSX with yauzl for entry count and total uncompressed size (the same limits as §5.9) **before** handing it to exceljs. Cap rows × columns when exporting. (SEC-91)
- CSV/XLSX formula injection: a CSV produced from XLSX data can contain cells that start with `=`, `+`, `-`, `@`. This is accepted for v0.1 (fidelity first) and documented for users as an informational item; we never write formulas into XLSX from text input (write values as strings). (SEC-92)
- JSON: cap the input size before `JSON.parse` (it is loaded into memory). (SEC-41)

### 5.9 Archives (yauzl unzip, yazl zip) — owner: Engine

Unzip (`unzip` option), MUST:

1. Open with `{ lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true }`. yauzl then rejects absolute paths, `..` segments and backslashes [V: README §validateFileName / strictFileNames]. (SEC-100)
2. Add our own name checks on top: reject NUL and control characters, `:` (NTFS alternate data streams), the Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`, also with extensions), trailing dots or spaces, and components longer than 255 bytes. Detect case-insensitive duplicates. After `path.resolve(dest, name)`, assert that the result is inside `dest` (with a separator check, not `startsWith` on the raw string). (SEC-101)
3. **Never create symlinks.** An entry whose external attributes mark it as a symlink (`(externalFileAttributes >>> 16) & 0o170000 === 0o120000`) is skipped (or written as a regular file that contains the link text). Never apply attacker-supplied permission bits: write files 0o644 and directories 0o755 (umask applies). (SEC-102)
4. Bomb limits: at most 10 000 entries, total uncompressed ≤ min(2 GB, free disk − margin), per-entry ratio ≤ 200:1 (unless the entry is small, e.g. < 1 MB), nesting not followed (inner ZIPs are written as files, never extracted recursively). Rely on `validateEntrySizes` so that `uncompressedSize` can be trusted [V: README]. Skip encrypted entries with a friendly message. (SEC-103)
5. Extract into a **new** folder `name/` (`name (1)/` on collision) that is created non-recursively (`mkdir` without `recursive` for the final component, so it fails if it exists). Never merge into an existing directory. (SEC-104)
6. Propagate the download provenance: on macOS copy the `com.apple.quarantine` xattr of the source ZIP to the extracted files; on Windows copy the `Zone.Identifier` stream (Mark-of-the-Web). Otherwise an app or script downloaded inside a ZIP and extracted by us skips Gatekeeper or SmartScreen. The macOS route needs `/usr/bin/xattr` through `execFile` with an args array, or a native module (not available; deps are frozen) [U: implementation route]. (SEC-105)

Zip (`zip` option), MUST:

1. `lstat` while walking. Do **not** follow symlinks: a folder that holds a link to `~` would otherwise zip the whole home directory. Store links as regular entries of their link text, or skip them. Skip FIFOs, sockets and devices. (SEC-106)
2. Cap the total input bytes and the entry count; detect directory cycles (they are impossible without following links, so this is defence in depth). (SEC-106)
3. Normalise entry names to relative forward-slash paths. Never store absolute paths or `..`. (SEC-106)

### 5.10 Output naming and writing — owner: Engine

- Outputs go next to the source. **Never overwrite.** Implementation MUST be race-free: write to a temp file in the same directory (`.<name>.lud-<random>.tmp`, opened with `wx`), then commit with `fs.link(tmp, final)` (fails with `EEXIST`, so no clobber), retry the next `name (n).ext` on `EEXIST`, then `unlink(tmp)`. On file systems without hard links (FAT/exFAT), fall back to `copyFile(tmp, final, COPYFILE_EXCL)`. **Never use `fs.rename` for the final step**: it replaces silently on POSIX. (SEC-110)
- Output names are built from the input *base name* plus our extension. Never from content (e.g. a PDF title or names inside a ZIP, except inside the extraction folder, which §5.9 covers). (SEC-111)
- Clean up temp files on every error and cancel path, and at engine start (stale `*.lud-*.tmp` older than 1 h in output folders that we know about) [U: scope of the start-up sweep is left to the engine dev]. (SEC-112)
- If the output folder is not writable → `OUTPUT_NOT_WRITABLE`. Never fall back to writing elsewhere silently. (SEC-113)

### 5.11 Remove-BG model (onnxruntime-node) — owner: Engine (+ TPM for model choice and license)

- The download is user-initiated only, with a clear size and source prompt. HTTPS only, and the URL is a hard-coded constant. Allowed redirect hosts: the GitHub release host and `objects.githubusercontent.com` [U: confirm the final host when the release mirror exists]. Cap the size (expected size + 1 %). (SEC-120)
- **MUST** verify a SHA-256 pinned in source code before first use **and on every load** (a same-user process can replace files in `userData`). Save as `*.partial`, hash it, then rename to the final name only on a match; delete it on mismatch. (SEC-121)
- The model license MUST allow redistribution. BRIA RMBG-1.4 and RMBG-2.0 are **non-commercial / source-available** [W], so they are not acceptable for a mirrored download. BiRefNet is reported as MIT [W, unverified: mirror card] and U²-Net as Apache-2.0 [U]. Verify the license from the upstream LICENSE file (plan U6). (SEC-122)
- Load the model only from our cache dir. Do not use ONNX models with external-data references (verify that the model has no `external_data` initialisers [U]). (SEC-123)
- onnxruntime-node ships `DirectML.dll`, `dxcompiler.dll` and `dxil.dll` on win32 [V]. `onnxruntime.dll` does not import DirectML statically [V: `objdump -p`]. If only the CPU execution provider is used, exclude these DLLs from the package, after a Windows CI check that the session still loads. Otherwise include the Microsoft redistribution terms [U: license text]. (SEC-124)

### 5.12 Packaging, signing, distribution — owner: TPM

- `asar: true` and `asarUnpack` for native modules are in place [V]. Add the fuses from SEC-17. (SEC-130)
- macOS: ad-hoc signing (`identity: '-'`, `hardenedRuntime: false`) [V]. Consequences to document: no notarization, so Gatekeeper blocks the first launch. On macOS 15+ the Control-click → Open bypass was removed and users must go to System Settings → Privacy & Security → Open Anyway [W]. Each build has a new code hash, so the Accessibility grant likely has to be renewed after every update [U]. We MUST NOT tell users to disable Gatekeeper globally (`spctl --master-disable`). (SEC-131)
- Linux: the `.deb` relies on the SUID `chrome-sandbox`. AppImages on distros that restrict unprivileged user namespaces (e.g. Ubuntu 24.04 AppArmor) may not start without `--no-sandbox` [U]. We MUST NOT ship launchers or docs that pass `--no-sandbox` by default. (SEC-132)
- Windows: the portable `.exe` runs from Downloads, a classic DLL-planting location [U: whether electron-builder's portable stub is affected]. Prefer the NSIS installer in docs. (SEC-133)
- No auto-update in v0.1, so users keep an old Chromium/Electron. The README MUST tell users to update manually, and releases MUST follow Electron security patch releases for the supported major (Electron supports the latest 3 majors [W]; we are on 45.0.0 [V]). (SEC-134)

### 5.13 Supply chain and CI — owner: TPM

See [CHECKLIST.md §H and §K](CHECKLIST.md) (baseline findings F-01..F-14). Key requirements:

- Commit `package-lock.json`, use `npm ci`, freeze dependencies (already in place) [V].
- Pin ffmpeg by SHA-256 and **fail closed** when no pin exists. Gate on `ffmpeg -L` not saying "not legally redistributable" and on `-buildconf` not containing `--enable-nonfree`. (SEC-140, SEC-141)
- Default workflow token `contents: read`; `contents: write` only in the job that creates the draft release, and that job MUST NOT run `npm ci`. `actions/checkout` with `persist-credentials: false`. Pin third-party and GitHub actions to full commit SHAs [W: GitHub hardening guidance]. (SEC-142..144)
- Track `npm audit` results (§9) for every release. (SEC-145)

## 6. HTML→PDF and "local only" guarantee: network policy (summary)

The app makes **no** network requests at runtime except the user-initiated model download. Enforcement:

1. Default session: `webRequest.onBeforeRequest` cancels any `http:`, `https:`, `ws:`, `wss:` or `ftp:` request from our renderers (in production; the dev server is allowed only when `!app.isPackaged`). (SEC-150)
2. htmlToPdf session: deny everything except the document itself (§5.7). (SEC-82)
3. ffmpeg: `-protocol_whitelist file` (§5.5). (SEC-61)
4. pdf.js: no remote cmaps/fonts (§5.6). (SEC-71)
5. Engine Node code: the only `fetch`/`https` usage is the model downloader (grep gate). (SEC-151)
6. No telemetry, no crash upload: `crashReporter` not started, or started with `uploadToServer: false`; no analytics SDKs. (SEC-152)

## 7. Privacy invariants for the global hook (MUST, release blockers)

1. **P-1 No storage:** no key code, key character, mouse coordinate or timestamp from uiohook is written to disk (settings, logs, crash dumps, temp files) or kept in memory beyond the current trigger state. (SEC-30)
2. **P-2 No transmission:** none of it is sent over IPC to renderers, except a coarse "armed/disarmed" signal and the cursor position *while armed*, which comes from `screen.getCursorScreenPoint()` and not from uiohook. Nothing is sent over the network. (SEC-31)
3. **P-3 Minimisation:** only the trigger modifier state and the left-button state are derived. Other key codes are dropped in the callback without being stored, logged or compared beyond the modifier set. (SEC-32)
4. **P-4 No logging:** no `console.log` of uiohook events in production code paths; uiohook/libuiohook debug logging stays off. (SEC-33)
5. **P-5 Transparency:** the README and the onboarding state what the hook sees and what is kept (nothing). (SEC-37)
6. **P-6 Off switch:** a setting or the Feed Window lets users run without the hook at all, and the hook is stopped (not just ignored) when it is disabled. (SEC-34)

## 8. Residual risks (accepted for v0.1, documented)

- Memory-safety bugs in native parsers (libvips, libheif, ffmpeg, Skia, Chromium) cannot be ruled out. The isolation we get: ffmpeg is a separate process; sharp, pdf.js, canvas and onnxruntime run inside the engine utilityProcess, which is **not** OS-sandboxed (`ForkOptions` has no sandbox option [V: d.ts]), so a native RCE there runs with user privileges. Compensating controls: format allowlists, size caps, prompt patch releases.
- A compromised renderer can still ask main to convert any user-readable file the IPC accepts, and write new (never overwriting) files next to it. Main cannot independently verify that a path came from a real drop. Impact: limited to creating new files. Accepted, because renderers load no remote content.
- Converted outputs (CSV from XLSX, HTML from MD) can carry active content that other programs act on (formula injection, links). Documented.
- Same-user malware can tamper with our unpacked native modules or userData. Out of scope, apart from the fuses (SEC-17) and model re-hashing (SEC-121).

## 9. Dependency audit and licensing (baseline at e9fae72)

### 9.1 npm audit [V: run on 2026-10-21]

- `npm audit --omit=dev`: **5 moderate, 0 high, 0 critical.**
  - `sprintf-js` (GHSA-hp3w-g68c-fv3c, DoS through an unbounded precision specifier) via `mammoth → argparse@1.0.10`. **Not reachable**: `argparse` is used only by mammoth's CLI (`node_modules/mammoth/bin/mammoth`), not by the library [V: grep]. The suggested fix (downgrade mammoth to 0.3.29) is unacceptable.
  - `uuid < 11.1.1` (GHSA-w5hq-g745-h8pq, missing buffer bounds check in `v3`/`v5`/`v6` when a `buf` is passed [W]) via `exceljs`. **Not reachable**: exceljs uses only `v4()` without a buffer [V: grep `cf-rule-ext-xform.js`]. The suggested fix (downgrade exceljs to 3.4.0) is unacceptable.
- `npm audit` (all): **12 moderate**. The 7 extra are build-time only: `sprintf-js` via `roarr → global-agent@3 → @electron/get → app-builder-lib / electron-builder / dmg-builder / electron-builder-squirrel-windows`. Not shipped.
- Decision: accept; re-run at every release (SEC-145). Do **not** run `npm audit fix --force`, because it downgrades major packages.

### 9.2 Licenses of production dependencies [V: script over `package-lock.json` non-dev entries + installed `package.json`]

292 non-dev lock entries (including optional platform packages that are not installed on Linux). Distribution of licenses: MIT 213, Apache-2.0 19, ISC 17, BSD-3-Clause 14, LGPL-3.0-or-later 10 (sharp-libvips per platform), BSD-2-Clause 4, Apache-2.0 AND LGPL-3.0-or-later 3 (sharp win32), 0BSD 2, PSF-2.0 1 (`argparse@3`), Unlicense 1 (`big-integer`), MIT/X11 1 (`chainsaw`), BSD 1 (`duck`, the LICENSE file is BSD-2-style), (MIT OR GPL-3.0-or-later) 1 (`jszip`, we elect MIT), LGPL-3.0 1 (`libheif-js`), (MIT OR CC0-1.0) 1, (MIT AND Zlib) 1 (`pako`), **no license field: 1 (`buffers@0.1.1`)**.

Items that need action before distribution (an MIT app that *bundles* these):

| Component | License | Bundled how | Obligation / action | Severity |
|---|---|---|---|---|
| ffmpeg (darwin-arm64 asset of ffmpeg-static b6.1.1) | **"nonfree and unredistributable"**: built with `--enable-nonfree` [V: strings in the binary: "This version of %s has nonfree parts compiled in. Therefore it is not legally redistributable."] | separate executable | **Cannot be distributed at all.** Replace the source (see F-01). | Critical |
| ffmpeg (linux-x64 = 7.0.2 johnvansickle, darwin-x64 = 6.1.1-tessus, win32-x64 = 6.1.1 gyan.dev essentials) | GPL-3.0-or-later (`--enable-gpl --enable-version3`) [V: embedded configure strings, `-L` on linux] | separate executable (mere aggregation, so the app can stay MIT) | Ship the GPL text, a correct version per platform, and the **Corresponding Source** (or a written offer, GPLv3 §6) for ffmpeg *and* the statically linked GPL libs (x264, x265, xvid, rubberband, vidstab, frei0r…). THIRD_PARTY_NOTICES currently says "6.1.1" for all platforms, which is wrong. | High |
| `uiohook-napi` → **libuiohook** | npm says MIT, but the embedded libuiohook is **LGPL-3.0-or-later** [V: source headers]; it is compiled into `uiohook-napi.node` | native module (asarUnpacked, so replaceable as a whole) | LGPL notice + license text in the app, plus source for the library. `electron-builder.yml` currently **strips** `libuiohook/**` and `src/**` (~550 KB) [V]. Keep them or attach the source to the release. | High |
| `libheif-js` (via heic-decode) | LGPL-3.0 | JS + WASM inside app.asar | LGPL notice + text + source location. Consider `asarUnpack` so users can replace it (LGPLv3 §4 relinking) [W: LGPLv3 text]. | Medium |
| `@img/sharp-libvips-*` (libvips, glib, pango, librsvg, libheif, libexif, fribidi, proxy-libintl: LGPLv3; cairo MPL-1.1; aom with the AOM patent license; others permissive) [V: its README] | LGPL-3.0-or-later | shared library, asarUnpacked | Notices, license texts, source location (sharp-libvips repo tag for 1.3.4). | Medium |
| `@napi-rs/canvas` (Skia + Rust crates) | MIT, plus MPL-2.0 parts (cssparser, selectors), ICU, FTL, IJG, libpng… [V: `sbom.cdx.json`] | static native module | Include notices; MPL-2.0 needs a statement of where the source is. | Medium |
| onnxruntime-node | MIT; ORT's own third-party notices (protobuf, abseil, eigen…) are not in the npm package [V: no notice file]; Windows DirectML/dxil are Microsoft redistributables [U] | native module + DLLs | Include ORT ThirdPartyNotices for 1.30.0; resolve DirectML (SEC-124). | Medium |
| Electron / Chromium | MIT + Chromium third-party licenses | runtime | electron-builder **deletes** `LICENSE` and `LICENSES.chromium.html` on macOS [V: `app-builder-lib/out/electron/electronMac.js`]. Copy them in via `extraResources`. Win/Linux keep them in the app folder [U: check the packaged output]. | Medium |
| `buffers@0.1.1` (exceljs → unzipper → binary) | no license declared [V] | JS in asar | Needs a decision: upstream repo `substack/node-buffers` [U: license]. If unlicensed, it is "all rights reserved". Ask the TPM to check the upstream repo and record it. | Low/Medium |
| `pdfjs-dist`, `sharp`, `long`, `flatbuffers`, `detect-libc`, `crc-32`, `readdir-glob` | Apache-2.0 | JS | Include license text; no NOTICE file ships with pdfjs-dist [V]. | Low |
| `adm-zip`, `global-agent` (onnxruntime-node install-time deps) | MIT / BSD-3-Clause | shipped but unused at runtime [V: only `script/install.js` requires global-agent] | Optional: exclude from the package to cut the surface. | Info |

There are no GPL-only JS dependencies (jszip is dual MIT/GPL, and we elect MIT). PSF-2.0, Unlicense, 0BSD, ISC and BSD are compatible with MIT distribution as long as their notices are included.

## 10. Assumptions and open questions

- Q1 [U]: Which macOS TCC service does the active event tap need on current macOS: Accessibility only, or also Input Monitoring? This affects the onboarding text and the manual checklist (plan U7).
- Q2 [U]: Do Windows/Linux packages keep Electron's `LICENSES.chromium.html`? Check the packaged output in CI.
- Q3 [U]: Remove-BG model choice and license (plan U6).
- Q4 [U]: macOS 15+ behaviour for ad-hoc apps (Open Anyway flow; whether the Accessibility grant survives updates).
- Q5 [U]: whether `onnxruntime` on Windows needs the MSVC runtime (`MSVCP140.dll`, `VCRUNTIME140*.dll` are imported [V: objdump]), which Electron may not ship. This is a functional risk; flagged to the Engine/TPM, not a security finding.

## 11. Mapping to the plan's Definition of Done

Plan §8 item 4 ("Security review completed; all High/Critical findings fixed and re-verified") is satisfied when every **MUST** item in CHECKLIST.md is PASS or has a TPM-accepted waiver, and the Critical/High baseline findings (F-01, F-02, F-03, F-04, F-06, F-11) are closed.

## 12. Evidence (commands and probes run for this document)

All probes ran in this container (Linux x64, Node 22) on 2026-10-21. The probe scripts lived in the session scratchpad, outside the repo.

- `npm ci` (ok); `npm audit --omit=dev` → 5 moderate; `npm audit` → 12 moderate.
- License walk over `package-lock.json` (non-dev) + installed `package.json` files.
- sharp probe: SVG content in `actually-svg.png` → `metadata().format === 'svg'`. After `sharp.block({operation:['VipsForeignLoad']})` + `unblock([...File loaders])`: a real PNG loads and the SVG is rejected. `sharp.versions` lists libvips 8.18.7, rsvg 2.63.2, heif 1.23.5.
- js-yaml probe: 369-byte alias document → `JSON.stringify` length 69 135 830; `maxAliases: 50` → throws.
- ffmpeg probes: system 6.1 and shipped linux 7.0.2 refuse HLS on `.mp4`/`.mkv`/`.avi`. On `.m3u8` the system build tries `http://127.0.0.1:9/…`. `-protocol_whitelist file` blocks it. `ffconcat` disguised as `.mp3` reads a sibling file on 7.0.2; `-format_whitelist` blocks it; real MP4 and MP3 still convert with the whitelist.
- ffmpeg-static b6.1.1 assets downloaded and hashed (SHA-256 below), configure lines and license strings extracted from the binaries:
  - `ffmpeg-linux-x64.gz` `bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa`: FFmpeg 7.0.2-static (johnvansickle), GPLv3
  - `ffmpeg-darwin-arm64.gz` `8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa`: FFmpeg 6.0, **--enable-nonfree, unredistributable**
  - `ffmpeg-darwin-x64.gz` `929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106`: FFmpeg 6.1.1-tessus, GPLv3
  - `ffmpeg-win32-x64.gz` `8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77`: FFmpeg 6.1.1 gyan.dev essentials, GPLv3

  These hashes are **observed** (trust on first use over HTTPS from github.com). They are not vouched for by the publisher.
- ESLint probe (`npx eslint --stdin --stdin-filename src/main/probe.ts`): `import { exec } from 'child_process'` is flagged; `import { exec } from 'node:child_process'`, `import cp from 'child_process'; cp.execSync()` and `spawn(..., { shell: true })` are **not** flagged (also not in `src/engine/**`).
- Electron 45.0.0 `electron.d.ts`: webPreferences defaults (contextIsolation true, sandbox true since 20, nodeIntegration false, webSecurity true, navigateOnDragDrop false, webviewTag false); utilityProcess `ForkOptions` (no sandbox option; `env` defaults to `process.env`).
- `objdump -p` on the win32 onnxruntime DLLs (imports listed above).

## 13. Sources (web) [W]

- pdf.js CVE-2024-4367 / GHSA-wgrm-67xf-hhpq, fixed in pdfjs-dist 4.2.67: https://github.com/advisories/GHSA-wgrm-67xf-hhpq
- uuid GHSA-w5hq-g745-h8pq (CVE-2026-41907): https://osv.dev/GHSA-w5hq-g745-h8pq
- sprintf-js unbounded precision DoS (the search did not confirm that the GHSA ID maps to this record): https://www.vulncheck.com/advisories/sprintf-js-through-1.1.3-denial-of-service-via-unbounded-precision
- BRIA RMBG-1.4 model card (non-commercial): https://huggingface.co/briaai/RMBG-1.4
- BiRefNet license (MIT, secondary mirror): https://huggingface.co/biali/BiRefNet/blob/main/README.md
- LGPL-3.0 text (§4 Combined Works): https://www.gnu.org/licenses/lgpl-3.0.html
- sharp / sharp-libvips license metadata: https://licenses.dev/npm/sharp/0.35.4
- macOS Sequoia Gatekeeper change: https://www.cultofmac.com/864843/macos-sequoia-removes-handy-shortcut-bypass-gatekeeper-security/
- GitHub Actions SHA pinning: https://github.blog/changelog/2025-08-15-github-actions-policy-now-supports-blocking-and-sha-pinning-actions/
- Electron IPC sender validation (docs commit mirror; electronjs.org itself was unreachable from this container): https://ayakael.net/mirrors/electron/commit/800b96fe142446faa08aa0d380e71e3bea79b12f
- macOS event tap permissions (developer forum, anecdotal): https://developer.apple.com/forums/thread/828052
- Electron release schedule (third-party; official page not reachable): https://endoflife.ai/article-electron-42-eol
