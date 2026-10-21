# Bug ledger

| ID | Severity | Owner | Status | Summary | Repro | Fix ref |
|---|---|---|---|---|---|---|
| B-001 | High | Engine | Fixed (engine) / host part in phase 2 | @napi-rs/canvas crashes Electron's V8 sandbox on require → PDF→PNG/JPG broke the worker | Engine smoke in Electron utilityProcess | Engine: canvas blocked in Electron, new `renderPdfPages` host adapter; Platform P1 |
| B-002 | High | Engine | Fixed | pdf.js detected utilityProcess as a browser → "document is not defined" on PDF→TXT | Engine smoke in Electron | 8762a10 |
| B-003 | High | Engine | Fixed | Remove-BG mask written as 3-channel buffer → scrambled cut-out | Real ISNet model test | 29730b2 |
| B-004 | Medium | Platform | Fixed | App hung when quit immediately after launch | quit at 0 ms | 6818937 |
| B-005 | Critical | TPM | Open | darwin-arm64 ffmpeg (ffmpeg-static b6.1.1) is built with --enable-nonfree → not redistributable | `ffmpeg -L` (Security F-01) | D11, CI probe |
| B-006 | Medium | TPM | Open | ffmpeg downloads not checksum-enforced | Security F-02 | — |
| B-007 | Medium | Frontend/TPM | Fixed | Typecheck failed after merge (renderer mock missing new API methods) | `npm run typecheck` on develop | 4183a51 |
| B-008 | Medium | Platform | Open | Cancelled jobs stuck in synchronous parsers cannot be interrupted | Engine note | Platform P2 watchdog |
| B-009 | Medium | Security/TPM | Open | THIRD_PARTY_NOTICES incomplete (ffmpeg versions, LGPL libs, Chromium, written offer) | Security F-03/F-06/F-07 | Security S1 |
| B-010 | Medium | TPM | Open | CI token scope / persisted credentials / tag-pinned actions | Security F-04/F-05 | — |
| B-011 | Low | Platform | Open | ELECTRON_RENDERER_URL honoured in packaged builds | Security F-09 | Platform P3 |
| B-012 | Low | Frontend | Open | CSP missing object-src/base-uri/form-action/frame-src | Security F-10 | Frontend F4 |
| B-013 | Medium | TPM | Fixed | No Electron fuses | Security F-11 | b8b5e3a |
| B-014 | Medium | TPM | Partly fixed | Package too large (Linux unpacked 626 MB) | electron-builder --dir | b8b5e3a (438 MB) |
| B-015 | Low | Frontend | Open | Product-owner feedback: head turn too subtle, mole not prominent enough | docs/art/screens | Frontend F1/F2 |
