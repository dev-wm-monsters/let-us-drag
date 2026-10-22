# Main process (Platform)

Owner: Backend dev, Platform (docs/PLAN.md section 7). The preload lives in `src/preload/index.ts`.

| File | What it does |
|---|---|
| `index.ts` | Registers the `lud-sandbox:` scheme; a packaged build quits at once (exit 1) when started with a remote-debugging / inspector switch (TPM D22, F-23; `debug-switches.ts` is the pure check); single-instance lock, then `startApp()` (never overrides userData, TPM D5). Launching the app again opens Settings: `second-instance` on Windows/Linux, `activate` (LaunchServices "reopen") on macOS |
| `e2e-mode.ts` | Pure: E2E mode = `LUD_E2E=1` AND not packaged (TPM D12, SEC-18) |
| `app.ts` | Wiring: windows, tray, engine host, gesture, IPC, settings side effects, quit cleanup |
| `paths.ts` | Pure: renderer page / preload / worker / resources / tray icon paths; `rendererPageOf()` (which of our pages a URL is); dev server URL ignored when packaged (F-09) |
| `security.ts` | Secure `webPreferences` (callers cannot weaken them), navigation / window.open / webview blocking for every webContents, deny-all permission / display-capture / download handlers, remote-request blocking for the app session (SEC-150), including `file:` URLs that name a server (Windows UNC → SMB/NTLM); spell checker off on every session and `spellcheck: false` in every window, so no Hunspell dictionary is downloaded (TPM D22, F-24: no network request at launch) |
| `windows/overlay.ts` | Overlay window + sensor/engage flow (PLAN §3.5); `overlay-session.ts` is the pure state machine + safety timeouts; `overlay-geometry.ts` is the pure placement math |
| `windows/feed.ts`, `windows/settings.ts` | Single-instance Feed and Settings windows (`singleton.ts`) |
| `platform/trigger-logic.ts` | Pure trigger state machine (drag + key); `trigger.ts` adapts uiohook-napi; `gesture.ts` owns start/stop/pause + `PlatformStatus`; `gesture-env.ts` is the pure "may the hook start?" decision; `permissions.ts` handles macOS Accessibility |
| `engine-host.ts` | Host side of `src/engine/api.ts` (init + `hostAdapters`, queueing until ready, crash → INTERNAL + bounded restart, watchdog: kill + restart when a cancelled job is still running after 5 s or a job runs past 32 min) |
| `html-to-pdf.ts` | `htmlToPdf` adapter: a hidden, JS-less, sandboxed window without preload in an in-memory session; the document is served from memory on `lud-sandbox://print/<uuid>.html` (never `file://`); every other request is cancelled; CSP injected by `pdf-csp.ts`; 64 MB cap; 30 s timeout; window destroyed after each job (SEC-82) |
| `pdf-render.ts`, `pdf-render-plan.ts` | `renderPdfPages` adapter: pdf.js in one hidden, sandboxed window without preload, in an in-memory session that serves only pdf.js files + the current PDF on `lud-sandbox://pdf/`. See below. |
| `worker-env.ts` | Pure: environment for the engine utilityProcess. Packaged: every `LUD_*` key removed, case-insensitively (F-16, TPM D18), so `LUD_FFMPEG_PATH` / `LUD_MODEL_PATH` only work in unpackaged runs. Unpackaged: inherit `process.env` |
| `sandbox-protocol.ts` | Pure helpers for the `lud-sandbox:` scheme used by the two helper windows; served file names must be plain, portable names (no Windows device names such as `COM1.bcmap`, no `:` streams, no trailing dot) |
| `ipc.ts`, `ipc-validation.ts`, `ipc-policy.ts` | All `ipcMain.handle` handlers; strict zod payloads; sender must be the main frame of one of our windows, still showing the page main loaded into it, and that page must be on the channel's allowlist (`IPC_ALLOWLIST`) |
| `settings-store.ts` | Settings JSON in userData, validated field by field, atomic writes (the rename is retried briefly on EPERM/EACCES/EBUSY, which Windows reports while antivirus or indexers hold the file) |
| `autostart.ts` | Linux XDG autostart entry; `loginItemSettings()` builds the macOS/Windows `app.setLoginItemSettings` argument (Windows portable exe; electron.exe + project dir in development) |
| `job-registry.ts` | Paths produced by finished jobs (only those can be revealed) + recorded events for E2E |
| `test-hooks.ts` | `globalThis.__ludTest` (E2E only; loaded with a dynamic import) |

## Overlay lifecycle

1. Trigger arms. The overlay is placed under the cursor (560x560, clamped to that display's work area),
   shown with `showInactive()`, and the renderer gets `overlayArm`. While the renderer has not
   reported engagement, the window follows the cursor at about 60 Hz.
2. The renderer sees a `dragenter` carrying `Files` and calls `lud.overlayEngaged()`. Main stops
   following. Starting a job from the overlay also counts as engaged.
3. The mouse is released. The renderer gets `overlayDisarm`. This is sent for every release after an
   arm, including one that follows a successful drop, so the renderer must ignore it in that case.
4. The renderer calls `lud.overlayDone()` when its leave animation ends, and main hides the window.

A new trigger arm is ignored only while the sensor is already armed or while a job started from the
overlay is running (one Uncle at a time). Over a result/error card, the leave animation or feedMe it
re-arms at the new cursor and the renderer dismisses what it showed (TPM D21).

Mouse and focus (TPM D20):

- During arm/sensor/engaged drag the overlay is a normal drop target (D16). Main forces this on
  every arm and resets it when the overlay hides.
- After the drop the renderer calls `lud.setOverlayClickThrough(true)`: main calls
  `setIgnoreMouseEvents(true, { forward: true })`, clicks go to the windows below, mouse moves are
  still forwarded, so the renderer sees the pointer enter the cancel button / a card and calls
  `setOverlayClickThrough(false)` there. Requests while hidden or armed are ignored (a late request
  from the previous card cannot turn the new sensor off).
- **Linux:** `forward` exists only on macOS and Windows, so the renderer could never see the pointer
  enter a button again. Main ignores `setOverlayClickThrough` on Linux: the overlay stays clickable
  (QA3-06 remains on Linux; the gesture is X11-only there anyway).
- Focus: only `lud.setOverlayInteractive(true)` (feedMe) makes the window focusable and focuses it.
  Cards and the cancel button work without focus; on macOS the window has `acceptFirstMouse` so the
  first click on an inactive overlay reaches the page.

Safety timeouts (`overlay-session.ts`) make sure the overlay can never stay on screen:

| Situation | Timeout | Action |
|---|---|---|
| Armed but never engaged | 15 s | Disarm |
| Released, no job running | 10 s | Hide |
| Engaged or interactive, idle | 60 s | Hide |
| Job from the overlay running | none | — |

Every state change (arm, engage, disarm, interactive on/off, job start/finish) restarts the timer.

While the overlay is visible, the `cursor` channel carries the cursor position in overlay-window
coordinates (CSS px), only when it changes, at most about 60 Hz.

## E2E design (LUD_E2E=1, unpackaged only)

- E2E mode = `LUD_E2E=1` AND `!app.isPackaged` (`e2e-mode.ts`). A packaged build ignores `LUD_E2E`
  completely: no `__ludTest`, no `--lud-e2e` renderer flag, no env overrides. QA runs E2E against
  the unpackaged build (`electron .`), so this costs nothing.
- In E2E mode `globalThis.__ludTest` is installed at the end of startup (after the windows, engine
  and IPC exist; the hooks await the overlay page themselves). The input hook (uiohook) is never
  started. First-run onboarding is skipped so boots are deterministic.
- The test channels are sent only by `__ludTest`: `TEST_DROP_CHANNEL` (overlay, `dropFiles`),
  `TEST_FEED_DROP_CHANNEL` (Feed Window, `dropFilesOnFeed`, opens the window first) and
  `TEST_CANCEL_CHANNEL` (overlay + Feed Window, `cancelActive`). The preload subscribes to them
  (`onTestDrop`, `onTestFeedDrop`, `onTestCancel`) only when main started the renderer with
  `--lud-e2e`; otherwise they are no-ops. The renderer decides what a drop/cancel means, so the
  hooks exercise the same code path as the real UI.
- `userData` is isolated with the Chromium switch `--user-data-dir=<dir>` (main never calls
  `app.setPath('userData')`, TPM D5).
- Optional, E2E only: `LUD_E2E_ENGINE_WORKER=/abs/file.cjs` swaps in a fake engine worker
  (see `tests/unit/platform/smoke/fake-engine-worker.cjs`).
- Smoke tests against the built app:
  - `npm run build && xvfb-run -a node tests/unit/platform/smoke/electron-smoke.mjs` (fake engine:
    windows, IPC policy, hooks, htmlToPdf, crash/restart, hardened webPreferences);
  - `npm run build && xvfb-run -a node tests/unit/platform/smoke/feed-drop-smoke.mjs` (B-055:
    `dropFilesOnFeed` opens the Feed Window itself and resolves; real engine);
  - `npm run build && LUD_FFMPEG_PATH=/usr/bin/ffmpeg xvfb-run -a node tests/unit/platform/smoke/pdf-render-smoke.mjs`
    (real engine: PDF → PNG/JPG through `renderPdfPages`, huge/hostile/corrupt PDFs, SEC-82 HTML checks).

## Hidden helper windows (htmlToPdf, renderPdfPages)

Both render untrusted content, so both use the same pattern:

- `secureWebPreferences()` (sandbox, context isolation, no node), **no preload**, `devTools: false`,
  `show: false`, a dedicated non-persistent session (`lud-html-to-pdf`, `lud-pdf-render`) with
  deny-all permissions/downloads.
- Content comes from main through the session's own `lud-sandbox:` protocol handler (registered as
  privileged in `index.ts`): only the URLs main decides to serve exist. The session's webRequest
  filter cancels everything else (http(s), ws, `file://`, other hosts).
- Navigation, new windows and `<webview>` are blocked (`web-contents-created`).

`renderPdfPages` specifics: JavaScript is on (pdf.js needs it), but the only scripts are pdf.js
(`node_modules/pdfjs-dist/build/pdf.mjs` + `pdf.worker.mjs`, read by main, also from app.asar) and a
tiny page script; CSP `script-src 'self' 'wasm-unsafe-eval'` (no eval; pdf.js 6 has no eval path,
`isEvalSupported: false` is still passed). pdf.js runs with `enableXfa: false`,
`useSystemFonts: false`, local cmaps/standard fonts/wasm, `maxImageSize` 100 MP; only
`page.render()` is used (no annotation/scripting layer). Main drives it page by page with
`executeJavaScript` (open → size → render), computes each page's scale with the engine's
`PdfRenderOptions` (scale, maxSide, maxPixels; clamped again by main), and validates every result
(PNG magic, ≤ 1000 pages, ≤ 1 GB total). Jobs are serialized, one window is reused and closed after
60 s idle; a job times out after 4 min (the engine waits 5); on timeout, cancel (engine worker gone)
or renderer crash the window is destroyed and the next job gets a fresh one.

## Engine watchdog

Synchronous parsers in the engine cannot be interrupted, so `engine-host.ts` watches each job:

| Situation | Action |
|---|---|
| `cancel` sent, no `done`/`error` from the worker within 5 s | kill the utilityProcess, start a new one at once |
| a job runs > 32 min after its first `progress` (engine's own limit is 30 min) | same |
| a job waits inside the worker > 32 min without any message from the worker | same |

On such a kill every in-flight job gets an `error`: `CANCELLED` for jobs the user cancelled,
`INTERNAL` ("This took too long…") for the job that timed out, `INTERNAL` ("The converter had to
restart…") for the others. Deliberate kills do not count towards the crash-restart budget.

## Privacy of the input hook (SEC-30..37)

- `trigger.ts` is the only file that touches uiohook. The trigger is derived from the modifier mask
  on mouse events + left-button state + movement distance. A key listener maps the 8 modifier key
  codes to an abstract `{ key, held }` event and returns at once for every other key.
- `trigger-logic.ts` only sees abstract events (`down/up/move` with modifier flags, `modifier`).
- No hook data is stored, logged, sent over IPC or the network. Arm/disarm side effects run
  outside the hook callback (`setImmediate`).
- The hook runs only when the gesture is available and not paused; it is stopped on pause, on quit,
  and when macOS Accessibility is revoked (checked every 5 s while the hook runs).
- The overlay is hidden on `lock-screen` and `suspend`.

## Launch at login

- macOS / Windows: `app.setLoginItemSettings({ openAtLogin })`. For the Windows portable build,
  the path comes from `PORTABLE_EXECUTABLE_FILE`, which electron-builder's portable stub sets.
- Linux: writes or removes `$XDG_CONFIG_HOME/autostart/let-us-drag.desktop` (default `~/.config`).
  Limitations:
  - It only works on desktops that implement XDG Autostart.
  - For an AppImage it points at `$APPIMAGE`. If the AppImage is moved, the entry goes stale;
    turning the setting off and on again rewrites it.

## Packaging needs (electron-builder.yml, owned by the TPM)

`resources/` is the buildResources directory and is not shipped by default. The tray icons and the
fallback icon must be copied next to the app (`process.resourcesPath`):

```yaml
extraResources:
  - from: resources/tray
    to: tray
  - from: resources/icon.png
    to: icon.png
```
