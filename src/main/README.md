# Main process (Platform)

Owner: Backend dev, Platform (docs/PLAN.md section 7). The preload lives in `src/preload/index.ts`.

| File | What it does |
|---|---|
| `index.ts` | Single-instance lock, E2E userData override, then `startApp()` |
| `app.ts` | Wiring: windows, tray, engine host, gesture, IPC, settings side effects, quit cleanup |
| `paths.ts` | Pure: renderer page / preload / worker / resources / tray icon paths, trusted renderer URL check |
| `security.ts` | Secure `webPreferences`, navigation / window.open / webview blocking, deny-all permission handlers |
| `windows/overlay.ts` | Overlay window + sensor/engage flow (PLAN §3.5); `overlay-session.ts` is the pure state machine + safety timeouts; `overlay-geometry.ts` is the pure placement math |
| `windows/feed.ts`, `windows/settings.ts` | Single-instance Feed and Settings windows (`singleton.ts`) |
| `platform/trigger-logic.ts` | Pure trigger state machine (drag + key); `trigger.ts` adapts uiohook-napi; `gesture.ts` owns start/stop/pause + `PlatformStatus`; `gesture-env.ts` is the pure "may the hook start?" decision; `permissions.ts` handles macOS Accessibility |
| `engine-host.ts` | Host side of `src/engine/api.ts` (init, queueing until ready, crash → INTERNAL + bounded restart) |
| `html-to-pdf.ts` | `htmlToPdf` adapter: one hidden, JS-less, sandboxed window in an in-memory session. Requests are filtered and the CSP is injected by `pdf-csp.ts`. Jobs run one at a time with a 30 s timeout. |
| `ipc.ts`, `ipc-validation.ts` | All `ipcMain.handle` handlers; zod-validated payloads; sender must be one of our windows showing one of our pages |
| `settings-store.ts` | Settings JSON in userData, validated field by field, atomic writes |
| `autostart.ts` | Linux XDG autostart entry (macOS/Windows use `app.setLoginItemSettings`) |
| `job-registry.ts` | Paths produced by finished jobs (only those can be revealed) + recorded events for E2E |
| `test-hooks.ts` | `globalThis.__ludTest` (E2E only) |

## Overlay lifecycle

1. Trigger arms. The overlay is placed under the cursor (560x560, clamped to that display's work area),
   shown with `showInactive()`, and the renderer gets `overlayArm`. While the renderer has not
   reported engagement, the window follows the cursor at about 60 Hz.
2. The renderer sees a `dragenter` carrying `Files` and calls `lud.overlayEngaged()`. Main stops
   following. Starting a job from the overlay also counts as engaged.
3. The mouse is released. The renderer gets `overlayDisarm`. This is sent for every release after an
   arm, including one that follows a successful drop, so the renderer must ignore it in that case.
4. The renderer calls `lud.overlayDone()` when its leave animation ends, and main hides the window.

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

## E2E design (LUD_E2E=1)

- `globalThis.__ludTest` is installed only when `process.env.LUD_E2E === '1'`. The input hook
  (uiohook) is never started then. First-run onboarding is skipped so boots are deterministic.
- `TEST_DROP_CHANNEL` is sent only by `__ludTest.dropFiles`. The preload subscribes to it only when
  main started the renderer with the `--lud-e2e` argument, which main passes through
  `additionalArguments` only under `LUD_E2E=1`. In a normal run, `lud.onTestDrop()` is a no-op.
- Optional, E2E only:
  - `LUD_E2E_USER_DATA=/abs/dir` isolates `userData`.
  - `LUD_E2E_ENGINE_WORKER=/abs/file.cjs` swaps in a fake engine worker
    (see `tests/unit/platform/smoke/fake-engine-worker.cjs`).
- Smoke test against the built app: `npm run build && xvfb-run -a node tests/unit/platform/smoke/electron-smoke.mjs`.

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
