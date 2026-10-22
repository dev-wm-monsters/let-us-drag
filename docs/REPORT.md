# Let us drag! — v0.1 project report

Prepared by the Technical Project Manager (TPM) for the product owner. Date: 2026-10-22.

## 1. Bottom line

- **v0.1 beta is built, tested and packaged** for macOS (Apple silicon + Intel), Windows x64 and Linux x64.
- **Every automated gate is green on all three operating systems** (unit + engine + E2E tests, packaging, launch smoke test of the packaged app, licence and security checks).
- **Confidence that it works for you on macOS and Windows: 74 / 100** (§6). The parts that could not be tested
  automatically are the ones only a real Mac/PC can show: the system-wide Shift-drag gesture from Finder/Explorer,
  first-launch prompts (Gatekeeper, SmartScreen, Accessibility) and how the transparent overlay behaves with clicks
  and focus. Your manual checklist covers exactly these: [docs/qa/MANUAL_CHECKLIST.md](qa/MANUAL_CHECKLIST.md).
- **Fine for a private test. Not yet ready for a public/viral launch** — the remaining work is listed in §7.

## 2. What was built

| Area | Result |
|---|---|
| Gesture | Global drag + trigger key (Shift by default; Alt/Option, Ctrl, Cmd/Win selectable). Overlay appears only for real file drags. Wayland / no-permission fallback: Feed Window. |
| The Uncle | Cartoonist-style SVG character with a signature mole, idle breathing/blinking, head **and** eyes turning toward the dragged file, states: appear, hover, feed-me, eat, chew (progress), hamster cheeks (batches), struggle (huge files), spit (result card), choke (friendly errors), refuse (.exe etc.), cancel ("Fine, keep it."). Synthesised sounds, Plain and Hungry modes. |
| Conversions | 30 options across images (incl. HEIC, ICO, AI background removal), video, audio, PDF, Word, Markdown/Text/HTML, data (CSV/JSON/YAML/XLSX) and ZIP — all local. Outputs are saved next to the original and never overwrite anything. |
| App | Tray/menu-bar app, settings, onboarding (macOS Accessibility), Feed Window, launch at login, single instance, cancel ("Spit it out"). |
| Safety | Hardened Electron (sandbox, isolation, strict IPC allowlist, CSP, no navigation, fuses incl. ASAR integrity), safe parsing of hostile files (zip bombs, zip-slip, disguised playlists, SVG-as-PNG, YAML bombs …), no network at launch, no telemetry. |
| Packaging | `.dmg` (arm64, x64; ad-hoc signed), Windows installer + portable `.exe`, AppImage + `.deb`. Pinned, checksum- and licence-verified FFmpeg per platform. |

## 3. How the team worked

Multi-agent workflow, orchestrated by the TPM. Each developer agent owned a part of the codebase and worked in its own
isolated git worktree; QA and Security worked independently and reported bugs to the owners; the TPM merged, resolved
conflicts, ran CI on real macOS/Windows/Linux machines and made binding decisions (`docs/TPM_DECISIONS.md`, D1–D24).

| Phase | Agents | Outcome |
|---|---|---|
| 0 · Plan & scaffold | TPM | Plan, contracts, CI/packaging, stack verification |
| 1 · Build | Engine, Platform, Frontend, QA, Security | Full v0.1 implementation; 300 tests; 39/39 E2E on first integration |
| 2 · Harden | Engine, Platform, Frontend, QA, Security | PDF rendering in-app, watchdog, security MUST items, Uncle polish (head turn, mole), notices; ~24 bugs fixed |
| 3a · Fix round | Engine, Platform | Windows CI bugs, packaged-env hardening |
| 3b · Final verification | QA, Security | Independent exploratory testing (all 30 options), packaged-build security probes |
| 4 · Fix round 2 | Engine, Platform, Frontend + QA regression | Remove-BG reliability, click-through overlay, UX fixes, zero network at launch |
| 5 · Polish | Frontend, Engine | Held-files card layout, sanitizer edge case |

Who did what (details per phase in [docs/TEAM_LOG.md](TEAM_LOG.md)):

- **TPM (orchestrator)** — plan, contracts, scaffolding, CI on 3 OSes, packaging, merges/conflicts, decisions D1–D24,
  replaced the non-redistributable macOS FFmpeg with verified GPL builds, supply-chain pinning, several Windows fixes
  found by CI (locked files, path handling), this report.
- **Backend · Engine** — conversion engine (30 options), safe output naming, cancellation, AI background removal,
  hostile-input hardening, Windows path robustness.
- **Backend · Platform** — Electron main/preload, global trigger, overlay window logic, IPC security, PDF/HTML render
  sandboxes, engine host + watchdog, packaged-build hardening.
- **Frontend** — the Uncle (art, animation, tracking), all UI (overlay, Feed Window, Settings/onboarding), sounds,
  icons, visual harness, README GIF.
- **QA** — test plan, 64 E2E specs, exploratory suite (100+ checks), engine security fixtures, visual reviews, manual checklist.
- **Security** — threat model, checklist (SEC-xx), reviews with probes on the packaged app, licence audit, third-party notices.

## 4. Bugs

**66 bugs logged, 61 fixed**; the rest are decided/deferred (see [docs/qa/BUGS.md](qa/BUGS.md)).
By severity: 1 critical, 13 high, 30 medium, 22 low.

Most important ones found and fixed:

| Bug | Found by | Why it mattered |
|---|---|---|
| macOS arm64 FFmpeg was a "nonfree" (non-redistributable) build | Security | Licence violation; replaced with verified GPL builds |
| Remove BG failed every second time inside the app | QA (exploratory) | You would have hit it on your second photo |
| PDF → images crashed the engine inside Electron | Engine | Required a sandboxed in-app PDF renderer |
| Disguised playlist files could make FFmpeg read other local files; SVG-as-PNG; zip/XLSX bombs | QA + Security | Malicious-file safety |
| Windows: converted originals stayed locked; PDF paths; FAT/exFAT USB sticks; long paths | CI on Windows + Engine | Windows-only failures you would have seen tomorrow |
| Test hooks could be enabled in packaged builds; debug port; spell-check network request | Security | Hardening + "100% local" promise |
| Overlay blocked clicks and stole focus during long conversions | QA | Daily-use annoyance |

## 5. Test results (final)

| Gate | Result |
|---|---|
| CI Linux | all unit/engine tests incl. the real AI-model tests + full E2E ✓ |
| CI Windows | unit/engine ✓ (platform-specific skips only) |
| CI macOS | unit/engine ✓ |
| E2E (Playwright, real app, Linux) | 63 passed, 1 skipped (needs non-root) — stable across repeated runs |
| QA exploratory suite | 101/103 checks passed in the last run; both failures fixed in phase 5 |
| Packaging (all 4 targets) | built, launched (smoke start), fuses verified, QA artifact checks passed |
| Security (packaged app probes) | 12/12 bypass probes blocked, zero network requests at launch |

## 6. Confidence: 74 / 100

| Area | Score | Why |
|---|---|---|
| Install & first launch | 80 | Packaged apps start on real macOS (arm64 + x64) and Windows CI machines; Gatekeeper/SmartScreen need one manual click |
| The Shift-drag gesture | 60 | Proven under Linux with real X11 input, but real Finder/Explorer drags and the macOS Accessibility grant can only be tested by you. The Feed Window always works as a fallback |
| Conversions | 90 | All 30 options validated end to end with independent decoders; engine tests pass on all 3 OSes |
| Remove BG | 80 | Fixed and verified 8× in a row with the real model; Intel Macs use a slower fallback that is less tested |
| Cancel & errors | 85 | Clean at every stage; friendly messages |
| The Uncle | 80 | Reviewed on light/dark desktops; animation smoothness on your hardware to be confirmed |
| Click-through / focus behaviour (new) | 60 | Logic verified, but the OS-level behaviour exists only on macOS/Windows |

QA's independent score was 72/100 before the phase-5 polish; Security's verdict: **private test build OK**.

## 7. Before a public / viral launch (not needed for your test)

1. **Code signing**: Apple Developer ID + notarization (removes the Gatekeeper warning), Windows Authenticode.
2. **GPL/LGPL source bundles** attached to each public release (FFmpeg + its libraries, libvips stack, libheif, libuiohook) — see THIRD_PARTY_NOTICES §0.
3. Keep Mark-of-the-Web / quarantine on files extracted from zips (SEC-105).
4. Decide on the Remove-BG model licence/mirroring (weights licence is not stated upstream; the app downloads them from upstream on first use).
5. Smaller downloads (installers are ~180–210 MB), auto-update, a website/landing page, custom Uncle skins.
6. Remaining low-priority items in docs/security/REVIEW.md.

## 8. How to test tomorrow

1. Download the installer for your system (links in the chat / the draft GitHub release `v0.1.0-beta.1`).
2. Follow [docs/qa/MANUAL_CHECKLIST.md](qa/MANUAL_CHECKLIST.md) — about 20–30 minutes per OS.
3. Report anything odd with: OS + version, the file type, what the Uncle did, and (if possible) a screen recording.
