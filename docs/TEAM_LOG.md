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
