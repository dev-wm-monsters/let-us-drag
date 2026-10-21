# The Uncle — art & visual QA

![eat → chew → spit](uncle-eat-chew-spit.gif)

The Uncle is code, not image files: a layered inline SVG (`src/renderer/common/uncle/UncleSvg.tsx`)
animated every frame by a small pure "brain" (`pose.ts` → `attrs.ts`). Screenshots of every state
live in [`screens/`](screens/).

## Regenerating art

| What | Command | Output |
|---|---|---|
| App icon + tray icons | `node src/renderer/dev/render-art.mjs icons` | `resources/icon.png` (1024²), `resources/tray/trayTemplate.png` (16², black+alpha), `trayTemplate@2x.png` (32²), `tray.png` (32², colour) |
| Static poses (art review) | `node src/renderer/dev/render-art.mjs poses <dir>` | `<dir>/pose-<mood>.png/.svg` + `sheet.png` |
| Screenshots of every state + GIF | `node src/renderer/dev/capture.mjs [filter…]` | `docs/art/screens/*.png`, `docs/art/uncle-eat-chew-spit.gif` |
| Poke the UI by hand | `node src/renderer/dev/serve.mjs` | prints harness URLs |

All of these use only installed packages (vite, @vitejs/plugin-react, react-dom/server, sharp,
playwright) plus `ffmpeg` for the GIF (`LUD_FFMPEG_PATH` or PATH).

## How the visual harness works

1. `src/renderer/dev/vite-dev.mjs` starts a programmatic Vite dev server rooted at `src/renderer`.
2. `dev/harness.html?view=overlay|feed|settings` loads `dev/harness.tsx`, which installs an in-memory
   `window.lud` (`dev/mock-lud.ts`, implements the full `LudApi`) and then imports the **real**
   window entry (`overlay/main.tsx`, `feed/main.tsx` or `settings/main.tsx`).
3. Query parameters: `plain=1`, `hungry=1`, `sounds=1`, `firstRun=1`, `jobs=auto|manual`,
   `platform=darwin|win32|linux`, `reason=wayland|mac-permission|hook-failed`.
4. `window.__harness` drives it (from Playwright `page.evaluate` or DevTools):
   - `drag('dragenter'|'dragover'|'drop'|'dragleave', x, y, [{ name, type }])` dispatches a real
     `DragEvent` with a `DataTransfer` holding `File`s → exercises the same code path as an OS drag;
   - `optionPoint(optionId)`, `center()`, `state()` (= `data-uncle-state`), `key('Escape')`;
   - mock channels: `emitJobEvent(ev)`, `lastJobId()`, `arm()`, `disarm()`, `cursor({x,y})`,
     `testDrop({ paths, optionId })`, `changeSettings(patch)`; logs in `calls` / `jobs`.
   - mock paths: `pathsForFiles` → `/Users/demo/Desktop/<name>`; names containing `huge`/`big` are
     350 MB (struggle), names containing `broken` fail in `jobs=auto` mode.
5. `capture.mjs` launches Chromium (`LUD_CHROMIUM_PATH`, else the newest
   `$PLAYWRIGHT_BROWSERS_PATH/chromium-*/chrome-linux/chrome`; Playwright 1.64 expects a newer build
   than the preinstalled one, so the explicit path is required here), runs each scenario, asserts
   `data-uncle-state`, and saves palette PNGs. The GIF is recorded with the CDP screencast (real-time
   frames, re-timed to 20 fps) and encoded with ffmpeg (Playwright's own video recorder needs an
   ffmpeg build that is not installed here). Env: `LUD_SCREENS_DIR`, `LUD_GIF_PATH`.
