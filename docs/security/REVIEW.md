# Security review of develop: final (phase 3b)

Owner: Security analyst. Reviewed commit: **`develop@c2c4bfa`** ("Merge branch 'fix/platform-p3' into develop").
Date: 2026-10-21. Branch of this document: `security/final`. The phase-2 review (`develop@a6c0d94`, findings
F-15..F-22, the S3 answers and the recommended configuration) is in git history: `git show c23aad7:docs/security/REVIEW.md`.

Requirements: [CHECKLIST.md](CHECKLIST.md) (`SEC-xx`). Threat context: [THREAT_MODEL.md](THREAT_MODEL.md).
TPM decisions: `docs/TPM_DECISIONS.md` (D1-D18).

## 0. Verdict

**Private test build (product owner, macOS + Windows, tomorrow): OK.**

- Every MUST item that protects the person running the build is met: hardened windows, strict IPC with a
  per-page allowlist, no remote content, E2E hooks and every `LUD_*` override are inert in packaged builds,
  Electron fuses (incl. ASAR integrity) are on, ffmpeg is pinned and licence-gated, every parser has limits,
  outputs never overwrite. All phase-2 High/Medium findings (F-15..F-21) are closed and re-verified by probes
  on a packaged build (section 1).
- What is still open is either (a) a same-user local attacker issue (F-23: `--remote-debugging-port`),
  which is out of scope for a one-person test on the owner's own machine, (b) privacy/polish (F-24: one
  Chromium spell-check dictionary request to Google per launch on Linux, probably Windows), (c) a
  defence-in-depth gap whose second layer holds (F-25), or (d) licensing/distribution work that only
  matters when the app is published (R-1 Corresponding Source and friends).
- Caveat: the repository is **public**, so the CI artifacts of this "private" build can be downloaded by any
  signed-in GitHub user for 30 days (`package.yml:103` `retention-days: 30`) **[from GitHub's documented
  behaviour; not tested]**. That is distribution in the GPL sense. Acceptable for one night if the TPM agrees,
  but do not post links to the run; lower the retention or delete the artifacts after the test.

**Public / viral release: NOT OK yet.** See the blocker list in section 2.

## 1. How this review was done (all on `c2c4bfa`, Linux x64 container, Node 22.22)

| Step | Command / probe | Result |
|---|---|---|
| Install | `npm ci` (+ `node node_modules/electron/install.js`) | ok |
| Static gates | `npm run typecheck`, `npm run lint`, `npx vitest run` | clean, clean, **440 passed / 3 skipped** |
| Grep gates (CHECKLIST §J) | `shell: true`, `exec`/`execSync`, `openPath`, `openExternal`, HTML sinks, network APIs, telemetry, `no-sandbox` over `src/` | none (the only `fetch` outside the model downloader is pdf.js loading its own data inside the `lud-sandbox://pdf` window, `pdf-render-plan.ts:100`) |
| Audit | `npm audit --omit=dev` / `npm audit` | 5 / 12 moderate, unchanged since phase 1 (sprintf-js via mammoth→argparse, uuid via exceljs; not reachable, THREAT_MODEL §9.1) |
| Packaged build | `node scripts/fetch-ffmpeg.mjs linux x64`; `npm run build`; `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --linux dir --x64 --publish never -c.directories.output=<scratch>` | ok, 507 MB unpacked |
| Fuses | `npx @electron/fuses read --app <scratch>/linux-unpacked/let-us-drag` | RunAsNode **Disabled**, CookieEncryption Enabled, NodeOptions **Disabled**, NodeCliInspect **Disabled**, EmbeddedAsarIntegrityValidation **Enabled**, OnlyLoadAppFromAsar **Enabled**, GrantFileProtocolExtraPrivileges Enabled (waived, see SEC-17). Identical in CI for mac-arm64, mac-x64, win-x64 (Package run 39686581984 on `c2c4bfa`, all 4 jobs green, smoke-start booted on every OS). |
| Probes on the packaged app (each under `xvfb-run`, fresh `--user-data-dir`) | `LUD_E2E=1 LUD_E2E_ENGINE_WORKER=/abs/evil.cjs` | **PASS**: marker not written, no "e2e hooks installed" |
| | `LUD_FFMPEG_PATH`, `LUD_MODEL_PATH`, `lud_ffmpeg_path` set; read `/proc/<engine pid>/environ` of the `node.mojom.NodeService` utility process | **PASS**: 0 `LUD_*` keys in the engine (the main process still has them, harmless) |
| | `ELECTRON_RENDERER_URL=http://127.0.0.1:<port>` + local HTTP server | **PASS**: 0 requests, bundled UI loaded |
| | `ELECTRON_RUN_AS_NODE=1 … -e "console.log(424242)"` | **PASS**: nothing printed |
| | `NODE_OPTIONS="--require <inject.cjs>"` (main and engine) | **PASS**: not loaded |
| | `--inspect=0`, `--inspect-brk=0` | **PASS**: no debugger |
| | `--renderer-cmd-prefix`, `--utility-cmd-prefix`, `--gpu-launcher` with a marker-writing wrapper | **PASS** on Linux: wrapper never executed |
| | `--remote-debugging-port=0` | **FAIL (F-23)**: DevTools endpoint opens; over CDP an outside process evaluated `window.lud.*` in the overlay page and ran `to-jpg`, `to-mp3`, `to-html`, `to-pdf`, `pdf-to-png` jobs through the privileged IPC |
| | Logging proxy (`--proxy-server=http://127.0.0.1:<port>`), 60 s idle | **FAIL (F-24)**: one `CONNECT redirector.gvt1.com:443` at t=0.4 s; profile gets `Dictionaries/` and `Preferences` `{"spellcheck":{"dictionaries":["en-US"]}}` |
| Asar listing | `npx @electron/asar list` / `extract` | no source maps, no app sources/tests/docs; `out/main/chunks/test-hooks-*.js` ships but is only `import()`ed when E2E (dead code); leftovers: `@types/*`, `matcher`, `serialize-error`, `type-fest` (global-agent deps), `zod/src/**` tests (Info) |
| Packaged engine smoke (via the F-23 channel) | png→jpg, wav→mp3, md→html, md→pdf (printToPDF), pdf→png (pdf.js window) | all **done**; md→html output carries the CSP meta |
| Sanitizer | 30 classic payloads through `sanitizeHtml` (`src/engine/tools/html.ts`, copied to scratch), then the output rendered in Electron 45 | 1 real bypass (F-25), neutralised by the CSP meta |
| ffmpeg gate | `scripts/fetch-ffmpeg.mjs:87-99` logic against an unrunnable file and a missing file | gate prints "ok" (F-26) |
| ffmpeg extras | `sha256sum resources/bin/linux-x64/*` | LICENSE `8ceb4b9e…`, README `72f4b1b0…`: same as the phase-2 TOFU values, still not pinned (F-27) |
| macOS FFmpeg provenance | GitLab API on `gitlab.com/martinr92/ffmpeg` | public scripts pin FFmpeg 7.1 (`main`, 2025-01-17) / 7.1.1 (`develop`, 2025-05-13), not the shipped 9.0.2 (F-28) |
| CI evidence | `gh run view 39686581984`, check-run annotations of each job | macOS: ad-hoc signature, `codesign --verify` OK, ffmpeg 9.0.2 SHA-256 verified, licence gate ok, encoders present, QA packaging checks 15/15; Windows 16/16 |

Not done here (cannot be done from Linux): running the Windows/macOS packages, `codesign`/Gatekeeper
behaviour on a real Mac, the Accessibility flow (plan U7), MotW/quarantine behaviour.

## 2. Public release blockers (fine for tonight's private build, must be done before a public launch)

1. **R-1 Corresponding Source** for every GPL/LGPL binary (FFmpeg + all linked libraries + build scripts on
   all 3 platforms; libvips stack; libheif/libde265; libuiohook) attached to the same release. For macOS the
   builder's public scripts do not match the shipped build (F-28): get the exact sources from the author /
   build server, or build FFmpeg in CI from pinned tarballs. Also stop publishing installers as public CI
   artifacts before this is in place. (Product owner + TPM)
2. **Code signing + notarization.** macOS: Developer ID, hardened runtime, notarization (ad-hoc today; users
   must use "Open Anyway", and native code in `app.asar.unpacked` is outside the ASAR integrity check, F-30).
   Windows: Authenticode certificate (SmartScreen). (Product owner + TPM)
3. **F-23** Refuse Chromium remote-debugging switches in packaged builds. (Platform)
4. **F-24** Disable the spell checker so the app makes no network request at launch ("100% local" claim,
   SEC-150). (Platform)
5. **SEC-105 / MotW**: extracted files must keep the Mark-of-the-Web (Windows) and quarantine (macOS) of a
   downloaded zip, otherwise the Uncle becomes a SmartScreen/Gatekeeper bypass for malware in zips. (Engine)
6. **Licence decisions**: R-5 (`buffers@0.1.1` has no licence), R-6 (model mirroring; remove the unused
   `MODEL_MIRROR_URL` until decided), R-7 (DirectML DLLs: exclude or add terms), R-8 (codec patents, OpenH264
   built from source has no Cisco patent coverage). (Product owner + TPM)
7. **Docs (SEC-37/131/133/134)**: README must say what the global hook sees (all keyboard and mouse events
   pass through it; only modifier state + left button are used; nothing stored or sent), the macOS
   Gatekeeper/Accessibility steps, NSIS vs portable, and that there is no auto-update. `package.yml:122`
   release notes point at `docs/REPORT.md`, which does not exist. (TPM + Frontend)
8. **Supply-chain hygiene**: F-26 (licence gate fails open), F-27 (pin the extras), F-08 / SEC-146 (lint gate
   for `exec`/`shell: true`), Dependabot for actions; re-check Electron: 45.0.0 is the newest stable today
   (published 2026-10-21) but a `.0.0` major; take the latest 45.x patch at release. (TPM)
9. **F-25** Fix the sanitizer's SVG/MathML `<style>` bypass (CSP is the only layer left). (Engine)
10. Record the open waivers as TPM decisions: `grantFileProtocolExtraPrivileges` enabled (SEC-17), UNC paths
    accepted (SEC-14), DOCX external hyperlinks (SEC-83). (TPM)

## 3. Findings new in this review

| ID | Severity | Where | Finding | Exact repro | Fix | Owner | Blocks |
|---|---|---|---|---|---|---|---|
| F-23 | **Medium** | `src/main/index.ts` (no switch check); Electron default | The packaged app honours Chromium's `--remote-debugging-port` (and, by the same mechanism, `--remote-debugging-pipe`). No fuse covers it. A same-user process that (re)launches the app with it gets CDP access to our renderers, including the hidden overlay page, and can call every `window.lud` method: `startJob` on any file the user can read (outputs written next to it), `setSettings` (incl. `launchAtLogin`), `requestAccessibility`, `revealPath`. IPC trusts these calls because they come from our own page (SEC-11 cannot tell). No Node/native code execution was reached (renderers are sandboxed, `require`/`process` undefined), so the macOS Accessibility grant is not directly usable. The single-instance lock makes a second launch quit, so the attacker must first quit the running app. | `xvfb-run -a <pkg>/linux-unpacked/let-us-drag --no-sandbox --remote-debugging-port=39557` → `curl http://127.0.0.1:39557/json/list` lists `settings/index.html`, `overlay/index.html`; `Runtime.evaluate` of `window.lud.startJob({id:'x',optionId:'to-jpg',inputPaths:['/abs/pic.png']})` on the overlay target → job `done`, `pic.jpg` written (probe `cdp-convert.mjs`). macOS/Windows: same Electron behaviour **[unverified there]**. | In `index.ts`, before `requestSingleInstanceLock`: `if (app.isPackaged && ['remote-debugging-port','remote-debugging-pipe','remote-debugging-address','inspect','inspect-brk','inspect-port','js-flags'].some((s) => app.commandLine.hasSwitch(s))) app.exit(1)`; add a packaged-build probe to `scripts/ci-smoke-packaged.mjs` (launch with the switch, assert `/json/list` is unreachable). | Platform | public |
| F-24 | **Medium** (privacy; contradicts "100% local — nothing is uploaded" and SEC-150) | `src/main/security.ts:50-60` (`hardenSession` leaves the spell checker on; `spellcheck: false` in webPreferences does not stop the session-level dictionary download) | At every launch Chromium's spell checker downloads the `en-US` Hunspell dictionary from `redirector.gvt1.com` (Google). The `webRequest` filter of SEC-150 does not see this browser-process request. Reveals the user's IP and app usage to Google; fails on offline machines silently. macOS uses the system spell checker (no download expected); Windows **[unverified]**. | Logging proxy probe `netlog-proxy.mjs`: `xvfb-run -a <app> --no-sandbox --user-data-dir=<new> --proxy-server=http://127.0.0.1:<port>` → `CONNECT redirector.gvt1.com:443` within 0.5 s; `<userData>/Preferences` = `{"spellcheck":{"dictionaries":["en-US"]}}`, `<userData>/Dictionaries/` created. | In `hardenSession`: `ses.setSpellCheckerEnabled(false)`; `ses.setSpellCheckerLanguages?.([])` (not on macOS); optionally `ses.setSpellCheckerDictionaryDownloadURL('https://127.0.0.1:9/')`. Add the proxy probe to the packaged smoke test. | Platform | public |
| F-25 | Low (defence in depth; the CSP layer holds) | `src/engine/tools/html.ts` `sanitizeHtml` | `<svg><style><img src=x onerror="…"></style></svg>` passes the sanitizer unchanged. In SVG (foreign content) `<style>` is not a raw-text element, so the browser parses the `<img>` as a real element with its handler. With the CSP meta (as in every `.html` the engine writes, D17) the handler does not run; without it, it does (`document.title` changed). Also in the packaged app: `note.md` with this payload → `note.html` contains it verbatim + the CSP meta. htmlToPdf is safe anyway (JavaScript off). | `sanitizeHtml('<svg><style><img src=x onerror="document.title=\'PWNED7\'"></style></svg>')` → identical string; render with and without `RENDER_CSP` in Electron 45 → title `PWNED7` only without CSP. | Drop `<svg>` and `<math>` subtrees (simplest), or treat `<style>` inside foreign content as markup and sanitize it; add the payload (and the other 7 mXSS payloads of this review) to `tests/engine/document-text.test.ts`. | Engine | public |
| F-26 | Low | `scripts/fetch-ffmpeg.mjs:87-99` | The licence gate fails **open**: if the binary cannot run (ENOENT, exit 127, wrong arch), stdout is empty, the nonfree regex does not match and the script prints "licence gate: ok (see -L)". In CI the next step (`package.yml:40-50`) runs the binary under `bash -e` and would fail, so no nonfree build can ship today; the script alone is not trustworthy. | Same logic against a non-executable file: `spawn error: undefined status: 127 → GATE: ok (see -L)`; missing file: `ENOENT → GATE: ok`. | Throw unless `lic.status === 0 && conf.status === 0`, and require a positive match (`/GNU General Public License/` and `/version 3/`, and `--enable-version3` in `-buildconf`). | TPM | public |
| F-27 | Low (F-02 residual, SEC-140) | `scripts/fetch-ffmpeg.mjs:77`, `scripts/ffmpeg-sources.json` `extras` | `FFMPEG-LICENSE.txt` / `FFMPEG-README.txt` (Linux, Windows) are downloaded and shipped without a hash. | `node scripts/fetch-ffmpeg.mjs linux x64` → extras written, no hash check (`sha256sum`: `8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903`, `72f4b1b06d419d22ace6e7cc75f06826f90737345aa0b1736158929f4aacc537`; Windows README `a636a718…` from phase 2). | `extras: { name: { url, sha256 } }`, verified like the binary. | TPM | public |
| F-28 | Info (licence) | `scripts/ffmpeg-sources.json` `sourceInfo` (darwin) | `sourceInfo` points to `gitlab.com/martinr92/ffmpeg` for "build scripts and library versions", but that repository pins FFmpeg 7.1/7.1.1 (last commits 2025-01-17 / 2025-05-13); the shipped binaries are 9.0.2 built in 2026. The exact library versions of our builds are only on the build server (blocked from this container). | GitLab API: `repository/files/version%2Fffmpeg/raw?ref=main` → `7.1`, `?ref=develop` → `7.1.1`. | See THIRD_PARTY_NOTICES §3.1 and R-1. | TPM + Product owner | public |
| F-29 | Info | `.github/workflows/package.yml:94-103` | Repository is public (`gh api repos/dev-wm-monsters/let-us-drag` → `visibility: public`), so CI installers are de facto public downloads for 30 days. | — | Keep test builds out of public CI artifacts (private repo, or `retention-days: 1`, or delete after the test). | TPM | public |
| F-30 | Info | `electron-builder.yml` (`asarUnpack`, `mac.identity: '-'`, `hardenedRuntime: false`) | Native code (`sharp`/libvips, `onnxruntime-node`, `uiohook-napi`, `libheif-js`) lives in `app.asar.unpacked`, which the ASAR integrity fuse does not cover; with ad-hoc signing nothing stops a same-user process from replacing it. Expected for v0.1. | — | Developer ID + hardened runtime + notarization (macOS), Authenticode (Windows). | TPM | public |

Phase-2 findings, re-verified on `c2c4bfa`: **F-15 closed** (`e2e-mode.ts:10-12`, `app.ts:129`, `:255-256`;
probe), **F-09 closed** (`app.ts:73`, `paths.ts:41`; probe), **F-16 closed** (`worker-env.ts:26-35`,
`app.ts:133`; `/proc` probe), **F-17 closed** (`text.ts:36-37`, `:78`, `:132`; tests
`document-text.test.ts:161`, `:204`; see F-25), **F-18 closed** (`image.ts:40-49`, `:132-136`), **F-19 closed**
(`model.ts:29-38`, `:76-84`, `:176-194`; D15 for the confirm), **F-20 closed** (`image.ts:66`, `ffmpeg.ts:197-227`;
test `qa-input-security.test.ts:264`), **F-21 closed** (`html-to-pdf.ts:120`, `:184`, `:198`), F-22 open as a
decision (Windows VC++ runtime → WASM fallback). Phase-1: F-01/F-03/F-04/F-05/F-06/F-07/F-10/F-11/F-13 closed
(F-13 except the 3 small `global-agent` deps), F-02 closed for binaries (F-27 residual), **F-08 open**, F-12 open
(R-7), F-14 accepted.

## 4. Final status per checklist ID

Status: **PASS**, **WAIVED (Dxx)** (accepted by a TPM decision), **FAIL** (with severity and what it blocks).
"Blocks" = `private` (tonight's test build), `public` (public launch) or `—`. Evidence is `file:line` on
`c2c4bfa`. No item blocks the private test build.

### A. Electron hardening

| ID | Status | Evidence | Blocks |
|---|---|---|---|
| SEC-01 | PASS | `src/main/security.ts:10-27` (security keys applied after the caller's extras); app windows `windows/common.ts:153-161`; htmlToPdf `html-to-pdf.ts:158-170`; PDF render `pdf-render.ts:135-147` | — |
| SEC-02 | PASS | `security.ts:13-25` incl. `nodeIntegrationInWorker/SubFrames`, `allowRunningInsecureContent`, `experimentalFeatures`, `navigateOnDragDrop`, `webviewTag`; helper windows use the same function; no `enableBlinkFeatures` | — |
| SEC-03 | PASS | `windows/common.ts:159` (`additionalArguments` only when `ctx.e2e && !isPackaged`); fixed preload path; `LUD_E2E` probe | — |
| SEC-04 | PASS | `src/preload/index.ts` exposes the `LudApi` keys (CDP dump in F-23); `onTest*` are no-ops unless `--lud-e2e` (`preload/index.ts:14`, `:46-48`) | — |
| SEC-05 | PASS | `security.ts:38-46` (`will-navigate`, `will-frame-navigate`, `will-redirect`, `will-attach-webview`, window.open deny), every webContents via `app.ts:87-90` | — |
| SEC-06 | PASS | `security.ts:51-60` (request/check/device handlers, `setDisplayMediaRequestHandler`, downloads), default session `app.ts:82` and every webContents' session `app.ts:89` | — |
| SEC-07 | PASS | `app.ts:73`, `paths.ts:41`; probe: 0 requests to the fake dev server | — |
| SEC-08 | PASS | grep: no HTML sinks in `src/renderer` (excluding `src/renderer/dev`, not shipped) | — |
| SEC-09 | PASS | `src/renderer/{feed,overlay,settings}/index.html:5`: `object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'`, no `unsafe-eval` | — |
| SEC-10 | PASS | no `createObjectURL`/`file:` previews in `src/renderer`; `img-src 'self' data: blob:` | — |
| SEC-11 | PASS | `ipc.ts:55-60`, `ipc-policy.ts:66-71` (own webContents, main frame, parsed page URL). Bypassable only through F-23 (CDP runs inside our own page) | — |
| SEC-12 | PASS | `ipc-policy.ts:31-45` per-page allowlist | — |
| SEC-13 | PASS | `ipc-validation.ts:9-38` (≤ 500 paths, ≤ 4096 chars, strict schemas), `ipc-validation.ts:13` job id; tests in `tests/unit/platform` | — |
| SEC-14 | PASS | `ipc-validation.ts:19-36` rejects `\\.\` / `\\?\` (both slash styles); UNC accepted as a documented decision in code (`:21-23`), not yet in TPM_DECISIONS | public (record decision) |
| SEC-15 | PASS | `ipc.ts:96-99` (`registry.isRevealable` + `showItemInFolder`); no `openPath` | — |
| SEC-16 | PASS | no `openExternal` | — |
| SEC-17 | PASS (+ waiver without decision ID) | `electron-builder.yml` `electronFuses` (6 fuses as required); fuses read locally and in CI on all 4 targets; probes (RUN_AS_NODE, NODE_OPTIONS, --inspect). `grantFileProtocolExtraPrivileges` stays enabled: waived in a comment only (pages load from `file://`) | public (TPM to record the waiver) |
| SEC-18 | PASS | `e2e-mode.ts:10-12`, `index.ts:10`, `app.ts:255-256` (dynamic import); probe | — |
| SEC-19 | PASS | `windows/common.ts:160`; helper windows `devTools: false` | — |

### B. Global hook, overlay, privacy

| ID | Status | Evidence | Blocks |
|---|---|---|---|
| SEC-30 | PASS | uiohook only in `platform/trigger.ts`; no fs there; logger silent when packaged unless `LUD_DEBUG=1` (`index.ts:11`) | — |
| SEC-31 | PASS | only arm/disarm leave the trigger; cursor from `screen.getCursorScreenPoint()` | — |
| SEC-32 | PASS | abstract inputs `trigger-logic.ts:34-42`; key codes mapped to a modifier at the adapter and dropped otherwise (`trigger.ts:66-67`, `:126`) | — |
| SEC-33 | PASS | no `console.*` in `src/main/platform` | — |
| SEC-34 | PASS | start only when permitted (`gesture.ts`), stop on pause/quit, revocation poll every 5 s on macOS (`app.ts:287-294`) | — |
| SEC-35 | PASS | unchanged from phase 2 (non-blocking TSFN, pure reducer) | — |
| SEC-36 | WAIVED (D16) | click-through impossible for an OS drop target (D16); hide on lock/suspend `app.ts:279-286`; `focusable: false`, `showInactive`, level `screen-saver` | — |
| SEC-37 | FAIL (Low) | onboarding: "Everything happens on your computer. Nothing is uploaded." (`settings/App.tsx:116`) and the macOS Accessibility text (`:149-152`); nothing on Windows/Linux about the hook seeing all input; README has one line and no hook description. "Nothing is uploaded" is true for user data but see F-24 | public |

### C. Engine generic

| ID | Status | Evidence | Blocks |
|---|---|---|---|
| SEC-40 | PASS | `src/engine/sniff.ts` (images, PDF, ZIP by magic bytes), ffmpeg demuxer whitelist for media (`ffmpeg.ts:197-200`) | — |
| SEC-41 | PASS | `src/engine/limits.ts` (all limits in one file) | — |
| SEC-42 | PASS | `engine-host.ts:10-13`, `:49` (`CANCEL_GRACE_MS`), `:220` (kill + restart) | — |
| SEC-43 | PASS | `registry.ts:26-37` (`!isFile()` → `INPUT_INVALID`) | — |
| SEC-44 | PASS | `errors.ts:64` (detail ≤ 4096), `limits.ts:70-71` | — |

### D. Formats

| ID | Status | Evidence | Blocks |
|---|---|---|---|
| SEC-50 | PASS | `tools/sharp-safe.ts:15-31` | — |
| SEC-51 | PASS | `sharp-safe.ts:38-45` (`safeSharp`); raw inputs `image.ts:136`, `removebg.ts:160-173`; PDF→JPG via `safeSharp` (`jobs.ts:153`, `:158`) | — |
| SEC-52 | PASS | `image.ts:40-49` (dimensions before decode), `:132-136` | — |
| SEC-60 | PASS | `ffmpeg.ts:139` | — |
| SEC-61 | PASS | `ffmpeg.ts:207`, `:223` (`-protocol_whitelist file`) | — |
| SEC-62 | PASS | `ffmpeg.ts:190-200`, `:224` (no image2/concat/hls) | — |
| SEC-63 | PASS | `image.ts:66` (forced `bmp_pipe`/`ico`), `file:` URLs `ffmpeg.ts:208-211`; test `tests/engine/qa-input-security.test.ts:264` | — |
| SEC-64 | PASS | own temp outputs + link commit (unchanged) | — |
| SEC-65 | PASS | `ffmpeg.ts:152-156` | — |
| SEC-70 | PASS | pdfjs-dist 6.4.299 | — |
| SEC-71 | PASS | `pdf.ts:133-142`, `:194-195`; render window `pdf-render-plan.ts:6-13`, `:103-113` | — |
| SEC-72 | FAIL (SHOULD, Low) | per-file cap (`limits.ts:18`) and job timeout, no total cap for merges (500 inputs) | — |
| SEC-80 | PASS | mammoth `externalFileAccess: false`, 1.13.0 | — |
| SEC-81 | PASS | `text.ts:36-37`, `:78`, `:132`; packaged probe; see F-25 | — |
| SEC-82 | PASS | `html-to-pdf.ts:120-200` (custom scheme, JS off, request filter, 64 MB cap, timeout, window destroyed per job) | — |
| SEC-83 | PASS | links become `ExternalHyperlink`, no images; decision not recorded by TPM | public (record decision) |
| SEC-90 | PASS | `data.ts:166`, `limits.ts:62-64` | — |
| SEC-91 | PASS | `data.ts:118`, `text.ts:105` (`scanZipContainer`) | — |
| SEC-92 | FAIL (SHOULD, Low) | XLSX formulas are read as `null`/results (`data.ts:105`), but the behaviour (CSV/XLSX formula injection when opening outputs) is not documented | public (docs) |

### E. Archives and outputs

| ID | Status | Evidence | Blocks |
|---|---|---|---|
| SEC-100 | PASS | `archive.ts:144` (`lazyEntries`, `decodeStrings`, `validateEntrySizes`, `strictFileNames: true`) | — |
| SEC-101 | PASS | `archive.ts:42-61` (reserved names, control chars, 255 bytes), `:105` (case-insensitive duplicates) | — |
| SEC-102 | PASS | `archive.ts:80` symlink detection, fixed modes | — |
| SEC-103 | PASS | `limits.ts:41-48`; `archive.ts:91-93` (ratio), `:131` (free disk), `:149` (entries) | — |
| SEC-104 | PASS | `output.ts:144-180` (`commitDir`: reserve with mkdir, rename onto own empty dir) | — |
| SEC-105 | FAIL (SHOULD, Medium for public) | no MotW/quarantine propagation in `src/engine` | public |
| SEC-106 | PASS | `limits.ts:51-52`, `archive.ts` lstat/skip links | — |
| SEC-110 | PASS | `output.ts:77-110` (`commitFile`, `link`, fallback `copyFile(COPYFILE_EXCL)`, no file rename) | — |
| SEC-111 | PASS | names from the input base name (`output.ts`) | — |
| SEC-112 | PASS | `OutputStager` cleanup; cancel test | — |
| SEC-113 | PASS | `OUTPUT_NOT_WRITABLE` (D8) | — |

### F. Model download

| ID | Status | Evidence | Blocks |
|---|---|---|---|
| SEC-120 | WAIVED (D15) for the explicit confirm; rest PASS | hint `shared/catalog.ts:82`, stage text `jobs.ts:73`; https + host allowlist + manual redirects + size cap + timeouts `model.ts:29-38`, `:76-84`, `:176-194` | — |
| SEC-121 | PASS | pinned SHA-256 `model.ts:47`, verified while streaming and on first use; `LUD_MODEL_PATH` stripped in packaged builds (probe) | — |
| SEC-122 | PASS (D10) | not redistributed; `MODEL_MIRROR_URL` (`model.ts:31`) unused today (404), must stay unpublished (R-6) | public (R-6) |
| SEC-123 | FAIL (SHOULD, Low) | no check for ONNX external-data initialisers | — |
| SEC-124 | FAIL (SHOULD, Low) | `electron-builder.yml` still ships `DirectML.dll`, `dxcompiler.dll`, `dxil.dll` on Windows (R-7) | public |

### G. Packaging

| ID | Status | Evidence | Blocks |
|---|---|---|---|
| SEC-130 | PASS | `asar: true`, no maps, QA packaging checks in CI (15/15, 16/16); leftovers are Info (section 1) | — |
| SEC-131 | FAIL (docs) | private test covered by `docs/qa/MANUAL_CHECKLIST.md:50` (Open Anyway, no Gatekeeper-off advice); no README/REPORT text for users | public |
| SEC-132 | PASS | no `--no-sandbox` outside tests/CI smoke | — |
| SEC-133 | FAIL (SHOULD, docs) | no NSIS-vs-portable advice for users | public |
| SEC-134 | FAIL (docs) | Electron 45.0.0 = newest stable today (npm, published 2026-10-21); README does not say there is no auto-update | public |

### H. Supply chain, CI, licensing

| ID | Status | Evidence | Blocks |
|---|---|---|---|
| SEC-140 | FAIL (Low, F-27) | binaries fail closed (`fetch-ffmpeg.mjs:20-21`, `:66-68`); extras unhashed (`:77`) | public |
| SEC-141 | PASS (with F-26) | gate `fetch-ffmpeg.mjs:84-99` on the matching runner for all 4 targets (CI annotations); fail-open edge F-26 is caught by the next CI step | public (F-26) |
| SEC-142 | PASS | `ci.yml:9-10`, `package.yml:10-11`, write only on `draft-release` (`package.yml:105-122`, no `npm ci`) | — |
| SEC-143 | PASS | `persist-credentials: false` on every checkout | — |
| SEC-144 | PASS (pins) | every `uses:` pinned to a 40-char SHA with a version comment; no `.github/dependabot.yml` (SHOULD) | — |
| SEC-145 | PASS | 5 moderate, unchanged, unreachable | — |
| SEC-146 | FAIL (Medium, F-08) | `eslint.config.js:10-28` unchanged: `node:child_process`, `shell: true` and member `exec` calls still pass lint (grep gates are clean today) | public |
| SEC-147 | FAIL (licence, partial) | THIRD_PARTY_NOTICES updated on this branch (npm list regenerated from the `c2c4bfa` package; macOS FFmpeg §3.1; R-3/R-4 done). Open: R-5, R-7, exact macOS library versions (F-28) | public |
| SEC-148 | FAIL (licence) | no Corresponding Source attached (R-1); libuiohook source now ships inside the app (`app.asar.unpacked/node_modules/uiohook-napi/{libuiohook,src}`) | public |
| SEC-149 | PASS | `onnxruntime-node/script`, `adm-zip`, `global-agent` excluded; `matcher`, `serialize-error`, `type-fest`, `@types/*` remain (Info) | — |

### I. Network and telemetry

| ID | Status | Evidence | Blocks |
|---|---|---|---|
| SEC-150 | FAIL (Medium, F-24) | renderer filter in place (`security.ts:73-96`, `app.ts:84`), but the spell-check dictionary request leaves the app at every launch | public |
| SEC-151 | PASS | our code: only `model.ts` downloads; F-24 is Chromium's own request | — |
| SEC-152 | PASS | no `crashReporter`, no analytics | — |

## 5. D11 ffmpeg supply chain as implemented

| Check | Result | Evidence |
|---|---|---|
| Pins fail closed | **Yes for binaries**: no 64-hex `sha256` → throw before download; mismatch → throw | `fetch-ffmpeg.mjs:20-21`, `:66-68` |
| Pins for extras | **No** (F-27) | `fetch-ffmpeg.mjs:77` |
| Licence gate | Rejects `--enable-nonfree` / "not legally redistributable" from `-L` + `-buildconf` when the binary runs on the runner; runs for all 4 targets (runner arch = target arch, `package.yml:20-23`). **Fails open** when the binary cannot run (F-26) | `fetch-ffmpeg.mjs:84-99`; CI annotations "licence gate: ok" ×4 |
| Required encoders | Checked in CI (`libx264 libvpx-vp9 libopus libmp3lame libvorbis aac flac pcm_s16le gif png mjpeg bmp`) and again by QA packaging checks | `package.yml:40-50`; PKG-02 |
| macOS build identity | FFmpeg 9.0.2 (Martin Riedl), arm64 `c8ed4c4e…`, x64 `7c6b4125…`, GPLv3 (`--enable-gpl --enable-version3`, no nonfree, no decklink) | CI run 39686581984 |
| Shipped next to the binary | Linux/Windows: `ffmpeg[.exe]`, `FFMPEG-LICENSE.txt` (GPLv3 text, unpinned), `FFMPEG-README.txt` (unpinned), `FFMPEG-SOURCE.txt`. macOS: `ffmpeg`, `FFMPEG-LICENSE.txt` generated from `ffmpeg -L` (`fetch-ffmpeg.mjs:88-95`), `FFMPEG-SOURCE.txt`. Full GPLv3/LGPLv3 texts in THIRD_PARTY_NOTICES Appendix B (`<resources>/THIRD_PARTY_NOTICES.md`) | local Linux package `resources/bin/`; CI PKG-06 |
| Corresponding Source | Not attached (R-1); macOS build scripts/versions not publicly matched (F-28) | THIRD_PARTY_NOTICES §3.1, §12 |

## 6. Owners (for the TPM)

- **Platform:** F-23, F-24 (+ packaged-build probes in `scripts/ci-smoke-packaged.mjs`).
- **Engine:** F-25, SEC-105 (MotW/quarantine), SEC-72, SEC-123, SEC-92 (docs), R-6 (`MODEL_MIRROR_URL`).
- **TPM:** F-26, F-27, F-08/SEC-146, F-29, F-30 (signing), R-7, Dependabot, record waivers (SEC-14/17/83),
  README/REPORT (SEC-37/131/133/134, with Frontend for the onboarding copy).
- **Product owner:** R-1 (with TPM), R-5, R-6, R-8, signing certificates.
