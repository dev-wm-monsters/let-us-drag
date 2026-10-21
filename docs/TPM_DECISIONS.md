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
| D15 | Explicit confirm before the 179 MB model download (Security SEC-120, Engine) | No modal confirm inside the drag overlay in v0.1 (it would interrupt the gesture). Instead: the Remove BG bubble hint says "First use downloads a 179 MB AI model (once)", the chew stage text says so while downloading, and cancel works during the download. Accepted deviation, recorded in docs/security/REVIEW.md. |
| D16 | SEC-36 click-through sensor (Platform) | WAIVED: the sensor must be an OS drop target (PLAN §3.5), which a click-through window is not. Mitigation: the sensor only exists while the trigger key is held during a mouse drag, is near-invisible, and hides on mouse-up, lock-screen and suspend. |
| D17 | F-17 MD/DOCX → HTML output | Sanitize the HTML output (same sanitizer as for PDF) and add the no-network/no-script CSP meta. Users get a safe, self-contained HTML file. |
| D18 | F-16 env overrides in packaged builds | When packaged, the engine worker is forked with an environment that has every `LUD_*` key removed (no ffmpeg/model overrides in production). |
| D19 | Esc during chew (QA3-05) | No global Esc shortcut (it would steal Esc from every app during long jobs). Cancel while chewing = the "Spit it out" button, which must be clickable without focus. Esc stays available in interactive states (feedMe). |
| D20 | Overlay blocks clicks during long jobs / steals focus (QA3-06, QA3-07) | Outside the drag gesture the overlay is click-through (`setIgnoreMouseEvents(true, {forward: true})`) except while the pointer is over an interactive element (cancel button, output/error card, option bubbles in feedMe); the renderer toggles this via IPC. It never takes keyboard focus except in feedMe. During arm/sensor/engaged drag it stays a normal drop target (D16). |
| D21 | New gesture while a result card is shown (QA3-11) | A new trigger arm dismisses the card immediately and starts the new gesture. |
| D22 | Network/debug surface in packaged builds (Security F-23, F-24) | Packaged builds refuse `--remote-debugging-port/-pipe` (quit at startup) and disable the spell checker so no dictionary is downloaded: no network request at launch. |
| D23 | Over-long output names (QA3-08) | Shorten the output stem so the final name fits 255 bytes (UTF-8, all OSes) and the full path limits; never fail for name length alone. |
| D24 | Remove-BG reliability (QA3-01) | One fresh `InferenceSession` per job (released afterwards), on every backend. Correctness over the ~1 s session start cost. |
