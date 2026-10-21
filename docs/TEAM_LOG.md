# Team log

Each agent appends: date, role, what was done, files touched, open issues.

## 2026-10-21 · Phase 0 · TPM (orchestrator)
- Market/tech research, project plan (docs/PLAN.md), shared contracts (src/shared/*, src/engine/api.ts), scaffold (Electron 45 + electron-vite + React), CI (Linux/macOS/Windows) and packaging workflow, ffmpeg fetch script, smoke tests.
- Verified environment facts used by the team (Electron under Xvfb, native prebuilds, network limits).

## 2026-10-21 · Phase 1 · Build (5 agents in parallel worktrees)
- **Backend · Engine** (feat/engine): full conversion engine for PLAN §5 (ffmpeg/sharp/heic/pdf.js/pdf-lib/mammoth/marked/docx/papaparse/js-yaml/exceljs/yazl/yauzl/ONNX Remove-BG with onnxruntime-node + wasm fallback), safe output naming, cancellation, utilityProcess worker. 152 tests (every option converts a real fixture), real ISNet model verified, Electron utilityProcess smoke 10/10. Found & fixed: @napi-rs/canvas crashes Electron (→ host PDF renderer adapter), pdf.js mis-detecting the utilityProcess as a browser, Remove-BG alpha-mask bug.
- **Backend · Platform** (feat/platform): main process + preload — tray, single instance, overlay window (sensor/engage), pure trigger state machine + uiohook adapter, macOS Accessibility flow, Wayland detection, feed/settings windows, settings store, engine host (utilityProcess + htmlToPdf via printToPDF), zod-validated IPC with sender checks, hardened windows, E2E hooks. 87 tests, smoke runs, real XTest gesture under Xvfb. Found & fixed: hang when quitting immediately after launch.
- **Frontend · Uncle & UI** (feat/frontend): the Uncle (layered SVG, cartoon style, mole, blinking/breathing, spring-smoothed eye + head tracking), overlay state machine (appear/hover/feedMe/eat/chew/hamster/struggle/spit/choke/refuse/leave), option ring, synthesized sounds, Plain/Hungry modes, Feed Window, Settings/onboarding, app + tray icons, visual harness with 29 screenshots + GIF. 66 renderer tests.
- **QA** (feat/qa-plan): TEST_PLAN.md (full case list + manual checklist), 40 Playwright `_electron` E2E specs, packaging artifact checker.
- **Security** (feat/security-model): THREAT_MODEL.md + CHECKLIST.md (SEC-xx), review of scaffold/CI/builder config, dependency audit + licence walk, ffmpeg binary licence analysis (found the nonfree darwin-arm64 build).

## 2026-10-21 · Integration · TPM
- Merged all 5 branches into develop; resolved the shared-API conflict (Platform and Frontend both added `overlayEngaged`/`onTestDrop`); fixed the renderer mock typing.
- Integrated result: typecheck ✓, lint ✓, 300 unit/engine tests ✓ (3 skipped), **39/39 E2E ✓** (1 skipped as root).
- Decisions recorded in docs/TPM_DECISIONS.md (D1–D14). Packaging: tray/icon resources, size trimmed 626 → 438 MB unpacked (Linux), Electron fuses on, React moved to build-time deps; packaged Linux app smoke-tested.

## 2026-10-21 · Phase 2 · Hardening (5 agents in parallel worktrees)
- **Backend · Platform** (fix/platform-p2): PDF page rendering host adapter (pdf.js in a hidden sandboxed window, custom protocol, own session, caps/timeouts), engine watchdog (kill/restart after cancel/timeout), full main/preload hardening (explicit webPreferences, global navigation/permission/webview denial, per-window IPC allowlist, strict zod), htmlToPdf from memory (no file://), E2E hooks only when unpackaged, hook privacy, new test hooks. 10 bugs fixed.
- **Backend · Engine** (fix/engine-p2): Security MUST items (sharp loader allowlist + pixel caps, ffmpeg protocol/format whitelists + `file:` inputs, YAML alias caps, strict unzip with ratio/size/entry caps and reserved names, OOXML zip-bomb pre-scan, race-free never-overwrite commits, FIFO rejection), model download per D10 with host allowlist, INPUT_INVALID error mapping, streaming image encode (no full in-memory loads). 10 bugs fixed.
- **Frontend · Uncle** (fix/frontend-p2): clearly visible head turn (±11° + parallax, eyes aimed through the head transform), signature mole with its hair, "Spit it out" cancel (button + Esc), feed/cancel test hooks, data-uncle-mood, stricter CSP, regenerated screenshots + README hero GIF + icon. 4 bugs fixed.
- **QA** (fix/qa-p2): 23 new E2E (real Chromium PDF/HTML adapters, media/data/archive, modes, moods, cancel, feed drops, htmlToPdf beacon tests), 7 engine security fixture suites, test plan v0.2, manual checklist v1.
- **Security** (fix/security-p2): complete THIRD_PARTY_NOTICES (248 packages + native libs + written offer), REVIEW.md per SEC id with packaged-build probes (found F-15 test-hook bypass in packaged builds, F-16 env overrides, F-17 HTML output), macOS permission analysis.

## 2026-10-21 · TPM (between phases)
- Replaced the nonfree macOS arm64 ffmpeg: probed candidates on real macOS runners, pinned Martin Riedl FFmpeg 9.0.2 GPL builds (arm64 + x64; licence/encoders/min-macOS 12/no non-system dylibs verified), fail-closed SHA-256 pins + licence gate for every platform.
- CI hardening (no persisted credentials, least privilege, actions pinned to verified SHAs), real Remove-BG model test on Linux CI, packaged-app smoke start + fuse read + QA artifact checks on every OS, ASAR-integrity fuses enabled after proving the packaged app boots on macOS arm64/x64, Windows and Linux.
- Decisions D15–D18.

## 2026-10-21 · Phase 3a · Fix round (2 agents)
- **Backend · Engine** (fix/engine-p3): Windows pdf.js asset paths (B-016/17), cross-drive test (B-018), sanitized HTML outputs (D17), FAT/exFAT save fallback and Windows folder-commit robustness.
- **Backend · Platform** (fix/platform-p3): LUD_* stripped from packaged engine env (D18), macOS re-launch opens Settings, Windows UNC/SMB request block, sandbox-protocol device-name guard, settings rename retry, dev autostart fix.
- Integrated: 440 unit/engine tests ✓, 62/62 E2E ✓ (Linux).
