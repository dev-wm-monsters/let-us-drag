# Let us drag! — Manual checklist for the product owner (v0.1)

Hi! This is the hands-on run on real computers: the parts our robots can't check (real Finder/Explorer
drags, macOS permissions, SmartScreen, sounds, how the Uncle *feels*). Plan about **45 minutes per OS**.

**How to fill it in.** Mark each step ✅ (as described) or ❌ (anything else), and jot a short note:
what you saw, plus a screenshot or a 10-second screen recording for every ❌. Unsure? Mark ❌ and describe
it, that's still useful. When you're done, send the filled-in file back to QA. Each ❌ becomes a bug in
`docs/qa/BUGS.md`.

Run it once on **macOS** (Part A) and once on **Windows 10 or 11** (Part B). Use a normal user account
(on Windows, not an administrator account if you have one).

---

## 0. Before you start (both OSes)

1. Download the installers from the draft GitHub release:
   - macOS: `LetUsDrag-0.1.0-mac-arm64.dmg` for Apple silicon (M1/M2/M3/M4), or `LetUsDrag-0.1.0-mac-x64.dmg` for Intel.
   - Windows: `LetUsDrag-0.1.0-win-x64-setup.exe` (installer). The portable `.exe` is optional, see B.20.
2. Make a folder **`LUD test`** on your Desktop and put these in it (any content is fine):

   | File | Tip |
   |---|---|
   | `photo.png`, plus 3 more pictures (`.jpg`/`.png`) | screenshots work |
   | `photo.heic` *(Mac only, optional)* | AirDrop one from an iPhone |
   | `document.pdf` with 2+ pages | |
   | `clip.mp4`, 10–30 s **with sound** | a phone video |
   | `long.mp4`, 2+ minutes | for the cancel test |
   | `big.mov` or `big.mp4`, **larger than 200 MB** | |
   | `report.docx`, `notes.md` (or `.txt`), `data.csv` | |
   | `archive.zip` | zip any 2–3 files |
   | a folder `My stuff` with a few files | |
   | `setup.exe`: a text file renamed to `.exe` | it is never run, only refused |

3. Write down: computer model, OS version, display setup (one or two screens, scaling).

| Computer / OS / displays | |
|---|---|
| macOS: | |
| Windows: | |

---

## Part A — macOS

| # | Do this | You should see | ✅/❌ | Notes |
|---|---|---|---|---|
| A.1 | Open the `.dmg`, drag **Let us drag!** into **Applications**, then double-click it in Applications. | macOS blocks it ("cannot be opened", "Apple could not verify…" or similar). That's expected for a free app without an Apple certificate. | | |
| A.2 | **Right-click** (or Control-click) the app → **Open** → **Open**. On macOS 15 Sequoia or later, if there is no Open button: click **Done**, go to **System Settings → Privacy & Security**, scroll down, click **Open Anyway** for Let us drag!, confirm with your password. | The app starts. A small Uncle icon appears in the **menu bar** (top right). **No icon in the Dock.** A welcome window explains the trick. | | If macOS says the app "is damaged", mark ❌ and send a screenshot. |
| A.3 | In the welcome window, read the Accessibility explanation and click **Grant**. | **System Settings → Privacy & Security → Accessibility** opens and lists **Let us drag!** | | |
| A.4 | Switch it **on** (password if asked) and go back to the app's Settings window. | It says access is granted / the drag gesture is ready (or clearly asks you to restart the app; then restart it and note that). | | |
| A.5 | In **Finder**, open `LUD test`. Start dragging `photo.png` and, while dragging, **hold Shift**. | The Uncle pops up at the mouse pointer, mouth wide open, format bubbles (JPG, WEBP, PDF…) around him. | | |
| A.6 | Keep dragging slowly around him, then hover over a bubble. | His **eyes and head follow the file** smoothly; over a bubble he looks at it and the bubble grows with a label. He blinks and breathes, and you can see his **mole with one hair**. | | |
| A.7 | Drop the PNG on **JPG**. | He gulps, chews (with a progress ring), then tosses a card "Saved next to original". `photo.jpg` appears next to `photo.png`. He leaves after a moment. | | |
| A.8 | Do A.7 again. Then click the card while it's visible. | Now `photo (1).jpg`; `photo.jpg` is untouched. Clicking the card shows the file in Finder. | | |
| A.9 | Hold **Shift first**, then start dragging a picture. | Same as A.5. | | |
| A.10 | Drag from the **Desktop** (not a Finder window): drag `clip.mp4` + Shift → **GIF**. Then `clip.mp4` → **MP3**. | `clip.gif` (moves) and `clip.mp3` (plays with sound) next to the video. | | |
| A.11 | Each with Shift-drag: `document.pdf` → **PNG**, `report.docx` → **PDF**, `notes.md` → **PDF**, `data.csv` → **XLSX**, `archive.zip` → **Unzip**, the `My stuff` folder → **ZIP**, `photo.heic` → **JPG** (if you have one). | Each result appears next to the original and opens in Preview / Numbers / Finder. PDF pages land in a folder `document (pages)`. | | Note any that fail. |
| A.12 | Select **3 or more pictures**, Shift-drag them all → **PDF**. | Extra-puffy "hamster" cheeks while he chews; one PDF with all pages. | | |
| A.13 | Shift-drag `big.mov` (> 200 MB) → **MP4** or **Compress**. | He sweats and chews slower; when done, a burp (if sounds are on). The pointer and other apps stay smooth. | | |
| A.14 | Shift-drag `long.mp4` → **WEBM**. While he chews, click **Spit it out** on the ring. Repeat, and this time press **Esc** instead. | He spits the file back ("Fine, keep it.") and leaves. **No** `long.webm` (or half file) appears. | | |
| A.15 | Shift-drag `setup.exe` onto him (and once onto a bubble, if any). | He crosses his arms, shakes his head: "Nope, not eating that." Nothing is created. | | |
| A.16 | Shift-drag selected **text** from TextEdit or Safari; Shift-drag a **window** by its title bar; **Shift-click** several files in Finder (no drag). | **No Uncle** in any of these. | | |
| A.17 | Start a Shift-drag of a file and drop it on the **Desktop** instead of the Uncle. | Normal Finder move/copy; the Uncle (if he appeared) goes away. Nothing stuck on screen. | | |
| A.18 | Type in Notes, Shift-drag a file across the screen and release it anywhere, then keep typing. | Your typing still goes into Notes. | | |
| A.19 | *(If you have two screens)* Shift-drag a file near each corner of each screen. | The Uncle is always fully visible on the screen under the pointer. | | |
| A.20 | Menu-bar icon → **Open Feed Window**. Drag `photo.png` (no Shift needed) onto the window, choose **WEBP**. Drop `setup.exe` on it too. | The Uncle in the window eats and spits `photo.webp` next to the PNG; `setup.exe` is refused. The window stays open. | | |
| A.21 | Menu-bar icon → **Settings…**: change the trigger key to **Option**, then Shift-drag a file, then Option-drag a file. | Shift no longer summons him; **Option** does. | | |
| A.22 | Turn **Sounds** off and do a conversion; turn it back on and do one more (use **Test sound** if you like). | Silent when off. When on: pop, gulp, crunchy chewing, whoosh, nothing harsh or too loud. | | |
| A.23 | Turn **Hungry Mode** on and convert a small picture. | He gulps it instantly (no slow chewing). | | |
| A.24 | Turn **Plain Mode** on and convert a picture. | No character, just a simple animated ring of options; still works. Turn Plain Mode off again. | | |
| A.25 | Turn **Launch at login** on, log out and back in. | The app starts by itself (menu-bar icon). | | |
| A.26 | Turn Wi-Fi off and repeat two conversions from A.11. | Everything still works offline. | | |
| A.27 | Menu-bar icon → **Quit**. Check **Activity Monitor** for "Let us drag" or "ffmpeg". | The app closes completely; no leftover processes. | | |
| A.28 | *(Optional)* System Settings → Accessibility: switch Let us drag! **off**, start the app. | No crash; the app says it needs Accessibility and offers the Feed Window, which still works. | | |
| A.29 | Uninstall: drag the app from Applications to the Trash; remove it from the Accessibility list. | Gone; nothing left running. | | |

**Overall impression of the Uncle on macOS** (cartoon look, liveliness, the mole, head/eye following — 1 to 5 and why):

> 

---

## Part B — Windows 10 / 11

| # | Do this | You should see | ✅/❌ | Notes |
|---|---|---|---|---|
| B.1 | Run `LetUsDrag-0.1.0-win-x64-setup.exe`. | Blue **"Windows protected your PC"** screen (SmartScreen). Expected: the app has no paid certificate. | | |
| B.2 | Click **More info** → **Run anyway**. Go through the installer (keep the defaults). | Installs **without** asking for admin rights; a Start-menu entry "Let us drag!" exists. | | |
| B.3 | Start it from the Start menu. | A tray icon appears (look in the **^** overflow near the clock). A welcome window explains the trick. | | |
| B.4 | Right-click the tray icon. | Menu: Open Feed Window, Settings…, Pause gesture, Quit. | | |
| B.5 | In **File Explorer**, open `LUD test`. Start dragging `photo.png` and, while dragging, **hold Shift**. | The Uncle pops up at the pointer, mouth open, format bubbles around him. | | |
| B.6 | Move around him and hover a bubble. | **Eyes and head follow the file** smoothly; he looks at the hovered bubble; he blinks, breathes, mole with one hair visible. | | |
| B.7 | Drop on **JPG**; then do it again. | `photo.jpg` next to the PNG, then `photo (1).jpg`; the first one untouched. Card "Saved next to original"; clicking it opens Explorer at the file. | | |
| B.8 | Drag from the **Desktop**: `clip.mp4` + Shift → **GIF**, then → **MP3**. | `clip.gif` and `clip.mp3` next to the video; both play. | | |
| B.9 | Each with Shift-drag: `document.pdf` → **PNG**, `report.docx` → **PDF**, `notes.md` → **PDF**, `data.csv` → **XLSX**, `archive.zip` → **Unzip**, `My stuff` folder → **ZIP**. | Each result next to the original, opens in its usual app. PDF pages in a folder `document (pages)`. | | |
| B.10 | Select 3+ pictures, Shift-drag them → **PDF**. | Hamster cheeks while chewing; one PDF with all pages. | | |
| B.11 | Shift-drag `big.mp4` (> 200 MB) → **Compress**. | Sweating, slower chew, burp at the end; Windows stays responsive. | | |
| B.12 | Shift-drag `long.mp4` → **WEBM**; click **Spit it out** while he chews. Repeat with **Esc**. | He gives the file back ("Fine, keep it.") and leaves; no `long.webm`. Task Manager shows no leftover `ffmpeg.exe`. | | |
| B.13 | Shift-drag `setup.exe` onto him. | "Nope, not eating that." Nothing created, nothing run. | | |
| B.14 | Shift-drag text from Notepad or a browser; Shift-click several files in Explorer (no drag). | **No Uncle.** | | |
| B.15 | *(If you use display scaling 125 %/150 %, or two screens)* Shift-drag a file near each corner of each screen. | The Uncle is centred on the pointer and fully visible. | | |
| B.16 | Tray → **Open Feed Window**; drop `photo.png` on it → **WEBP**; drop `setup.exe`. | Converts next to the PNG; `.exe` refused; window stays open. | | |
| B.17 | Tray → **Settings…**: trigger key **Alt**; Shift-drag (nothing), Alt-drag (Uncle). Sounds off/on, Hungry Mode, Plain Mode as in A.22–A.24. | Each setting works right away. | | |
| B.18 | Quit from the tray, start again from the Start menu. | All your settings are still there. | | |
| B.19 | Turn **Launch at login** on and restart Windows. | The tray icon is there after login. | | |
| B.20 | *(Optional)* Run the portable `LetUsDrag-0.1.0-win-x64-portable.exe` from Downloads (SmartScreen again → More info → Run anyway). | Starts without installing; works like the installed app. Quit it afterwards. | | |
| B.21 | Tray → **Quit**; check Task Manager. | Fully closed, no "Let us drag!" or `ffmpeg.exe` left. | | |
| B.22 | **Settings → Apps → Installed apps → Let us drag! → Uninstall.** | Removed; Start-menu entry gone; nothing left running. | | |

**Overall impression of the Uncle on Windows** (1 to 5 and why):

> 

---

## Anything else?

Bugs, surprises, ideas: anything goes. For anything that looked wrong, a screen recording helps most
(the app keeps no log files in normal use).

> 

Thank you!
