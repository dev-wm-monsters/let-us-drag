# TPM decisions (binding)

Answers to open questions raised by the team in phase 1. Owner: TPM.

| ID | Question (raised by) | Decision |
|---|---|---|
| D1 | hamster/struggle not assertable (QA Q-01) | Overlay root exposes `data-uncle-mood="hamster|struggle|none"` (keep `data-hamster`/`data-struggle`). |
| D2 | No hook to drop on the Feed Window (QA Q-25) | Add `dropFilesOnFeed(paths, optionId)` to `LudTestHooks` (Platform: main + E2E-only channel; Frontend: feed renderer handler). |
| D3 | Cancellation UI undefined (QA Q-17) | During chew a small cancel button on the progress ring (`data-testid="cancel-job"`, "Spit it out") + Esc when focused → `cancelJob`. Uncle spits the file back ("Fine, keep it.") and leaves. Engine emits `CANCELLED`, leaves no partial output. Add `cancelActive()` test hook (same code path). Main kills/restarts the worker if a cancelled job is still running after ~5 s. |
| D4 | Overlay lifecycle (QA Q-34) | Created hidden at boot, reused for every gesture. |
| D5 | userData override for E2E (QA Q-35) | `--user-data-dir=<dir>` is honoured (verified). Main must never call `app.setPath('userData')`. |
| D6 | Error code for undecodable input (QA Q-16) | `INPUT_INVALID` wherever detectable; `TOOL_FAILED` only for unexpected tool failures. Messages ≤ 200 chars, no stack traces. |
| D7 | Partial failure in `each` batches (QA Q-13) | All-or-nothing (no outputs committed if any input fails); the message names the failing file. |
| D8 | Unwritable output folder (QA Q-15) | Error `OUTPUT_NOT_WRITABLE`, no fallback location in v0.1. |
| D9 | `arm()` alone; `dropFiles(png, null)`; blocked + option | `arm()` keeps `data-uncle-state="hidden"` (sensor only). `dropFiles(known, null)` → `feedMe` with held files. Blocked inputs → `refuse` and no job, even if dropped on an option. |
| D10 | Remove-BG model source/licence (Engine U6) | Do NOT mirror the weights in our releases (licence of the pretrained weights is not stated upstream). The app downloads them on first use from the upstream rembg release, SHA-256 pinned (`60920e99…`), with a clear one-time-download stage message. Product owner decides about mirroring before public launch. |
| D11 | ffmpeg darwin-arm64 build is nonfree (Security F-01) | Replace it with a GPL (not nonfree) static build for darwin-arm64, resolved and verified in CI (licence check `-L`/`-buildconf` must not contain nonfree; required encoders present; SHA-256 pinned). Other platforms keep ffmpeg-static b6.1.1 with SHA-256 enforced. CI fails if any shipped ffmpeg reports nonfree. |
| D12 | `TEST_DROP_CHANNEL` / LUD_E2E in production (QA Q-31) | Test hooks are installed only when `LUD_E2E=1` AND `!app.isPackaged`. E2E runs against the unpackaged build. |
| D13 | Tray/icon resources in packaged builds (Platform) | electron-builder ships `resources/tray` → `<resources>/tray` and `resources/icon.png` → `<resources>/icon.png` (TPM). |
| D14 | Package size | TPM excludes unused platform binaries (onnxruntime other OS/arch, musl variants, @napi-rs/canvas which cannot run inside Electron, onnxruntime-web except where needed). |
