# Let us drag! — QA Test Plan (v0.1)

Owner: QA. Source of truth for scope: `docs/PLAN.md` (v0.1). Contracts under test:
`src/shared/types.ts`, `src/shared/catalog.ts`, `src/shared/api.ts`, `src/shared/test-hooks.ts`,
`src/engine/api.ts`. Bugs found while executing this plan go to `docs/qa/BUGS.md`.

**Revision v0.2 (phase 2, 2026-10-21).** Binding TPM decisions D1–D14 (`docs/TPM_DECISIONS.md`) are
applied below and the questions they answer are removed from §17; behaviour that the implementation
defines (naming, flattening, frames) is documented as such. New: E2E-35..39 (real Chromium adapters),
E2E-53..55 (Feed Window drops), E2E-65/66 (htmlToPdf beacon), E2E-70..82 (media/data/archive, modes,
moods, cancel) and the engine-level QA security fixtures QA-SEC-01..16 (§14.1). The product owner's
run on real machines uses the short [MANUAL_CHECKLIST.md](MANUAL_CHECKLIST.md); §16 stays the full QA
matrix.

**Tags.** `@needs-p2` (Playwright tag) and `[needs-p2]` (vitest title prefix) mark tests for behaviour
that phase-2 work (Platform/Frontend/Engine) is delivering in parallel: they are **expected to fail on
`develop@a6c0d94`** and are kept active on purpose, so they turn green when that work is merged. The
older `@needs-integration` tag is historical: all those tests pass since the phase-1 integration.

## 0. How to read this plan

Every case has an ID, an area, preconditions, steps, the expected result and where it is (or will be)
automated.

**Automation legend** (column "Auto / where"):

| Code | Meaning | Runs where |
|---|---|---|
| **U** | Unit test (vitest), pure function | `npm test`, Linux/macOS/Windows CI |
| **I** | Engine integration test (vitest), real fixture → real output, validated | `npm test`, Linux/macOS/Windows CI (PLAN §8.2) |
| **R** | Renderer component/reducer test (vitest) | `npm test`, all CI OSes |
| **E** | Playwright `_electron` E2E via `globalThis.__ludTest` + DOM test ids | `xvfb-run -a npm run test:e2e`, Linux CI only |
| **P** | CI packaging job check (`.github/workflows/package.yml`) or `tests/qa/check-artifacts.mjs` | package workflow, per target |
| **M** | Manual, product owner or QA on real hardware (section 16) | macOS + Windows by hand |

"Owner" for U/I/R tests is the area that owns the code (PLAN §7): Engine (`tests/engine/**`),
Platform (`src/main/**/*.test.ts`), Frontend (`src/renderer/**/*.test.ts(x)`). QA may extend
`tests/engine` + `tests/helpers` after the build phase. E2E specs live in `tests/e2e/` (QA).

**Validation rules used in "Expected" for conversions** (apply to every CONV case unless stated):

- V1 Output exists **next to the input** (same folder), input file unchanged (same SHA-256).
- V2 Output is **decodable**: images via `sharp(...).metadata()` (format + dimensions), PDFs via
  `pdf-lib` load + page count, audio/video via `ffmpeg -i` probe (codec, duration ±0.25 s), DOCX via
  `mammoth` extract, XLSX via `exceljs` read, ZIP via `yauzl` listing, text via UTF-8 decode.
- V3 Output name: `<base>.<ext>`; on collision `<base> (1).<ext>`, `<base> (2).<ext>`… (PLAN §3.7).
- V4 Events: `queued` → `progress`* (0..1 non-decreasing, or -1) → exactly one `done` with
  `outputPaths` = the files actually written. No event after `done`/`error`.
- V5 No temp files left in the output folder or in the engine temp dir after the job.

## 1. Catalog & option selection (CAT)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| CAT-01 | Ext → category | — | `categoryForExt` for every ext in `EXTENSIONS`, upper/lower case, with/without dot | Category from PLAN §5 table; unknown ext → `unknown` | U `tests/unit/catalog.test.ts` (exists, extend to every ext) |
| CAT-02 | MIME → category | — | `categoryForMime` for image/*, video/*, audio/*, pdf, docx, md/plain/html, csv/json/yaml/xlsx, zip, exe/dmg/sh, `''`, `image/svg+xml`, `application/octet-stream` | As catalog; empty/svg/octet-stream → `unknown` (→ feedMe) | U |
| CAT-03 | Max 8 | — | `optionsFor` for every category incl. added ZIP | Never more than 8 options | U |
| CAT-04 | No-op hiding | — | `optionsFor` for png→ no `to-png`; jpg/jpeg → no `to-jpg`; mp4 → no `to-mp4`; ogg/oga → no `to-ogg`; txt → no `to-txt`; html/htm → no `to-html`; md/markdown → no `to-md`; csv/json/yaml/yml/xlsx → no same-format | Option hidden only when **every** input already has that format | U (exists for png) |
| CAT-05 | No-op in mixed-ext batch | — | `optionsFor` for [png, jpg] image batch | Both `to-png` and `to-jpg` shown (not every input is already X) | U |
| CAT-06 | Mixed categories | — | [image, video] | ZIP only | U (exists) |
| CAT-07 | Folder | — | any input + `hasDirectory` | ZIP only | U (exists) |
| CAT-08 | Blocked | — | any batch containing a blocked ext | No options (refuse), even mixed with valid files | U |
| CAT-09 | Archive | — | single zip | `unzip` only, no `zip` | U |
| CAT-10 | minInputs | — | 1 pdf vs 2 pdfs | `pdf-merge` only when count ≥ 2 | U (exists) |
| CAT-11 | Dragover vs drop | — | dragover with MIME only (`exts` empty), then drop with exts | Dragover never hides by ext (unknown yet); after drop no-op options disappear | R (Frontend) |
| CAT-12 | `compress` naming target | — | `compress` any input | Output `<base>-compressed.<ext>` (same format); if the result is not smaller, the original bytes are kept with the note "Already as small as it gets" (implementation, `src/engine/jobs.ts`) | I |

## 2. Conversions per option (CONV)

Fixtures are generated at test time (sharp, pdf-lib, ffmpeg lavfi, docx lib, exceljs, yazl); no
binary fixtures in git except where generation is impossible (HEIC — see CONV-IMG-12).

### 2.1 Image (sharp; heic-decode; ffmpeg for BMP/ICO; pdf-lib; onnxruntime-node)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| CONV-IMG-01 | to-png | fixture of each image input ext except png | run job `to-png` | V1–V5; PNG same WxH; alpha preserved when present | I (each input) |
| CONV-IMG-02 | to-jpg | each input ext except jpg/jpeg | `to-jpg` | V1–V5; ext `.jpg`; transparent pixels flattened onto white `#ffffff` (implementation) | I; E2E-20, E2E-21, E2E-25, E2E-27 |
| CONV-IMG-03 | to-webp | each input except webp | `to-webp` | V1–V5 | I; E2E-26 |
| CONV-IMG-04 | to-avif | each input except avif | `to-avif` | V1–V5 (sharp decodes AVIF back) | I |
| CONV-IMG-05 | to-pdf single | one PNG, one JPG | `to-pdf` | One PDF, 1 page, page aspect = image aspect | I |
| CONV-IMG-06 | to-pdf merge | 3 images of different sizes | `to-pdf` | One PDF, 3 pages in drop order, named `<first input> (merged).pdf` in the first input's folder; a single image gives `<base>.pdf` (implementation) | I; E2E-28 |
| CONV-IMG-07 | to-ico | PNG 512×512, PNG 16×16, non-square JPG | `to-ico` | Valid ICO (header `00 00 01 00`), sizes ≤ 256, decodable by ffmpeg | I |
| CONV-IMG-08 | remove-bg | model present in cacheDir | PNG with a subject on flat background | PNG with alpha channel, same WxH, corners transparent | I (needs model, U6) |
| CONV-IMG-09 | remove-bg no model | model absent, offline | `remove-bg` | D10: weights are downloaded on first use from the upstream rembg release (SHA-256 pinned `60920e99…`, one-time download stage message), never mirrored in our releases; offline → `MODEL_DOWNLOAD_FAILED` friendly message, choke | I + M |
| CONV-IMG-10 | compress | PNG, JPG, WEBP, AVIF, GIF inputs | `compress` | Same format as `<base>-compressed.<ext>` (CAT-12), size ≤ input, decodable, same WxH | I |
| CONV-IMG-11 | BMP / ICO input | BMP, ICO fixtures (ffmpeg-generated) | `to-png` | Decoded via ffmpeg fallback when sharp lacks support (U5) | I |
| CONV-IMG-12 | HEIC/HEIF input | small HEIC fixture (cannot be generated with our deps → committed, license-clean, < 50 KB) | `to-jpg`, `to-png` | Decoded via heic-decode; dimensions correct | I |
| CONV-IMG-13 | Animated GIF / WEBP | 3-frame GIF | `to-png`, `to-webp`, `to-gif` | GIF/WEBP targets keep all frames; other targets use the first frame (implementation); no crash | I |
| CONV-IMG-14 | EXIF orientation | JPG with orientation=6 | `to-png` | Output visually rotated (dimensions swapped) | I |
| CONV-IMG-15 | CMYK / 16-bit | CMYK JPG, 16-bit PNG | `to-webp`, `to-jpg` | Decodable sRGB 8-bit output | I |
| CONV-IMG-16 | Huge dimensions | 20000×20000 PNG (sparse colour) | `to-jpg` | Either succeeds or `INPUT_INVALID` friendly (pixel limit); never OOM-crashes the engine | I |
| CONV-IMG-17 | TIFF multi-page | 2-page TIFF | `to-png` | First page, no crash | I |

### 2.2 Video (ffmpeg)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| CONV-VID-01 | to-mp4 | 2 s testsrc+sine in mov, m4v, mkv, webm, avi | `to-mp4` | V1–V5; H.264 + AAC; duration ±0.25 s | I |
| CONV-VID-02 | to-mov | mp4, webm | `to-mov` | QuickTime container, decodable | I |
| CONV-VID-03 | to-webm | mp4 | `to-webm` | VP9 + Opus, realtime preset | I; E2E-71 |
| CONV-VID-04 | to-gif | 1280×720 30 fps mp4 | `to-gif` | GIF ≤ 15 fps, width ≤ 480, aspect kept | I; E2E-70 |
| CONV-VID-05 | to-mp3 / to-wav | mp4 with audio | `to-mp3`, `to-wav` | Audio-only file, duration ±0.25 s | I |
| CONV-VID-06 | Video without audio | mp4 video-only | `to-mp3` | Friendly error (`INPUT_INVALID`: "This video has no sound"), choke | I |
| CONV-VID-07 | compress | high-bitrate mp4 | `compress` | H.264 CRF 28, smaller than input, same duration | I |
| CONV-VID-08 | Odd dimensions | 321×241 avi | `to-mp4` | Succeeds (even-dimension scaling / yuv420p) | I |
| CONV-VID-09 | Rotation metadata | mov with rotate=90 | `to-mp4` | Output displays upright | I |
| CONV-VID-10 | Progress | 20 s video | any | progress events increase monotonically from ffmpeg `time=`; final done | I |
| CONV-VID-11 | ffmpeg missing | `LUD_FFMPEG_PATH` → nonexistent, PATH empty, no resources | `to-mp4` | `TOOL_MISSING`, friendly message | I |

### 2.3 Audio (ffmpeg)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| CONV-AUD-01 | to-mp3 | 1 s sine in wav, m4a, aac (ADTS), ogg, oga, opus, flac | `to-mp3` | V1–V5, duration ±0.25 s | I; E2E-31 (wav) |
| CONV-AUD-02 | to-wav | each input except wav | `to-wav` | PCM WAV (`RIFF....WAVE`) | I |
| CONV-AUD-03 | to-m4a | each input except m4a | `to-m4a` | AAC in MP4 container | I |
| CONV-AUD-04 | to-ogg | each input except ogg/oga | `to-ogg` | Vorbis in Ogg (`OggS`) | I |
| CONV-AUD-05 | to-flac | each input except flac | `to-flac` | `fLaC` magic | I |
| CONV-AUD-06 | compress | 320 kbps mp3, wav | `compress` | MP3 128 kbps, `<base>-compressed.mp3` (CAT-12) | I |
| CONV-AUD-07 | Mono/rates | mono 8 kHz wav, 48 kHz stereo flac | `to-mp3` | Decodable, channel count preserved | I |

### 2.4 PDF (pdfjs-dist + @napi-rs/canvas; pdf-lib)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| CONV-PDF-01 | pdf-to-png | 3-page PDF `doc.pdf` | `pdf-to-png` | New folder `doc (pages)/` with `page-01.png`… (zero-padded), each decodable, white background | I (plain Node canvas); **E2E-35** inside the app through the `renderPdfPages` host adapter (`@needs-p2`, B-001) |
| CONV-PDF-02 | pdf-to-jpg | same | `pdf-to-jpg` | Same with JPGs | I; **E2E-36** (`@needs-p2`) |
| CONV-PDF-03 | Pages folder collision | `doc (pages)/` already exists | `pdf-to-png` | New folder `doc (pages) (1)/`; existing folder untouched | I |
| CONV-PDF-04 | to-txt | PDF with known text | `to-txt` | `.txt` contains the text (UTF-8) | I |
| CONV-PDF-05 | pdf-merge | 1-page + 2-page PDFs | `pdf-merge` | One PDF with 3 pages, order = drop order, named `<first> (merged).pdf` | I; E2E-29 |
| CONV-PDF-06 | Encrypted PDF | password-protected PDF | `pdf-to-png` | Friendly `INPUT_INVALID` | I |
| CONV-PDF-07 | Scanned PDF | image-only PDF | `to-txt` | Empty or near-empty txt, no crash (no OCR in v0.1) | I |
| CONV-PDF-08 | Large PDF | 200 pages | `pdf-to-jpg` | Progress per page; memory bounded | I |

### 2.5 Document (mammoth → htmlToPdf adapter)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| CONV-DOC-01 | docx → pdf | DOCX (generated with `docx`) with heading, paragraph, table, image | `to-pdf` | PDF ≥ 1 page, text extractable; **no LibreOffice used** | I (adapter mocked) + **E2E-39** (real printToPDF: 1 page, heading/list/table text extracted) |
| CONV-DOC-02 | docx → html | same | `to-html` | HTML contains heading + table; images inlined or saved (Q-10) | I |
| CONV-DOC-03 | docx → md | same | `to-md` | Markdown heading `#`, table or text | I |
| CONV-DOC-04 | docx → txt | same | `to-txt` | Plain text with paragraphs | I |
| CONV-DOC-05 | Corrupt docx | zip without `word/document.xml` | any | Friendly `INPUT_INVALID` | I |

### 2.6 Text (marked; docx; htmlToPdf adapter)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| CONV-TXT-01 | md → pdf/html/docx/txt | `.md` and `.markdown` | each option | PDF readable; HTML has `<h1>`; DOCX opens in mammoth; TXT has no markdown syntax | I; **E2E-38** (md → real PDF, text, 1 page) |
| CONV-TXT-02 | txt → pdf/html/docx | `.txt` | each option | Text preserved, line breaks kept | I |
| CONV-TXT-03 | html/htm → pdf/docx/txt | `.html`, `.htm` | each option | Text preserved; no `to-html` offered; CSS page breaks honoured | I; **E2E-37** (html → real PDF: 3 page breaks → 3 pages, text per page) |
| CONV-TXT-04 | Encodings | UTF-8 with BOM, UTF-16LE with BOM, Latin-1 | `to-pdf` | Characters rendered correctly or documented fallback | I |
| CONV-TXT-05 | HTML with script/remote assets | `<script>`, `<img src="https://...">`, `<link href="http://...">` | `to-pdf` | Script NOT executed, NO network request, no local file embedded (SEC-11, CHECKLIST SEC-82) | I + **E2E-65/66** (local beacon server: zero hits) |

### 2.7 Data (papaparse, js-yaml, exceljs)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| CONV-DATA-01 | Matrix | same 3×3 table as csv, json (array of objects), yaml, yml, xlsx | every option except same format | Round-trip preserves header + values (numbers stay numbers where the format allows) | I; E2E-72 (csv → xlsx) |
| CONV-DATA-02 | xlsx multi-sheet | 2 sheets | `to-csv` | First sheet only (PLAN §5) | I |
| CONV-DATA-03 | Nested JSON → CSV | objects with nested objects/arrays | `to-csv` | Defined behaviour (Q-11): flatten or JSON-stringify cells; no crash | I |
| CONV-DATA-04 | Non-tabular JSON | `42`, `"x"`, `{}` | `to-csv`, `to-xlsx` | Friendly `INPUT_INVALID` or a one-cell table (Q-11) | I |
| CONV-DATA-05 | CSV dialects | BOM, `;` delimiter, quoted newlines, empty lines | `to-json` | Parsed correctly | I |
| CONV-DATA-06 | Formula injection | CSV cell `=HYPERLINK("http://x")`, `+1`, `-1`, `@SUM` | `to-xlsx` | Stored as **string**, not formula (SEC-18) | I |
| CONV-DATA-07 | YAML multi-doc / alias bomb | `---` documents; billion-laughs aliases | `to-json` | Multi-doc: defined (Q-11); bomb: `INPUT_INVALID` in bounded time, nothing written | I; QA-SEC-01 |
| CONV-DATA-08 | Dates | xlsx with date cells | `to-json` | ISO-8601 strings | I |

### 2.8 Archive / ZIP (yauzl, yazl)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| CONV-ZIP-01 | unzip | zip with nested folders, unicode names | `unzip` | Extracted next to the zip into a new folder `<zip base>/` (`<zip base> (1)/` on collision), all files byte-identical | I; E2E-73 (zip → unzip round trip) |
| CONV-ZIP-02 | zip-slip | entries `../evil.txt`, `/abs.txt`, `C:\x.txt`, `a/../../b` | `unzip` | Whole job refused with `INPUT_INVALID`, nothing written anywhere (validated before extracting) (SEC-09) | I; QA-SEC-02 |
| CONV-ZIP-03 | Symlink entries | zip with a symlink entry → `/etc` | `unzip` | Symlink not created / not followed; two-step "link then file through link" cannot escape | I; QA-SEC-03 |
| CONV-ZIP-04 | Encrypted zip | password zip | `unzip` | Friendly `INPUT_INVALID` | I |
| CONV-ZIP-05 | Zip bomb | 42.zip-style high ratio | `unzip` | Refused with `INPUT_INVALID` quickly (CHECKLIST SEC-103: ≤ 10 000 entries, ≤ 2 GB, ratio cap) — never fills the disk | I; QA-SEC-05 (`[needs-p2]`: today only a 4 GB / 50 000-entry cap) |
| CONV-ZIP-06 | zip single file | `a.png` | `zip` | `a.zip` containing `a.png` | I |
| CONV-ZIP-07 | zip folder | folder with subfolders, empty dir, hidden file | `zip` | `<folder>.zip` preserves tree (hidden files: Q-06) | I |
| CONV-ZIP-08 | zip mixed batch | png + pdf | `zip` | One `Archive.zip` next to the first input | I; E2E-30, E2E-73 |
| CONV-ZIP-09 | zip with symlink in folder | folder contains symlink to outside | `zip` | Link not followed outside the folder (SEC-12) | I |

## 3. Batch rules (BAT)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| BAT-01 | each | 3 PNGs | `to-jpg` | 3 outputs, each next to its own input | I; E2E-27 |
| BAT-02 | merge | 3 PNGs | `to-pdf` | 1 PDF, 3 pages | I; E2E-28 |
| BAT-03 | Inputs in different folders | a/x.png, b/y.png | `to-pdf` (merge) | Output folder = first input's folder (implementation) | I |
| BAT-04 | Partial failure | 2 good PNG + 1 corrupt | `to-jpg` (each) | D7: all-or-nothing — no output committed if any input fails; the error message names the failing file | I |
| BAT-05 | Same base name | a/x.png and a/x.jpg | `to-webp` | `x.webp` and `x (1).webp` — no overwrite within one job | I |
| BAT-06 | Hamster | ≥ 3 inputs | any | Hamster cheeks while chewing (UNC-09) | R + E2E-77 + M |
| BAT-07 | Large batch | 200 small PNGs | `to-jpg` | Completes; progress aggregates; UI responsive | I + M |

## 4. Output naming & never overwrite (OUT)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| OUT-01 | Next to source | — | any single conversion | V1 | I; E2E-20 |
| OUT-02 | Collision (1), (2) | `photo.jpg` exists | `photo.png` → `to-jpg` twice | `photo (1).jpg`, then `photo (2).jpg`; original hash unchanged | U (output.ts) + I; E2E-25 |
| OUT-03 | Case-insensitive FS | `Photo.JPG` exists (macOS APFS / NTFS) | `photo.png` → `to-jpg` | `photo (1).jpg` — must not overwrite `Photo.JPG` | I on macOS + Windows CI |
| OUT-04 | Race | two jobs targeting the same name concurrently | start both | Two distinct files (exclusive create `wx`, retry on `EEXIST`) | U/I |
| OUT-05 | Double extension | `archive.tar.gz`, `a.b.c.png` | `zip` / `to-jpg` | `archive.tar.zip`? (Q-14) / `a.b.c.jpg` | U |
| OUT-06 | No extension | `README` (unknown) | `zip` | `README.zip` | U |
| OUT-07 | Hidden file | `.env.png` | `to-jpg` | `.env.jpg` (stays hidden; Q-14) | U |
| OUT-08 | Atomic write | kill engine mid-write | — | No half-written final file (write to temp + rename) | I |
| OUT-09 | Existing "(1)" in base | `photo (1).png` → `to-jpg` with `photo (1).jpg` existing | — | `photo (1) (1).jpg` | U |

## 5. Errors, robustness, paths (ERR)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| ERR-01 | Unwritable folder | folder chmod 555 (POSIX, non-root) / read-only folder ACL (Windows) | `to-jpg` | D8: `OUTPUT_NOT_WRITABLE`, friendly message, choke, nothing written, **no** fallback location in v0.1 | I; E2E-33 (skipped as root) |
| ERR-02 | Corrupt input | random bytes named `.png` | `to-jpg` | D6: `INPUT_INVALID` (`TOOL_FAILED` only for unexpected tool failures), choke + `error-message`, no partial output | I; E2E-24 |
| ERR-03 | Zero-byte | empty `.png` | `to-jpg` | Error, choke; app keeps working | I; E2E-34 |
| ERR-04 | Missing input | path deleted between drag and drop | drop | `INPUT_NOT_FOUND`, choke | I; E2E-32 |
| ERR-05 | Cancellation | 30 s 720p video → WEBM | D3: "Spit it out" button on the progress ring (`cancel-job`), Esc when focused, `__ludTest.cancelActive()` (same path), `lud.cancelJob(id)` | `CANCELLED` event, no `done`; ffmpeg child killed (no orphan process); partial output + temp removed; Uncle spits the file back ("Fine, keep it.") and leaves; app converts again afterwards; main kills/restarts the worker if a cancelled job still runs after ~5 s (B-008) | I + R + **E2E-80/81** (`@needs-p2`) + **E2E-82** (IPC path) + M |
| ERR-06 | Cancel race | cancel right after `done` | — | No error, outputs kept | I |
| ERR-07 | Huge input | 250 MB sparse file | `zip` | Struggle visual (UNC-10), completes, memory bounded (streaming), burp sound on done | I (zip) + E2E-78 (`data-uncle-mood=struggle`, sparse 210 MB) + M (visual, sound) |
| ERR-08 | Unicode & spaces | folder `Dossier été 写真 (copy)`, file `mon fichier ñ 😀.png` | `to-webp` | Output with same unicode name | I; E2E-26 |
| ERR-09 | Windows-style paths | `C:\Users\Jürgen\My Pics\a b.png`, `\\server\share\x.png`, `\\?\` long path > 260 chars, trailing dot/space names | conversion | Correct output folder; no path mangling; long paths work (Windows CI + M-WIN) | U (output naming with `path.win32`) + I on Windows CI + M |
| ERR-10 | Leading dash names | input `-version.wav`, `-y.png` | `to-mp3` | ffmpeg receives an absolute path / `file:` prefix → no option injection (SEC-08); a `%` in a name is not an image2 pattern | I; QA-SEC-13..16 |
| ERR-11 | Symlinked input | symlink → png | `to-jpg` | Output next to the **link**, not the target (Q-18) | I |
| ERR-12 | Input is read-only | chmod 444 png | `to-jpg` | Works (input only read) | I |
| ERR-13 | Disk full | small tmpfs (Linux) | big conversion | Friendly error, partial output removed | M / I (Linux only) |
| ERR-14 | Engine crash | kill utilityProcess during job | — | `INTERNAL` error to renderer (choke), engine restarted for the next job | I (Platform engine-host) + E (later) |
| ERR-15 | Tool missing | no ffmpeg anywhere | video job | `TOOL_MISSING` with "reinstall" hint | I |
| ERR-16 | Error message quality | all error codes | trigger each | D6: message ≤ 200 chars, no stack, no absolute paths of internals; `detail` only in logs | U (message table) + E2E-24 |

## 6. The Uncle — states, animation, tracking (UNC)

DOM contract: `[data-testid=overlay-root][data-uncle-state]` ∈ hidden|appear|hover|feedMe|eat|chew|spit|choke|refuse|leave.
`hamster` and `struggle` are **modifiers** of chew. D1: the overlay root exposes
`data-uncle-mood="hamster|struggle|none"` (and keeps `data-hamster` / `data-struggle`). D9: `arm()` alone keeps
`data-uncle-state="hidden"` (sensor only); `dropFiles(known, null)` → `feedMe` with held files; blocked inputs →
`refuse` and no job, even when dropped on an option. D4: the overlay window is created hidden at boot and reused.

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| UNC-01 | hidden | armed sensor | arm only | `data-uncle-state=hidden`, nothing visible | E2E-10 |
| UNC-02 | appear | file dragenter | drag file in | Pops in scale 0.6→1 with overshoot, mouth opens, options fan out; `appear` then `hover` or idle | R + E (screenshot) |
| UNC-03 | hover(option) | appear | dragover an option | Eyes + head lean toward option, bubble enlarges, `hint` label shows | R + M |
| UNC-04 | feedMe | unknown/mixed MIME, or drop on mouth | drop on mouth | "Feed me!" bubble; after drop, options clickable; window focusable only now | E2E-21, E2E-30 |
| UNC-05 | eat | drop on option | — | File icon flies to mouth, jaw snaps, gulp sound | E2E-20 (state order) |
| UNC-06 | chew | job running | — | Chew loop, cheeks bulge, progress ring follows `progress`; ≥ 700 ms (Hungry Mode off) | E2E-20 (≥ 650 ms measured) |
| UNC-07 | Hungry Mode | `hungryMode=true` | fast job | No minimum chew (chew < 650 ms or skipped) | R (reducer) + E2E-74 |
| UNC-08 | Progress -1 | engine reports -1 | — | Indeterminate ring animation | R |
| UNC-09 | hamster | batch ≥ 3 | — | Extra-puffed cheeks during chew; `data-uncle-mood=hamster` while chewing | R + E2E-77 (`@needs-p2`) + M |
| UNC-10 | struggle | any input > 200 MB | — | Sweat drops, slower chew; burp on done; `data-uncle-mood=struggle` while chewing (single small file: `none`, E2E-79) | R + E2E-78 (`@needs-p2`) + M |
| UNC-11 | spit(done) | done | — | Output card with file name + "Saved next to original", happy face | E2E-20 |
| UNC-12 | Card click | spit | click card | `revealPath(output)` → OS reveals the file | M (opens file manager) |
| UNC-13 | choke(error) | error | — | Cough, card bounces back, `error-message` short human text | E2E-24 |
| UNC-14 | refuse | blocked type (any case) | drop on mouth or option | Arms crossed, head shake, `speech-bubble` matches /nope/i ("Nope, not eating that."); no job | E2E-22, E2E-23, E2E-76; Feed Window E2E-55 |
| UNC-15 | leave | after spit/choke/refuse | wait | Leaves 2.5 s after reaction; overlay hidden afterwards (`overlayDone`) | E2E-20, E2E-24 |
| UNC-16 | leave on Esc | appear/hover/feedMe; chew | press Esc | Leaves; no job. During chew (focused): cancels the job like the "Spit it out" button (D3) | R + M |
| UNC-17 | leave on mouseup | appear | release mouse outside options | Leaves; overlay hidden | E2E-11 |
| UNC-18 | Eye tracking | cursor events | send cursor left/right/up/down of the head | Pupils move toward cursor, clamped inside the eye whites; pure function unit-tested (angle, clamp) | R + M |
| UNC-19 | Head parallax | cursor events | move cursor across | Face group offset > head outline offset (3D turn); bounded tilt | R |
| UNC-20 | Smoothing | step change of cursor | — | Spring/lerp converges without oscillation; no jitter when cursor still (offset change < 0.1 px/frame) | R |
| UNC-21 | Look at option | hover option | — | Gaze target = option centre, not raw cursor | R |
| UNC-22 | Alive | visible idle | watch 5 s | Breathing, blinking (random 2–6 s), squash & stretch | M + screenshot diff |
| UNC-23 | The mole | any visible state | inspect SVG | Element group `mole` exists on the cheek near the nose, with one hair path; visible in every non-hidden state incl. choke/refuse | R (SVG structure) + M (art review) |
| UNC-24 | Layered SVG | — | inspect | Groups `head, face, jaw, upperLip, mouthInterior, eyes, pupils, brows, cheeks, mole, moustache, hands` exist | R |
| UNC-25 | Size | — | render at 220 px and 260 px | Reads well; no clipping of options inside the overlay window | M + E screenshots |
| UNC-26 | Plain Mode | `plainMode=true` | full flow | No character (`uncle` absent, `plain-target` shown, `data-plain=true`); animated ring of options; same states/test ids | R + E2E-75 |
| UNC-27 | Sounds | `sounds=true` | full flow | pop-in, gulp, chew loop, whoosh, cough, burp generated with WebAudio; **no audio assets** shipped | R (sound map) + P (no audio files in `out/`) + M |
| UNC-28 | Mute | `sounds=false` | full flow | No AudioContext output | R |
| UNC-29 | 60 fps | chew animation | Performance trace 5 s | No long tasks > 50 ms in overlay renderer during a heavy conversion (engine in utilityProcess) | M / E trace (later) |
| UNC-30 | Screenshots | E2E run | — | Every reached state saved to `test-results/screens/` | E (all flow specs) |

## 7. Trigger logic (TRG) — pure state machine `platform/trigger-logic.ts`

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| TRG-01 | Key before drag | trigger=shift | keydown Shift → mousedown L → move > threshold | arm once | U (Platform) |
| TRG-02 | Key after drag start | trigger=shift | mousedown L → move → keydown Shift | arm once | U |
| TRG-03 | Key alone | — | keydown Shift, no button | no arm | U |
| TRG-04 | Shift-click (no move) | — | Shift + click without movement (Finder/Explorer range select) | no arm (movement threshold, Q-19) | U + M |
| TRG-05 | Other buttons | — | right/middle button drag + Shift | no arm | U |
| TRG-06 | Key repeat | — | many keydown(Shift) without keyup during drag | single arm, no re-arm | U; E2E-12 (double arm) |
| TRG-07 | Left/right modifiers | — | LeftShift / RightShift; LeftAlt / RightAlt; LeftCtrl / RightCtrl; LeftMeta / RightMeta | Both sides arm for the configured key | U |
| TRG-08 | AltGr | trigger=alt, Windows AltGr layout | AltGr while dragging | Defined (Q-20) — no accidental arm when typing | U + M-WIN |
| TRG-09 | Key released mid-drag | armed | keyup before reaching overlay | Defined (Q-21) — conservative: stay armed until mouseup | U |
| TRG-10 | Mouse up without drop | armed | mouseup | disarm → overlay leave → hidden | U; E2E-11 |
| TRG-11 | Wrong key | trigger=alt | Shift + drag | no arm | U |
| TRG-12 | Extra modifiers | trigger=shift | Shift+Ctrl + drag | Defined (Q-22) | U |
| TRG-13 | Trigger change live | — | `setSettings({triggerKey:'alt'})` | Applies without restart | U + E2E-40 (persistence) |
| TRG-14 | Pause gesture | — | — | **Not defined in PLAN** (Q-23); placeholder until defined | — |
| TRG-15 | Missed mouseup | armed, uiohook drops the mouseup (OS drag loop) | no events for N s / buttons not pressed | Watchdog disarms; overlay never stuck (Q-24) | U + M |
| TRG-16 | Hook start failure | uiohook throws on start | boot | `gestureAvailable=false`, reason `hook-failed`; Feed Window works | U + E (later) |
| TRG-17 | Sleep/lock | armed | lock screen / sleep / resume | disarmed on resume | M |
| TRG-18 | Meta on Windows | trigger=meta | Win+drag then release | Start menu may open (OS) → documented limitation | M-WIN |

## 8. Overlay window (OVL)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| OVL-01 | Never steals focus | typing in an editor | arm, show Uncle, leave | Keystrokes keep going to the editor; overlay `isFocused()=false` | E2E-10 (approx. under Xvfb) + M |
| OVL-02 | Focusable only for feedMe | feedMe | drop on mouth | Window becomes clickable/focusable (`setOverlayInteractive(true)`), reverts after leave | E2E-21 + M |
| OVL-03 | Never stuck visible | any flow | finish/abort every way (done, error, refuse, disarm, Esc, renderer crash, engine crash) | Overlay hidden within 2.5 s + leave anim (≤ 10 s in tests) | E2E-11, E2E-20, E2E-22, E2E-24 |
| OVL-04 | Multi-monitor clamping | 2 displays, cursor near edges, secondary left/above primary (negative coords), different scale factors | arm at each edge/corner | Overlay entirely inside the work area of the display under the cursor | U (pure clamp fn, Platform) + M; E2E-14 (single display) |
| OVL-05 | Sensor follows cursor | armed, not engaged | move cursor | Sensor re-centres ~60 Hz; stops following once engaged | U (poll logic) + M |
| OVL-06 | Sensor invisible + drop target | armed | look at screen; drag file over it | Not noticeable (rgba 0.01); receives dragenter (U2) | E (Linux) + M (mac/win) |
| OVL-07 | Click-through when idle | not armed | click where the overlay was | Click reaches the app below (window hidden or ignoring mouse) | M |
| OVL-08 | No taskbar / Alt-Tab / Dock | — | arm | Overlay not in taskbar, Alt-Tab, Mission Control; no Dock icon (LSUIElement) | M + P (Info.plist) |
| OVL-09 | Always on top | fullscreen app / other Space (mac) | arm | Overlay above fullscreen windows, on the current Space | E2E-10 (`isAlwaysOnTop`) + M |
| OVL-10 | Text drags never engage | armed | drag selected text / link / window | Uncle stays hidden (`Files` not in `dataTransfer.types`) | E2E-13 (synthetic) + M |
| OVL-11 | Drop elsewhere unaffected | armed | drop file on Desktop instead | OS drop works normally; overlay leaves | M |
| OVL-12 | DIP coordinates | Windows 150 % scaling, mixed-DPI monitors | arm | Overlay centred on the real cursor (uses `screen.getCursorScreenPoint()`) | M-WIN |
| OVL-13 | Overlay renderer crash | `webContents.forcefullyCrashRenderer()` | arm again | Overlay recreated, works | E (later) |
| OVL-14 | Single overlay | repeated arm/disarm | — | D4: exactly one overlay window, created hidden at boot and reused | E2E-12 |

## 9. Feed Window (FEED)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| FEED-01 | Open | — | tray → Open Feed Window / `openFeedWindow` | Window with `feed-dropzone` visible | E2E-50, E2E-52 + M (tray) |
| FEED-02 | Singleton | feed open | open again | Same window focused, not a second one | E2E-51 |
| FEED-03 | Drop → options → convert | — | drop PNG on an option; drop on the Uncle then pick | Same pipeline as overlay; output next to source; window stays open and returns to `idle` | **E2E-53/54** via `__ludTest.dropFilesOnFeed` (D2, `@needs-p2`) + M |
| FEED-04 | Blocked / mixed / folder | — | drop exe; drop png+pdf; drop folder | refuse ("Nope"); ZIP only; ZIP only | E2E-55 (blocked) + M + R |
| FEED-05 | Fallback auto-offer | gesture unavailable (Wayland / mac permission denied / hook failed) | boot | Feed Window offered (Q-26) | E (later, env-forced) + M |
| FEED-06 | Close ≠ quit | feed open | close it | App keeps running in tray | E (later) + M |
| FEED-07 | Text drop | — | drop text | Ignored, no error | R + M |

## 10. Settings (SET)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| SET-01 | Defaults | empty userData (E2E: `--user-data-dir=<tmp>`, D5; main never calls `app.setPath('userData')`) | boot, read `getSettings()` | `DEFAULT_SETTINGS` | U (settings-store) + E2E-41 |
| SET-02 | Persist | — | toggle sounds/hungryMode/plainMode, set triggerKey=alt, restart | Values kept; DOM controls reflect them | E2E-40 |
| SET-03 | Corrupt JSON | truncated JSON file | boot | App boots, defaults used, file repaired (backup optional), no crash | U + E2E-41 |
| SET-04 | Wrong types / unknown keys | `{triggerKey:'banana', sounds:'yes', evil:...}` | boot | Field-wise fallback, unknown keys dropped (implementation: settings-store validates field by field) | U + E2E-42 |
| SET-05 | Atomic write | kill app during save | reboot | File is old or new, never truncated | U |
| SET-06 | Broadcast | two windows open | change a setting | `settingsChanged` reaches every window | E (later) |
| SET-07 | Launch at login | — | toggle on/off | macOS/Windows login item created/removed; Linux: Q-28 | M |
| SET-08 | IPC validation | — | `setSettings({triggerKey:'banana'})` | Rejected; stored value unchanged | E2E-62 |
| SET-09 | Read-only userData | userData not writable | change a setting | In-memory value used, friendly warning, no crash | U + M |
| SET-10 | Test ids | settings window | — | `setting-<key>` for every key in `Settings` (except `firstRunDone`) | E2E-40 (subset) |

## 11. macOS Accessibility flow (MAC)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| MAC-01 | First run onboarding | fresh install, `firstRunDone=false` | launch | Explains why Accessibility is needed + "Grant" button + "Use Feed Window instead" | M (+ R for the UI) |
| MAC-02 | Request | onboarding | click Grant | `requestAccessibility()` → System Settings › Privacy › Accessibility opens with the app listed | M |
| MAC-03 | Grant | permission granted | return to app | `gestureAvailable=true` without restart, or a clear "restart to enable" (Q-29) | M |
| MAC-04 | Deny | permission denied | — | `gestureUnavailableReason='mac-permission'`; Feed Window offered; app fully usable | M + U |
| MAC-05 | Revoke while running | granted, running | remove permission | No crash; falls back to Feed Window | M |
| MAC-06 | No Dock icon | — | launch | Menu-bar icon only (LSUIElement) | M + P |
| MAC-07 | Menu-bar icon | light + dark menu bar | — | Template icon readable in both | M |

## 12. Linux X11 / Wayland (LNX)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| LNX-01 | Wayland fallback | `XDG_SESSION_TYPE=wayland` (and/or `WAYLAND_DISPLAY` set) | boot | `gestureAvailable=false`, reason `wayland`; uiohook NOT started; Feed Window reachable | U (detection fn) + E (later: env-forced) |
| LNX-02 | X11 gesture | X11 session | real drag from Nautilus + Shift | Uncle appears | M (Linux desktop) |
| LNX-03 | No tray | GNOME without AppIndicator | boot | App still reachable (Q-30: open Feed Window when no tray?) | M |
| LNX-04 | AppImage | — | run AppImage on Ubuntu 22.04/24.04 | Launches (sandbox/FUSE notes documented) | P (smoke) + M |
| LNX-05 | .deb | — | `apt install ./LetUsDrag-*.deb`, launch from menu | Installs, desktop entry, uninstalls cleanly | M |

## 13. Packaging (PKG)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| PKG-01 | Artifacts exist | package job done | list `release/` | mac: `LetUsDrag-<v>-mac-arm64.dmg`, `-mac-x64.dmg`; win: `-win-x64-setup.exe`, `-win-x64-portable.exe`; linux: `.AppImage`, `.deb` | P (`tests/qa/check-artifacts.mjs`) |
| PKG-02 | ffmpeg bundled | unpacked app | check `resources/bin/ffmpeg[.exe]` | Exists, executable, `-encoders` has libx264, libvpx-vp9, libopus, libmp3lame, libvorbis, aac, flac, pcm_s16le, gif, png, mjpeg, bmp | P (package.yml + check-artifacts) |
| PKG-03 | ffmpeg resolution order | packaged app | unset `LUD_FFMPEG_PATH` | Engine uses `resourcesPath/bin/ffmpeg` (not PATH) | I (resolver unit) + M |
| PKG-04 | App launches packaged | unpacked/installed | launch, wait 10 s | Process alive, tray created, no error dialog | P (Linux smoke under Xvfb, later) + M |
| PKG-05 | Native modules load | packaged | convert PNG→JPG, WAV→MP3, PDF→PNG in packaged app | sharp, @napi-rs/canvas, uiohook, onnxruntime load from `app.asar.unpacked` | M (+ E against packaged later) |
| PKG-06 | Notices | unpacked | check resources | `THIRD_PARTY_NOTICES.md`, `FFMPEG-LICENSE.txt` present | P (check-artifacts) |
| PKG-07 | macOS bundle | `.app` | `codesign --verify --deep --strict`, `lipo -archs`, Info.plist `LSUIElement=true` | Ad-hoc signature valid, correct arch | P (package.yml) |
| PKG-08 | No source maps / dev junk | unpacked | list asar | No `*.map`, no `tests/`, no `src/` | P (check-artifacts, asar listing) |
| PKG-09 | Platform-only native bins | unpacked | list `onnxruntime-node/bin` + `uiohook-napi/prebuilds` | Only current platform/arch | P (check-artifacts) |
| PKG-10 | Hooks off in packaged app | packaged | launch without and with `LUD_E2E=1` | D12: `__ludTest` absent in both cases (hooks need `LUD_E2E=1` **and** `!app.isPackaged`); E2E runs the unpackaged build | M / P (packaged smoke, later) |
| PKG-11 | Version | — | About / `app.getVersion()` | Matches `package.json` | M |
| PKG-12 | Sizes | — | artifact sizes | Reported in CI (`ci-logs/sizes.log`); flag > 300 MB | P |

## 14. Security (SEC)

| ID | Area | Preconditions | Steps | Expected | Auto / where |
|---|---|---|---|---|---|
| SEC-01 | Renderer isolation | all windows | probe globals | `window.lud` only; no `require`, `process`, `module`, `Buffer` (contextIsolation + sandbox + no nodeIntegration) | E2E-60 |
| SEC-02 | IPC validation | — | malformed payloads to every invoke channel | Rejected by zod; no job; main survives | E2E-62 + U (Platform ipc.ts, every channel) |
| SEC-03 | revealPath scope | — | `revealPath('/etc/passwd')` / a path never produced by a job | Rejected / no-op | U (Platform) + M |
| SEC-04 | Navigation + popups | any window | `location.href = remote/file URL`, `window.open` | Blocked (`will-navigate` preventDefault, `setWindowOpenHandler` deny) | E2E-61 |
| SEC-05 | CSP | every page | read meta CSP | `script-src 'self'`, no `unsafe-eval` | E2E-63 |
| SEC-06 | Permission requests | renderer | request camera/mic/notifications | Denied by `setPermissionRequestHandler` | E (later) |
| SEC-07 | No network | idle + conversions | monitor sockets (Little Snitch / Wireshark) or renderer requests | No connection except user-initiated Remove-BG model download | E2E-64 (renderers) + M |
| SEC-08 | No shell | — | code review + lint rule; leading-dash file names (ERR-10) | `spawn(file, args, {shell:false})` everywhere | Lint (exists) + I |
| SEC-09 | zip-slip | — | CONV-ZIP-02 | Nothing outside target | I |
| SEC-10 | E2E hooks inactive | no `LUD_E2E` | launch | `globalThis.__ludTest` undefined; `lud:test-drop` ignored by the renderer (D12) | E2E-03 |
| SEC-11 | htmlToPdf sandbox | md/html/docx with `<script>`, remote `<img>`, `file:///etc/passwd` `<img>` | `to-pdf` | JS disabled in the print window, every request except the document and `data:` cancelled, CSP injected (`src/main/html-to-pdf.ts`); engine sanitises first | I (sanitiser) + **E2E-65/66** (beacon: 0 hits, no script effect, no local file embedded) |
| SEC-12 | Symlinks when zipping | folder with link to outside | `zip` | Link not followed | I |
| SEC-13 | Model download integrity | Remove-BG model | download | HTTPS only, SHA-256 verified, partial file removed on failure | I |
| SEC-14 | Second-instance argv | app running | launch with crafted args | No arg is executed/opened as URL | M / E (later) |
| SEC-15 | Temp files | — | run jobs, crash engine | Temp under `os.tmpdir()` via `mkdtemp`, cleaned on success, error and next start | I |
| SEC-16 | Devtools in production | packaged | Ctrl+Shift+I | Disabled/not opened (Q-33) | M |
| SEC-17 | Blocked types | exe, msi, app, dmg, pkg, bat, cmd, sh, com, scr, dll (any case: `.EXE`) | drop | refuse, no job | U (catalog) + E2E-22/23 |
| SEC-18 | CSV formula injection | CONV-DATA-06 | — | No formulas created | I |

### 14.1 QA security fixtures (engine level, `tests/engine/qa-*.test.ts`)

Hostile inputs from `docs/security/CHECKLIST.md`, generated at test time and run through the real engine
(`runOption`, same code as the app's utilityProcess). Assertions are on the **job result and the files on
disk** (nothing written next to/above the input, no partial outputs). The local beacon server
(`tests/helpers/beacon.ts`) counts any HTTP request. Status = result on `develop@a6c0d94`.

| ID | Fixture | Expected | Checklist | File | Status |
|---|---|---|---|---|---|
| QA-SEC-01 | YAML "billion laughs" (9×9 aliases) → JSON/CSV/XLSX | `INPUT_INVALID` < 10 s, nothing written | SEC-90 | qa-input-security | pass |
| QA-SEC-02 | ZIP entries `../evil.txt`, `a/../../evil.txt`, `..\evil.txt`, `/abs-evil.txt`, `C:/evil.txt`, `ok/../../../evil.txt` (after a harmless entry); an absolute path to a real location | `INPUT_INVALID`, nothing created anywhere (not even the harmless entry) | SEC-101 | qa-archive-security | pass |
| QA-SEC-03 | ZIP symlink entry → secret file; two-step "symlink dir, then file through it" | links never materialised; victim folder stays empty | SEC-102 | qa-archive-security | pass |
| QA-SEC-04 | ZIP entries `CON`, `con.txt`, `sub/AUX.log`, `LPT1`, `Com3.tar.gz`, `nul ` (and `safeEntryPath(…, 'win32')`) | refused or renamed: no reserved device name is ever created | SEC-101 | qa-archive-security | **`[needs-p2]` fail** (names created as-is) |
| QA-SEC-05 | ZIP with 256 MiB of zeros in one entry (~1000:1, archive < 1 MB) | `INPUT_INVALID` < 10 s, nothing written | SEC-103 | qa-archive-security | **`[needs-p2]` fail** (extracted: only a 4 GB cap) |
| QA-SEC-06 | SVG (with external `<image href>` to the beacon and `file:///etc/hostname`) renamed `.png` → JPG | zero beacon hits | SEC-40/50 | qa-input-security | pass |
| QA-SEC-07 | same SVG → JPG / WEBP | `INPUT_INVALID` (SVG loader blocked) | SEC-50 | qa-input-security | **`[needs-p2]` fail** (SVG is decoded) |
| QA-SEC-08 | `ffconcat version 1.0 / file private.wav` saved as `song.mp3` → WAV | `INPUT_INVALID`; the referenced local file is not read | SEC-62 | qa-input-security | **`[needs-p2]` fail** (converts `private.wav`) |
| QA-SEC-09 | HLS playlist with an `http://127.0.0.1:<beacon>` segment saved as `.mp3` → WAV | zero beacon hits, `INPUT_INVALID` | SEC-61 | qa-input-security | pass |
| QA-SEC-10 | HLS playlist with a `file://` segment saved as `.mp4` → MP3 | `INPUT_INVALID`, nothing written | SEC-61/62 | qa-input-security | pass |
| QA-SEC-11 | XLSX with an extra 512 MiB entry (deflated to < 1 MB) → CSV | `INPUT_INVALID` < 5 s (pre-scan before exceljs) | SEC-91 | qa-input-security | **`[needs-p2]` fail** (inflated and converted, ~6 s) |
| QA-SEC-12 | FIFO named `pipe.csv` / `pipe.png` / `pipe.wav` (POSIX) | rejected < 5 s without opening the pipe, nothing written | SEC-43 | qa-input-security | pass (code is `UNSUPPORTED`; SEC-43 says `INPUT_INVALID`, both accepted) |
| QA-SEC-13 | `-version.wav` → MP3 | real conversion, output `-version.mp3` decodes | SEC-60, ERR-10 | qa-input-security | pass |
| QA-SEC-14 | `-y.png` → JPG, `-i.csv` → JSON | names kept, outputs valid | ERR-10 | qa-input-security | pass |
| QA-SEC-15 | `-f lavfi -i x.mp4` → GIF; `a%d -x.mp4` → MP3 | converts, GIF/MP3 valid | SEC-60/63 | qa-input-security | pass |
| QA-SEC-16 | `shot%03d.bmp` → PNG (BMP is decoded by ffmpeg) | converts; `%03d` is not an image2 pattern | SEC-63 | qa-input-security | **`[needs-p2]` fail** (image2 expands the pattern → "file not found") |

E2E counterpart for the htmlToPdf adapter (CHECKLIST SEC-82): E2E-65 (HTML) and E2E-66 (Markdown) convert a document
with a meta refresh, `<base>`, stylesheet/`@import`/`@font-face`/inline-style URLs, `<script>` (with `fetch`,
`document.write`), remote `<img>`/`srcset`/`<picture>`, `file://` and remote `<iframe>`s, `srcdoc`, `<object>`, `<embed>`,
`<video poster>`, `<audio>`, SVG `<image>`, `onerror`, `<form>`/`<input type=image>` — all pointing at the beacon or at a
local secret file — and assert: zero beacon hits (with a positive control), the safe text is in the PDF, the script's
text and the secret file's content are not.

## 15. E2E inventory (`tests/e2e/`, run: `npm run build && xvfb-run -a npm run test:e2e`)

All tests use an isolated `--user-data-dir=<tmp>` (D5) and a temp work dir; fixtures are generated at
test time; screenshots of every reached Uncle state go to `test-results/screens/`. The suite runs against
the unpackaged build (`npm run build`), where the hooks exist only with `LUD_E2E=1` (D12).

Tags: `@needs-integration` is historical (all those tests pass since the phase-1 integration).
`@needs-p2` marks tests for phase-2 work in progress (TPM decisions D1–D3 and the `renderPdfPages` host
adapter): they fail on `develop@a6c0d94` **by design** and must turn green after the phase-2 merge. Phase-2
hooks (`dropFilesOnFeed`, `cancelActive`) are called through `tests/e2e/support/p2.ts` (`hookP2`), which fails
with "__ludTest.<name> is not a function (phase-2 hook…)" until Platform ships them.

Useful commands:

```sh
npm run build
LUD_FFMPEG_PATH=/usr/bin/ffmpeg xvfb-run -a npx playwright test        # everything
xvfb-run -a npx playwright test --grep-invert @needs-p2                # what must be green today
xvfb-run -a npx playwright test --grep @needs-p2                       # phase-2 acceptance
LUD_FFMPEG_PATH=/usr/bin/ffmpeg npx vitest run -t "needs-p2"           # engine-level phase-2 acceptance
LUD_E2E_KEEP=1 xvfb-run -a npx playwright test convert                 # keep temp fixtures/userData for debugging
node tests/qa/check-artifacts.mjs [--platform linux --arch x64] [--no-installers]   # after electron-builder
```

The main-process log is attached to every test report (`app-N-log.txt`).

| ID | Spec › title (abridged) | Status on `develop@a6c0d94` |
|---|---|---|
| — | `helpers.spec.ts` › pure helper unit tests (5) | pass |
| E2E-01 | `boot.spec.ts` › main process boots, becomes ready and stays alive | pass |
| E2E-02 | `boot.spec.ts` › test hooks installed when LUD_E2E=1 | pass |
| E2E-03 | `boot.spec.ts` › test hooks NOT installed without LUD_E2E (SEC-10) | pass |
| E2E-04 | `boot.spec.ts` › single-instance lock | pass |
| E2E-10 | `overlay.spec.ts` › arm shows sensor, Uncle hidden, on top, not focused | pass |
| E2E-11 | `overlay.spec.ts` › disarm without drop hides overlay | pass |
| E2E-12 | `overlay.spec.ts` › repeated arm/disarm idempotent | pass |
| E2E-13 | `overlay.spec.ts` › text drag never shows the Uncle (synthetic DOM events) | pass |
| E2E-14 | `overlay.spec.ts` › overlay inside the display | pass |
| E2E-20 | `convert.spec.ts` › PNG→JPG eat→chew→spit, output decodes, chew ≥ 650 ms | pass |
| E2E-21 | `convert.spec.ts` › drop on mouth → feedMe → click option; no-op hidden | pass |
| E2E-22 | `convert.spec.ts` › blocked .exe → refuse, no job | pass |
| E2E-23 | `convert.spec.ts` › blocked .bat dropped on an option still refused | pass |
| E2E-24 | `convert.spec.ts` › corrupt → choke + friendly error, no output | pass |
| E2E-25 | `convert.spec.ts` › collision `(1)`, `(2)`, original untouched | pass |
| E2E-26 | `convert.spec.ts` › unicode + spaces | pass |
| E2E-27 | `convert.spec.ts` › batch each | pass |
| E2E-28 | `convert.spec.ts` › batch merge → 3-page PDF | pass |
| E2E-29 | `convert.spec.ts` › PDF merge | pass |
| E2E-30 | `convert.spec.ts` › mixed batch → only ZIP | pass |
| E2E-31 | `convert.spec.ts` › WAV→MP3 (skipped without ffmpeg) | pass |
| E2E-32 | `convert.spec.ts` › input vanished → choke | pass |
| E2E-33 | `convert.spec.ts` › unwritable folder (skipped as root / Windows) | skipped here (container runs as root) |
| E2E-34 | `convert.spec.ts` › zero-byte file → choke, app still works | pass |
| E2E-35 | `convert-docs.spec.ts` › PDF → PNG pages through the real `renderPdfPages` host adapter (`doc (pages)/`, white, in order) | **@needs-p2** (today `TOOL_MISSING`) |
| E2E-36 | `convert-docs.spec.ts` › PDF → JPG pages through `renderPdfPages` | **@needs-p2** (today `TOOL_MISSING`) |
| E2E-37 | `convert-docs.spec.ts` › HTML → PDF via printToPDF: 3 CSS page breaks → 3 pages, text per page | pass |
| E2E-38 | `convert-docs.spec.ts` › Markdown → PDF: 1 page, heading/list/table text, no `**` | pass |
| E2E-39 | `convert-docs.spec.ts` › DOCX → PDF (mammoth + printToPDF): 1 page, heading/list/table text | pass |
| E2E-40 | `settings.spec.ts` › toggles persist across restart | pass |
| E2E-41 | `settings.spec.ts` › corrupted settings → defaults | pass |
| E2E-42 | `settings.spec.ts` › wrong types / unknown keys sanitised | pass |
| E2E-50 | `feed.spec.ts` › feed window drop zone | pass |
| E2E-51 | `feed.spec.ts` › feed window singleton | pass |
| E2E-52 | `feed.spec.ts` › `lud.openFeedWindow()` from settings | pass |
| E2E-53 | `feed.spec.ts` › `dropFilesOnFeed(png, to-jpg)` → eat → chew → spit, output next to input, back to `idle` | **@needs-p2** (D2 hook missing) |
| E2E-54 | `feed.spec.ts` › `dropFilesOnFeed(png, null)` → feedMe with held file → click WEBP → done | **@needs-p2** |
| E2E-55 | `feed.spec.ts` › blocked `.scr` on the Feed Window → refuse, "Nope", no job | **@needs-p2** |
| E2E-60 | `security.spec.ts` › renderer isolation | pass |
| E2E-61 | `security.spec.ts` › navigation + window.open blocked | pass |
| E2E-62 | `security.spec.ts` › IPC rejects malformed payloads | pass |
| E2E-63 | `security.spec.ts` › strict CSP on every page | pass |
| E2E-64 | `security.spec.ts` › renderers make no remote requests | pass |
| E2E-65 | `security.spec.ts` › HTML → PDF with remote/file resources, `<script>`, meta refresh: 0 beacon hits, no script text, no local file | pass |
| E2E-66 | `security.spec.ts` › same, as Markdown with raw HTML | pass |
| E2E-70 | `convert-media-data.spec.ts` › MP4 → GIF: animated, ≤ 480 px, ≤ 15 fps | pass |
| E2E-71 | `convert-media-data.spec.ts` › MP4 → WEBM: EBML magic, VP9 + Opus, duration | pass |
| E2E-72 | `convert-media-data.spec.ts` › CSV → XLSX: header + rows read back with exceljs | pass |
| E2E-73 | `convert-media-data.spec.ts` › ZIP (png + unicode txt) → Unzip in another folder: byte-identical | pass |
| E2E-74 | `modes.spec.ts` › Hungry Mode: chew < 650 ms (or skipped) after a warm-up job | pass |
| E2E-75 | `modes.spec.ts` › Plain Mode: `data-plain=true`, `plain-target`, no `uncle`, still converts | pass |
| E2E-76 | `modes.spec.ts` › refuse bubble says /nope/i for `.EXE` (mouth), `.dmg` + ZIP, `.sh` + TXT | pass |
| E2E-77 | `modes.spec.ts` › hamster: 3 files → `data-uncle-mood=hamster` while chewing | **@needs-p2** (D1 attribute missing) |
| E2E-78 | `modes.spec.ts` › struggle: sparse 210 MB file → `data-uncle-mood=struggle` while chewing | **@needs-p2** |
| E2E-79 | `modes.spec.ts` › one small file → `data-uncle-mood=none` while chewing | **@needs-p2** |
| E2E-80 | `cancel.spec.ts` › `__ludTest.cancelActive()` during a 30 s 720p → WEBM job: CANCELLED, no partial/temp, no ffmpeg left, Uncle leaves, app converts again | **@needs-p2** (D3 hook missing) |
| E2E-81 | `cancel.spec.ts` › click `[data-testid=cancel-job]` ("Spit it out"): same expectations | **@needs-p2** (D3 button missing) |
| E2E-82 | `cancel.spec.ts` › `lud.cancelJob(jobId)` from the overlay (IPC path under the button): same expectations | pass |

## 16. MANUAL matrix (QA, macOS + Windows)

The product owner's first run on real machines follows the short, numbered
[MANUAL_CHECKLIST.md](MANUAL_CHECKLIST.md). This section is the complete QA matrix (edge cases included)
that the checklist is drawn from.

Record for each item: ✅ / ❌ + OS version + hardware + a screenshot or short note. File every ❌ in
`docs/qa/BUGS.md`. Use a normal (non-admin on Windows) user account. Test files: a PNG photo, a
multi-page PDF, an MP4 clip with sound, a DOCX, a CSV, a ZIP, a folder, and a renamed `.exe`.

### 16.1 macOS (do on Apple silicon; repeat ★ items on an Intel Mac if available)

| ID | Check | Expected |
|---|---|---|
| M-MAC-01 ★ | Open the `.dmg` matching your Mac (arm64 / x64), drag the app to Applications, double-click it | Gatekeeper blocks it ("cannot be opened" / "unidentified developer") — expected for ad-hoc builds |
| M-MAC-02 ★ | Right-click the app → Open → Open (or System Settings › Privacy & Security › "Open Anyway") | App starts; menu-bar icon appears; **no Dock icon** |
| M-MAC-03 | First-run onboarding | Explains Accessibility; "Grant" opens System Settings › Privacy & Security › Accessibility with the app listed |
| M-MAC-04 | Grant permission, return to the app | Gesture works (or the app clearly asks for a restart) |
| M-MAC-05 ★ | In Finder, start dragging a PNG, then hold Shift | The Uncle appears at the cursor, mouth open, options around him; he looks at the file as you move |
| M-MAC-06 | Hold Shift first, then start the drag | Same as above |
| M-MAC-07 ★ | Drop on "JPG" | Eat → chew → spit; card "Saved next to original"; `photo.jpg` appears next to the PNG in Finder |
| M-MAC-08 | Repeat M-MAC-07 | `photo (1).jpg` created, `photo.jpg` untouched |
| M-MAC-09 | Click the output card | Finder reveals the file |
| M-MAC-10 | Drag 3 PNGs → PDF | One PDF with 3 pages; hamster cheeks while chewing |
| M-MAC-11 | Drag an MP4 → GIF, MP3; a PDF → PNG pages; a DOCX → PDF; a CSV → XLSX; a ZIP → Unzip; a folder → ZIP | Each output opens in Preview/QuickTime/Numbers/Finder |
| M-MAC-12 | Drag the renamed `.exe` | Uncle refuses ("Nope, not eating that."), nothing written |
| M-MAC-13 | Select text in TextEdit, drag it with Shift | **No Uncle** |
| M-MAC-14 | Shift-click to multi-select files in Finder (no drag) | **No Uncle** |
| M-MAC-15 | Drag a window by its title bar with Shift | **No Uncle** |
| M-MAC-16 | Start a Shift-drag and release the mouse on the Desktop | Uncle (if shown) leaves; normal Finder drop happens; nothing stuck on screen |
| M-MAC-17 | While typing in Notes, trigger and cancel the Uncle | Typing focus stays in Notes |
| M-MAC-18 | Two displays (one Retina, one external); drag to each corner of each display | Uncle fully visible on the display under the cursor |
| M-MAC-19 | Full-screen app (e.g. Safari full screen) and another Space | Uncle appears above it on the current Space |
| M-MAC-20 | Settings: change trigger to Option; Sounds off; Hungry Mode on; Plain Mode on | Each takes effect immediately and survives quit + relaunch |
| M-MAC-21 | Launch at login on, log out/in | App starts in the menu bar |
| M-MAC-22 | Remove Accessibility permission while running | No crash; Feed Window offered |
| M-MAC-23 | Deny permission from the start; use Feed Window for a PNG → JPG | Works |
| M-MAC-24 | Convert a 300 MB video | Struggle (sweat, slower chew), UI stays smooth, burp on done |
| M-MAC-25 | Sounds on: listen to a whole flow | pop, gulp, chew, whoosh/cough/burp; nothing harsh or too loud |
| M-MAC-26 | Turn Wi-Fi off; do several conversions | All work offline (except Remove BG model download) |
| M-MAC-27 | Art review at normal size | Cartoon style, mole with one hair on the cheek near the nose, breathing/blinking, eyes and head follow the file |
| M-MAC-28 | Quit from the menu-bar icon | App exits; no leftover process in Activity Monitor (incl. ffmpeg) |
| M-MAC-29 | Start a long video → WEBM conversion, click "Spit it out" on the ring while he chews (and once more with Esc) | Uncle spits the file back ("Fine, keep it.") and leaves; no output and no hidden temp file in Finder (Cmd+Shift+. shows hidden files); no ffmpeg left in Activity Monitor (D3) |
| M-MAC-30 | Open the Feed Window from the menu-bar icon; drop a PNG on JPG, a `.exe` on the Uncle | Same eat/chew/spit as the overlay; output next to the PNG; `.exe` refused; window stays open |

### 16.2 Windows 10 and 11 (x64)

| ID | Check | Expected |
|---|---|---|
| M-WIN-01 ★ | Run `LetUsDrag-<v>-win-x64-setup.exe` | SmartScreen "Windows protected your PC" (unsigned) → "More info" → "Run anyway" |
| M-WIN-02 | Installer: per-user, choose directory | Installs without admin rights; Start-menu entry |
| M-WIN-03 | Run the portable `.exe` from Downloads | Starts without installing (SmartScreen again on first run) |
| M-WIN-04 ★ | Tray icon present (check the overflow ^ area) | Menu: Open Feed Window, Settings, Quit |
| M-WIN-05 ★ | In Explorer, drag a PNG and hold Shift | Uncle appears at the cursor, follows the file |
| M-WIN-06 ★ | Drop on JPG | `photo.jpg` next to the PNG; repeat → `photo (1).jpg` |
| M-WIN-07 | Case collision: create `Photo.JPG`, convert `photo.png` → JPG | `photo (1).jpg` — `Photo.JPG` untouched |
| M-WIN-08 | Drag from the Desktop, from a OneDrive folder (online-only file), from a network share | Works or friendly message; OneDrive file downloads first |
| M-WIN-09 | Drag an Outlook attachment / a file from inside a ZIP opened in Explorer | Friendly message or works via temp file; no crash |
| M-WIN-10 | Path with unicode + spaces + > 260 characters | Conversion works; output next to source |
| M-WIN-11 | Display scaling 150 % and a second monitor at 100 % | Uncle centred on the cursor on both monitors, fully visible at edges |
| M-WIN-12 | Text drag from Notepad / browser with Shift | No Uncle |
| M-WIN-13 | Shift-click multi-select in Explorer (no drag) | No Uncle |
| M-WIN-14 | Trigger = Alt; with a layout that has AltGr (e.g. German), type `@` (AltGr+Q) in Notepad | No Uncle, no stuck overlay |
| M-WIN-15 | Trigger = Win key | Works; note whether Start menu opens on release |
| M-WIN-16 | Explorer running as Administrator, drag from it | Document behaviour (UIPI may block); no crash |
| M-WIN-17 | Folder made read-only (Properties → Security deny write) → convert inside it | Friendly "can't save here" message, Uncle chokes |
| M-WIN-18 | Settings persist across quit/relaunch; Launch at login after reboot | As set |
| M-WIN-19 | Video/PDF/DOCX/CSV/ZIP/folder conversions as M-MAC-11 | Outputs open in default apps |
| M-WIN-20 | Antivirus (Defender) scan of install dir | No detection (report false positives) |
| M-WIN-21 | Uninstall via Settings › Apps | Removed; no running process left |
| M-WIN-22 | Cancel a long video conversion with "Spit it out" and with Esc | As M-MAC-29 (Task Manager: no ffmpeg.exe left) |
| M-WIN-23 | Feed Window from the tray: PNG → JPG, `.exe` refused | As M-MAC-30 |

## 17. Contract gaps & open questions (for the TPM)

### 17.1 Resolved by TPM decisions (removed from the open list)

| Former Q | Decision | Where it is now tested |
|---|---|---|
| Q-01 hamster/struggle not assertable | D1 `data-uncle-mood` | UNC-09/10, E2E-77..79 |
| Q-13 partial failure in `each` batches | D7 all-or-nothing, message names the file | BAT-04 |
| Q-15 unwritable folder fallback | D8 `OUTPUT_NOT_WRITABLE`, no fallback | ERR-01, E2E-33 |
| Q-16 code for undecodable input | D6 `INPUT_INVALID` (`TOOL_FAILED` for unexpected failures), ≤ 200 chars | ERR-02, ERR-16, E2E-24 |
| Q-17 cancel UI + hook | D3 "Spit it out" button `cancel-job`, Esc, `cancelActive()`, `CANCELLED`, ~5 s worker kill | ERR-05, E2E-80..82 |
| Q-25 no hook for Feed Window drops | D2 `dropFilesOnFeed(paths, optionId)` | FEED-03/04, E2E-53..55 |
| Q-31 hooks in packaged builds | D12 `LUD_E2E=1` **and** `!app.isPackaged` | PKG-10, SEC-10 |
| Q-34 overlay lifecycle | D4 created hidden at boot, reused | OVL-14, E2E-12 |
| Q-35 userData override | D5 `--user-data-dir` honoured; no `app.setPath('userData')` | SET-01, E2E-40..42 |
| (arm/feedMe/blocked edge cases) | D9 | UNC section intro, E2E-10, E2E-21, E2E-23, E2E-76 |
| (Remove-BG model source) | D10 download on first use, SHA-256 pinned, not mirrored | CONV-IMG-09 |

### 17.2 Answered by the implementation (documented behaviour, no TPM decision)

| Former Q | Behaviour (source) | Tested by |
|---|---|---|
| Q-02 merge output name/folder | `<first input> (merged).pdf` in the first input's folder; several files → `Archive.zip` (`src/engine/output.ts`) | CONV-IMG-06, CONV-PDF-05, CONV-ZIP-08, E2E-73 |
| Q-03 merge order | drop order | CONV-PDF-05 |
| Q-04 pages folder | `name (pages)/page-01.png`…, folder collision `name (pages) (1)/` | CONV-PDF-01/03, E2E-35/36 |
| Q-05 unzip folder | `<zip base>/`, collision `(1)` | CONV-ZIP-01, E2E-73 |
| Q-07 compress naming | `<base>-compressed.<ext>`; original bytes kept if not smaller | CAT-12, CONV-IMG-10 |
| Q-08 JPG flatten colour | white `#ffffff` | CONV-IMG-02 |
| Q-09 animated / multi-page | GIF/WEBP targets keep frames; others first frame / first page | CONV-IMG-13/17 |
| Q-12 zip-bomb limits | today 50 000 entries / 4 GB; CHECKLIST SEC-103 asks ≤ 10 000 / ≤ 2 GB / ratio cap → QA-SEC-05 `[needs-p2]` | CONV-ZIP-05 |
| Q-27 settings sanitising | field by field (`src/main/settings-store.ts`) | SET-04, E2E-42 |
| Q-32 htmlToPdf hardening | JS off, request filter (document + `data:` only), CSP, temp dir, 30 s timeout (`src/main/html-to-pdf.ts`) | SEC-11, E2E-65/66 |

### 17.3 Still open

| ID | Question | Affects |
|---|---|---|
| Q-06 | Hidden files / OS junk (`.DS_Store`, `Thumbs.db`) included when zipping a folder? | CONV-ZIP-07 |
| Q-10 | DOCX→HTML: images inlined as data URIs or written next to the file? | CONV-DOC-02 |
| Q-11 | Non-tabular / nested JSON & multi-document YAML → CSV/XLSX behaviour. | CONV-DATA-03/04/07 |
| Q-14 | Naming for multi-dot / dotfile inputs (`archive.tar.gz` → `archive.tar.zip`?). | OUT-05/07 |
| Q-18 | Output next to a symlink or next to its target? | ERR-11 |
| Q-19 | Drag movement threshold before arming (protects Shift-click). | TRG-04 |
| Q-20 | AltGr handling when trigger = Alt. | TRG-08 |
| Q-21 | Trigger key released mid-drag: stay armed or disarm? | TRG-09 |
| Q-22 | Additional modifiers held (Shift+Ctrl): arm or not? | TRG-12 |
| Q-23 | "Pause gesture" (named in the QA brief) is not defined in PLAN. | TRG-14 |
| Q-24 | Watchdog for a missed mouseup: Platform documents 15 s armed-not-engaged / 10 s released / 60 s idle (`src/main/README.md`); confirm these are the intended product values. | TRG-15, OVL-03 |
| Q-26 | Is the Feed Window opened automatically when the gesture is unavailable? | FEED-05, LNX-01 |
| Q-28 | Launch at login on Linux: Platform writes an XDG autostart entry; confirm this is in scope for v0.1. | SET-07 |
| Q-29 | After granting Accessibility, is a restart required (uiohook started before grant)? | MAC-03 |
| Q-30 | Linux desktops without tray support: how does the user reach Settings/Feed Window? | LNX-03 |
| Q-33 | DevTools disabled in production builds? (CHECKLIST SEC-19, SHOULD) | SEC-16 |
| Q-36 | FIFO / device inputs answer `UNSUPPORTED` ("That's not a regular file."); CHECKLIST SEC-43 asks for `INPUT_INVALID`. Which code? (QA-SEC-12 accepts both.) | QA-SEC-12, ERR-16 |
