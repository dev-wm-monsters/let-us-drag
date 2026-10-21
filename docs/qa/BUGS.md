# Bug ledger

| ID | Severity | Owner | Status | Summary | Repro | Fix ref |
|---|---|---|---|---|---|---|
| B-001 | High | Engine+Platform | Fixed | @napi-rs/canvas crashes Electron's V8 sandbox on require → PDF→PNG/JPG broke the worker | Engine smoke in Electron utilityProcess | Engine: canvas blocked in Electron, new `renderPdfPages` host adapter; Platform P1 |
| B-002 | High | Engine | Fixed | pdf.js detected utilityProcess as a browser → "document is not defined" on PDF→TXT | Engine smoke in Electron | 8762a10 |
| B-003 | High | Engine | Fixed | Remove-BG mask written as 3-channel buffer → scrambled cut-out | Real ISNet model test | 29730b2 |
| B-004 | Medium | Platform | Fixed | App hung when quit immediately after launch | quit at 0 ms | 6818937 |
| B-005 | Critical | TPM | Fixed | darwin-arm64 ffmpeg (ffmpeg-static b6.1.1) is built with --enable-nonfree → not redistributable | `ffmpeg -L` (Security F-01) | a495751: GPL Martin Riedl 9.0.2 builds for macOS, verified in CI |
| B-006 | Medium | TPM | Fixed | ffmpeg downloads not checksum-enforced | Security F-02 | a495751 (fail-closed SHA-256 pins + nonfree licence gate) |
| B-007 | Medium | Frontend/TPM | Fixed | Typecheck failed after merge (renderer mock missing new API methods) | `npm run typecheck` on develop | 4183a51 |
| B-008 | Medium | Platform | Fixed | Cancelled jobs stuck in synchronous parsers cannot be interrupted | Engine note | Platform P2 watchdog |
| B-009 | Medium | Security | Fixed (private build); public-release items listed in THIRD_PARTY_NOTICES §0 | THIRD_PARTY_NOTICES incomplete (ffmpeg versions, LGPL libs, Chromium, written offer) | Security F-03/F-06/F-07 | Security S1 |
| B-010 | Medium | TPM | Mostly fixed | CI token scope / persisted credentials / tag-pinned actions (actions still tag-pinned: their SHAs cannot be resolved from this environment) | Security F-04/F-05 | 39e1580 |
| B-011 | Low | Platform | Fixed | ELECTRON_RENDERER_URL honoured in packaged builds | Security F-09 | Platform P3 |
| B-012 | Low | Frontend | Fixed | CSP missing object-src/base-uri/form-action/frame-src | Security F-10 | Frontend F4 |
| B-013 | Medium | TPM | Fixed | No Electron fuses | Security F-11 | b8b5e3a |
| B-014 | Medium | TPM | Mostly fixed | Package too large (Linux unpacked 626 MB) | electron-builder --dir | b8b5e3a (438 MB) |
| B-015 | Low | Frontend | Fixed | Product-owner feedback: head turn too subtle, mole not prominent enough | docs/art/screens | Frontend F1/F2 |
| B-016 | High | Engine | Fixed (f01ab94; to be confirmed by Windows CI) | PDF → PNG/JPG/TXT fail on Windows: pdf.js cMapUrl/standardFontDataUrl built from a backslash path ("…\\cmaps\\" must include trailing slash) | CI windows-latest, tests/engine/pdf.test.ts | — |
| B-017 | Medium | Engine | Fixed (f01ab94) | Damaged PDF reports INTERNAL instead of INPUT_INVALID on Windows (likely same root cause as B-016) | CI windows-latest | — |
| B-018 | Low | Engine | Fixed (f01ab94) | describePaths: relative-path test expects UNSUPPORTED but Windows returns INPUT_NOT_FOUND (path absoluteness check is POSIX-only or test input is POSIX-specific) | CI windows-latest, tests/engine/engine.test.ts:36 | — |
| B-019 | High | Engine | Fixed | SVG renamed .png decoded through librsvg (sharp SVG loader enabled) | QA/Security SEC-50 fixture | a058201 |
| B-020 | High | Engine | Fixed | ffconcat playlist disguised as .mp3 made ffmpeg read another local file; HLS could reach the network (no protocol/format whitelist) | QA SEC-62 fixture | a058201 |
| B-021 | High | Engine | Fixed | XLSX/DOCX zip bombs fully inflated (no OOXML pre-scan) | QA SEC-91 fixture | a058201 |
| B-022 | High | Engine | Fixed | Unzip had no compression-ratio cap; limits above checklist | QA SEC-103 fixture | a058201 |
| B-023 | Medium | Engine | Fixed | Truncated/corrupt image data reported INTERNAL instead of INPUT_INVALID | Engine scan | a058201 |
| B-024 | Medium | Engine | Fixed | '%' in BMP/ICO file names expanded as an image2 pattern (wrong file decoded / failure) | QA SEC-63, Security F-20 | a058201 |
| B-025 | Medium | Engine | Fixed | Never-overwrite fallback used existsSync+rename (racy) | Security SEC-110 | a058201 |
| B-026 | Medium | Engine | Fixed | Unzip overwrote case-insensitive duplicates; Windows reserved names not handled | QA SEC-101 | a058201 |
| B-027 | Low | Engine | Fixed | FIFO/device inputs returned UNSUPPORTED instead of INPUT_INVALID | QA SEC-43 | a058201 |
| B-028 | Low | Engine | Fixed | Model download: mirror as primary (vs D10), unrestricted redirects, no size cap/stall timeout; shared download cancelled by one job | Security F-19 | a058201 |
| B-029 | Low | Engine | Fixed | Zipping a dropped symlink produced an empty archive | Engine scan | a058201 |
| B-030 | High | Platform | Fixed | PDF→PNG/JPG failed inside the app (no renderPdfPages host adapter) | Engine B-001 follow-up | c67f399 |
| B-031 | High | Platform | Fixed | htmlToPdf loaded HTML over file:// from a temp file (SEC-82) | Security review | c67f399 |
| B-032 | High | Platform | Fixed | LUD_E2E enabled test hooks in packaged builds (F-15/D12) | Security probe on packaged build | c67f399 |
| B-033 | Medium | Platform | Fixed | No per-window IPC allowlist; sender frame not checked (SEC-11/12) | Security review | c67f399 |
| B-034 | Medium | Platform | Fixed | Packaged app passed LUD_* overrides (ffmpeg/model path) to the engine (F-16/D18) | Security review | 06ac25a |
| B-035 | Medium | Platform | Fixed | macOS: re-launching the running app from Finder did nothing ('activate' not handled) | Platform cross-platform scan | 06ac25a |
| B-036 | Low | Platform | Fixed | Windows: file://server/share URLs allowed (NTLM leak risk); device names in sandbox protocol; settings rename EPERM under antivirus; dev autostart path | Platform scan | 06ac25a |
| B-037 | Low | Platform | Fixed | Device-namespace paths accepted by IPC; raw key codes stored in trigger state; Accessibility revocation not handled; overlay not hidden on lock/suspend; second launch during startup ignored | Platform/Security review | c67f399, 975cc9e |
| B-038 | Medium | Frontend | Fixed | Cancel during eat/early chew could be lost (cancel reached main before the job was registered) | Frontend review | 65fc799 |
| B-039 | Low | Frontend | Fixed | Pupils off-target on strong head turns; fly-in from undefined point on feed test drops; Esc after done hid the output card | Frontend review | 65fc799 |
| B-040 | Medium | Engine | Fixed | Windows FAT/exFAT: hard-link failure code (EISDIR) not in fallback list → save next to file on USB stick failed | Engine Windows scan | f01ab94 |
| B-041 | Low | Engine | Fixed | Windows folder commit could overwrite / fail transiently under antivirus | Engine Windows scan | f01ab94 |
| B-042 | Medium | Engine | Fixed | MD/DOCX → HTML outputs unsanitized, no CSP (F-17/D17) | Security review | f01ab94 |
| B-043 | Medium | TPM/QA | Fixed | Packaging checks failed on macOS: no FFMPEG-LICENSE.txt for bare-binary source; Intel Mac has no onnxruntime-node binary (wasm fallback expected) | Package CI | e9b692e |
| B-044 | Medium | Platform | Fixed | IPC accepted drive-less rooted Windows paths ('\\b'); two platform tests assumed POSIX paths | Windows CI | a3012ec |
| B-045 | High | Engine | Fixed | Windows: libvips operation cache kept converted originals open/locked (EBUSY on delete/rename) | Windows CI (security.test cleanup) | 5afa281 |
| B-046 | High | Engine | Open | QA3-01: Remove BG fails every second time in an app session (onnxruntime-node session reused in utilityProcess → exit 5) | QA exploratory, tests/qa/probes/ort-utility | D24 |
| B-047 | Medium | Frontend | Open | QA3-02: model-download stage text never shown (D15 second half) | QA exploratory | — |
| B-048 | Medium | Frontend | Open | QA3-03: option hints clipped at overlay edges (Remove BG hint loses its first words) | QA visual review | — |
| B-049 | Medium | Frontend | Open | QA3-04: long error messages run off the bottom of the overlay | QA exploratory | — |
| B-050 | Medium | Frontend/Platform | Decided | QA3-05: Esc cannot cancel during chew (overlay not focusable) | QA exploratory | D19 (button only) |
| B-051 | Medium | Platform/Frontend | Open | QA3-06: overlay catches clicks for the whole duration of long jobs | QA code review | D20 |
| B-052 | Low | Platform | Open | QA3-07: overlay takes keyboard focus for ~2.5 s after every conversion | QA code review | D20 |
| B-053 | Low | Engine | Open | QA3-08: output names over 255 bytes fail with a misleading "folder doesn't let me write" | QA exploratory | D23 |
| B-054 | Low | Engine | Open | QA3-09: DOCX→Markdown loses the space between bold and italic runs | QA exploratory | — |
| B-055 | Low | Platform | Open | QA3-10: test hook dropFilesOnFeed never resolves when it must open the Feed Window | QA exploratory | — |
| B-056 | Low | Platform/Frontend | Open | QA3-11: a new gesture is ignored while a result card is shown | QA exploratory | D21 |
| B-057 | Low | Frontend | Open | QA3-12: capture script overwrites docs/art GIFs even with LUD_SCREENS_DIR set | QA | — |
| B-058 | Medium | Platform | Open | F-23: packaged app honours --remote-debugging-port | Security probe | D22 |
| B-059 | Medium | Platform | Open | F-24: spell-check dictionary download at every launch (network request) | Security netlog probe | D22 |
| B-060 | Low | Engine | Open | F-25: sanitizer passes `<svg><style>` mutation-XSS payloads (CSP still blocks) | Security review | — |
| B-061 | Low | TPM | Open | F-26/F-27: ffmpeg licence gate fails open; LICENSE/README extras not hashed | Security review | — |
| B-062 | Medium | TPM | Open | F-08/SEC-146: ESLint gate misses node:child_process exec, shell:true | Security review | — |
| B-063 | Low | Engine | Deferred (public release) | SEC-105: unzip does not propagate Mark-of-the-Web / quarantine | Security review | public-release list |
