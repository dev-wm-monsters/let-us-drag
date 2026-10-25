# Let us drag! v0.1 — hands-on checklist for the product owner

Hi! This is the run on real computers: the parts our robots cannot do (real Finder/Explorer drags,
permissions, SmartScreen, sounds, how the Uncle *feels*). About **45 minutes per OS**.

**How to fill it in:** tick `[x]` when you saw what the "Expect" line says. Anything else: leave it
unticked, write one line under it, and take a screenshot or a 10-second screen recording. Unsure? Leave it
unticked and describe it, that still helps. Send the file back to QA when done (see [Section C](#c-when-something-goes-wrong)).

> **Known issues (already reported, no need to file them again, but do tick/untick so we know what you saw)**
> - **Esc does not stop the chewing** (by design, so the Uncle never steals Esc from your other apps): use the red
>   **×** "Spit it out" button. Esc still works while he *holds* a file you dropped on his mouth. (D19)
> - After you drop a file on the Uncle's **mouth** (not on a bubble), the little file card can **cover the bottom
>   bubbles** (with a picture: ICO and Remove BG; in the **Feed Window** up to four bubbles). Drop straight onto
>   a bubble instead, or press Esc and try again. (QA-P4-02)
>
> Fixed since the last build (just check they pass): Remove BG working every time, the "One-time download"
> text with a percentage, hints and long error cards no longer cut off, a new Shift-drag right after a
> conversion, clicks next to the chewing Uncle reaching the app behind him.

---

## 0. Before you start (both computers)

1. [ ] Download from the draft GitHub release:
   macOS **Apple silicon** (M1–M4): `LetUsDrag-0.1.0-mac-arm64.dmg` · macOS **Intel**: `LetUsDrag-0.1.0-mac-x64.dmg` ·
   Windows: `LetUsDrag-0.1.0-win-x64-setup.exe` (and optionally `…-portable.exe`).
2. [ ] Make a folder **`LUD test`** on the Desktop with:
   `photo.png` + 3 more pictures · a portrait photo (person/pet) for Remove BG · `photo.heic` (Mac, AirDrop from an iPhone, optional) ·
   `document.pdf` (2+ pages) · `clip.mp4` (10–30 s, with sound) · `long.mp4` (2+ min) · `big.mp4` or `.mov` (**> 200 MB**) ·
   `report.docx` · `notes.md` · `data.csv` · `archive.zip` · a folder `My stuff` · `setup.exe` (a text file renamed to `.exe`, it is never run).
3. Note your setup: model, OS version, screens and scaling: ______________________

---

## A. macOS

**Install and first launch**

1. [ ] Open the `.dmg`, drag **Let us drag!** to **Applications**, double-click it there.
   Expect: macOS blocks it ("cannot be opened" / "Apple could not verify…"). That is normal for a free app without an Apple certificate.
2. [ ] Open it anyway. **macOS 14 or older:** right-click (Control-click) the app → **Open** → **Open**.
   **macOS 15 or newer:** click **Done**, then **System Settings → Privacy & Security**, scroll down, **Open Anyway**, confirm with your password, then **Open**.
   Expect: a small Uncle icon in the **menu bar**, **no Dock icon**, a welcome window. (If macOS says the app "is damaged": untick and send a screenshot.)
3. [ ] In the welcome window click **Grant** → System Settings → Accessibility opens with **Let us drag!** listed. Switch it on.
   Expect: back in the app, Settings says the gesture is ready **without restarting the app**. (If it asks for a restart, note it.)
4. [ ] Check **System Settings → Privacy & Security → Input Monitoring**. Expect: Let us drag! is **not** needed there.

**The gesture (Finder)**

5. [ ] In Finder, start dragging `photo.png`, then **hold Shift**. Expect: the Uncle pops up at the pointer, mouth open, bubbles around him.
6. [ ] Move around him, hover a bubble. Expect: **head and eyes follow the file**, he looks at the hovered bubble, the bubble grows with a hint; he blinks and breathes; the **mole with one hair** is visible.
7. [ ] Drop on **JPG**. Expect: gulp → chewing with a ring → card "Saved next to original"; `photo.jpg` next to the PNG; he leaves after ~2.5 s.
   Also expect: **Finder stays the active app** while you drop (its title bar does not grey out).
8. [ ] Repeat 7, then click the card. Expect: `photo (1).jpg` (the first file untouched); Finder shows the file.
9. [ ] After 7, type something in Finder's search field right away. Expect: the typing goes to Finder (the Uncle did not keep the keyboard).
   Also, while the "Saved" card is still showing, **Shift-drag the next file**: Expect the Uncle comes back at once (the card disappears) and the new drop converts.
10. [ ] Hold **Shift first**, then drag. Expect: same as 5.
11. [ ] Shift-drag selected text from Safari, a window by its title bar, and Shift-click files without dragging. Expect: **no Uncle** each time.
12. [ ] Shift-drag a file and drop it on the Desktop instead. Expect: normal Finder move; nothing stays on screen.

**Conversions** (Shift-drag each onto the named bubble; results appear next to the original and open in Preview/QuickTime/Numbers)

13. [ ] `clip.mp4` → **GIF**, then `clip.mp4` → **MP3** (from the Desktop, not a Finder window). Expect: a moving GIF, an MP3 with sound.
14. [ ] `document.pdf` → **PNG** (folder `document (pages)`), `document.pdf` → **TXT**, `report.docx` → **PDF**, `notes.md` → **PDF**, `data.csv` → **XLSX**, `archive.zip` → **Unzip**, `My stuff` → **ZIP**, `photo.heic` → **JPG**. Expect: all work.
15. [ ] Select 3+ pictures → **PDF**. Expect: puffed "hamster" cheeks ("nom ×3"), one PDF with all pages.
16. [ ] `big.mp4` (> 200 MB) → **Compress**. Expect: he sweats and chews slower; the Mac stays smooth; burp at the end (sounds on).
    **While he chews (click-through):**
    a. [ ] Click a file or desktop icon **right next to him** (inside the square area around him, not on the ring's × button). Expect: the click reaches Finder/the desktop (the icon gets selected), as if he were not there.
    b. [ ] Click **on his face/belly** too. Expect: the same, the click goes to what is behind him (only the × button and the result card are clickable).
    c. [ ] Look at Finder's title bar and type in its search field. Expect: Finder **stays the active app** the whole time and gets the typing.
    d. [ ] Move the pointer slowly over the red **×** and off again a few times. Expect: no flicker, he keeps chewing; the × reacts when the pointer is on it.
17. [ ] **Remove BG, first time:** your portrait photo → **Remove BG**. Expect: the hint mentions a one-time 179 MB download; under the ring the text **"One-time download of my scissors (179 MB AI model) · N%"** counts up, then "Finding the subject…"; `…-nobg.png` with a transparent background.
    **Intel Mac:** this uses the slower built-in engine, expect up to ~30 s. Then Remove BG on **three more** photos, one after another, and once on 3 photos at the same time. Expect: every one works (no "stopped unexpectedly").
18. [ ] `long.mp4` → **WEBM**. While he chews, **click into another app** (e.g. a TextEdit window) so it is in front, then click the red **×** ("Spit it out") **once**. Expect: that **first click** cancels (no extra click needed): "Fine, keep it.", he leaves, **no** `long.webm`. Note if it needed two clicks.
    Then Shift-drag `photo.png` and drop it on his **mouth** (not on a bubble): he holds it ("Pick an option · Esc to cancel"). Press **Esc**. Expect: he lets go and leaves, nothing created; **click once in Finder and type**: Finder gets the keys.
    Then convert `photo.png` → **JPG** while another app is in front, and **click the "Saved" card once**. Expect: Finder shows the file on the first click.
19. [ ] `setup.exe` onto him and onto a bubble. Expect: arms crossed, "Nope, not eating that.", nothing created.

**Windows of the app and the menu bar**

20. [ ] Over a **full-screen** app (e.g. Safari in full screen, or Keynote presenting): Shift-drag a file from a Finder window there. Expect: the Uncle appears **above** the full-screen app.
21. [ ] Two screens? Shift-drag near each corner of each screen. Expect: he is always fully visible on the screen under the pointer.
22. [ ] Menu bar icon → **Open Feed Window**, and → **Settings…**, while another app is in front. Expect: each window **comes to the front**.
23. [ ] Feed Window: drop `photo.png` on it (no Shift) → **WEBP**; drop `setup.exe`. Drop a file on the Uncle, then press **Esc**. Expect: converts; `.exe` refused; Esc puts the held file back; window stays open. (While he holds the file, some bubbles may be hidden under the file card: known QA-P4-02.)
24. [ ] With the app running, double-click it again in **Finder/Applications**. Expect: the **Settings** window opens (no second icon).
25. [ ] Settings: trigger key **Option**; Shift-drag (nothing), Option-drag (Uncle). Sounds off/on (pop, gulp, crunch, whoosh; nothing harsh). **Hungry Mode** (instant gulp). **Plain Mode** (simple ring, no character, still converts). Turn Plain/Hungry off again.
26. [ ] Quit from the menu bar, start again. Expect: all settings kept.
27. [ ] **Launch at login** on → log out and in. Expect: the menu-bar icon is back; **System Settings → General → Login Items** lists it.
28. [ ] Wi-Fi off: repeat two conversions from 14. Expect: they work offline.
29. [ ] Accessibility **off** in System Settings while the app runs. Expect: no crash; Settings says it needs Accessibility; the Feed Window still works. Switch it back **on**: the gesture works again without restarting the app.
30. [ ] *(Next update only)* After installing a newer build over this one, does the gesture still work? If not: remove Let us drag! from the Accessibility list (–), add it again, switch on. Note what you had to do.
31. [ ] Quit, check **Activity Monitor** for "Let us drag" / "ffmpeg". Expect: nothing left.

**Uncle on macOS, 1–5 and why** (cartoon look, liveliness, mole, head turn): ______

---

## B. Windows 10 / 11

**Install and first launch**

1. [ ] Run `LetUsDrag-0.1.0-win-x64-setup.exe`. Expect: blue **"Windows protected your PC"** (SmartScreen). Normal for a free app without a paid certificate.
2. [ ] **More info → Run anyway**, keep the defaults. Expect: installs **without** an admin prompt; Start-menu entry "Let us drag!".
3. [ ] Start it. Expect: tray icon (check the **^** overflow near the clock), welcome window. The tray icon looks **sharp**, not blurry (also at 125/150 % scaling).
4. [ ] Right-click the tray icon. Expect: Open Feed Window, Settings…, Pause gesture, Quit. Each window opens **in front** of other apps.

**The gesture (Explorer)**

5. [ ] In Explorer, drag `photo.png` and **hold Shift**. Expect: Uncle at the pointer, bubbles around him.
6. [ ] Hover a bubble. Expect: head and eyes follow; mole with one hair visible.
7. [ ] Drop on **JPG**, then again. Expect: `photo.jpg`, then `photo (1).jpg`; clicking the card **once** opens Explorer at the file. Typing right after goes to the app you were in (Explorer's title bar never greys out).
   Also, while the "Saved" card is still showing, **Shift-drag the next file**: Expect the Uncle comes back at once and the new drop converts.
8. [ ] Shift-drag text from Notepad/a browser; Shift-click files without dragging. Expect: no Uncle.
9. [ ] Drag a file over an app started **as administrator** (e.g. an admin Command Prompt or Task Manager). Expect: the Uncle may **not** react while the pointer is over that window (Windows blocks it); everything works again over normal windows. Just note what you saw.
10. [ ] **Mixed scaling / two screens** (e.g. laptop 150 % + monitor 100 %): Shift-drag near each corner of each screen. Expect: Uncle centred on the pointer, sharp, fully visible.

**Conversions** (results next to the original; they open in their usual apps)

11. [ ] `clip.mp4` → **GIF** and → **MP3** (from the Desktop).
12. [ ] **In the installed app:** `document.pdf` → **PNG** (folder `document (pages)`) and → **TXT**. Expect: both work (these failed on Windows before).
13. [ ] `report.docx` → **PDF**, `notes.md` → **PDF**, `data.csv` → **XLSX**, `archive.zip` → **Unzip**, `My stuff` → **ZIP**.
14. [ ] 3+ pictures → **PDF** (hamster cheeks, one PDF); `big.mp4` → **Compress** (sweating, Windows stays responsive).
    **While he chews (click-through):**
    a. [ ] Click a desktop icon / file **right next to him** and **on him**. Expect: the click reaches what is behind him (the icon gets selected); only the × and the result card are clickable.
    b. [ ] Type in the Explorer search box. Expect: Explorer keeps the keyboard; its title bar stays active.
    c. [ ] Move the pointer over the red **×** and off again a few times. Expect: no flicker; the × reacts when the pointer is on it.
    d. [ ] *(If you have one)* do the same with the pointer over an app started **as administrator** behind him: note if anything is odd (Windows may block the pointer tracking there).
15. [ ] **Remove BG, first time** on your portrait photo. Expect: under the ring **"One-time download of my scissors (179 MB AI model) · N%"** counts up, then `…-nobg.png` with a transparent background. Then Remove BG on **three more** photos one after another and on 3 photos at once: every one works.
16. [ ] `long.mp4` → **WEBM**. While he chews, **click into another app** (e.g. Notepad) so it is in front, then click **×** "Spit it out" **once**. Expect: the **first click** cancels: "Fine, keep it.", no `long.webm`, no `ffmpeg.exe` left in Task Manager. Note if it needed two clicks.
    Then drop `photo.png` on his **mouth**, press **Esc**; click once in Explorer and type. Expect: Explorer gets the keys.
17. [ ] `setup.exe` onto him. Expect: "Nope, not eating that.", nothing created, nothing run.

**Settings and lifecycle**

18. [ ] Feed Window: drop `photo.png` → **WEBP**; drop `setup.exe`. Expect: converts; refused; window stays open.
19. [ ] Settings: trigger key **Alt** (Shift-drag nothing, Alt-drag Uncle); Sounds, Hungry Mode, Plain Mode as in A.25.
20. [ ] Start the app again from the Start menu while it runs. Expect: the Settings window opens.
21. [ ] Quit from the tray, start again. Expect: settings kept.
22. [ ] **Launch at login** on → restart Windows. Expect: tray icon after login.
23. [ ] *(Optional)* Portable `.exe` from Downloads (SmartScreen again → More info → Run anyway). Expect: works like the installed app.
24. [ ] Quit; Task Manager shows no "Let us drag!" / `ffmpeg.exe`. Then **Settings → Apps → Installed apps → Let us drag! → Uninstall**. Expect: removed.

**Windows-only checks from the code review** (things CI cannot see; just note what happens)

25. [ ] After **every** Shift-drop (step 5/7), the **original file is still where it was** (Shift in Explorer means "move"; the Uncle must only ever copy).
26. [ ] After clicking a result card or the red × (step 7/16): the window you were in keeps its **active title bar**; nothing else (taskbar, another window) jumps to the front. While the Uncle offers options after a drop on his **mouth**, he never appears as a button on the **taskbar** (B-077).
27. [ ] Trigger key **Windows key** (Settings): Win-drag a file, drop, release the key. Note whether the **Start menu opens** after release (Windows does this when the key is pressed and released alone; the app cannot prevent it without faking key presses). Then press **Win+L**, log back in, and drag a window by its title bar **without** any key: the Uncle must **not** appear (B-078).
28. [ ] Trigger key **Alt**: after an Alt-drop, note whether Explorer shows its menu/key tips when you release Alt. Trigger **Ctrl**: the drop still converts (no "link"/"shortcut" created).
29. [ ] **Mixed scaling** (step 10) once more with **diagnostics on**: put an empty `debug.flag` in `%APPDATA%\Let us drag!`, do one drag that crosses from one screen to the other while holding Shift, quit, send `%APPDATA%\Let us drag!\logs\debug.log`. We look for `follow: setBounds … scale=` lines whose size stays 560×560 (Electron can mis-size a window moved between screens with different scaling).
30. [ ] Press **Alt+Tab** while the Uncle (or a result card) is visible: note whether a "Let us drag!" entry appears.
31. [ ] *(If you use a left-handed mouse setup — buttons swapped)* Shift-drag with the button you normally drag with: note whether the Uncle appears (the global hook may see the physical button).
32. [ ] A file on a **network share** (`\\server\share\photo.png`) and a OneDrive file that is **"online-only"** (cloud icon) → JPG. Expect: converts (OneDrive downloads it first) or a friendly error; no hang. A file inside `C:\Program Files\…` → JPG: a friendly "can't save here" message.
33. [ ] Cancel a long conversion (step 16), then check **Task Manager → Details** for a leftover `ffmpeg.exe`; also delete the source folder afterwards (no "file in use" error).

**Uncle on Windows, 1–5 and why:** ______

---

## C. When something goes wrong

**Logs.** The app writes no log files on its own. To capture one, quit the app (tray/menu bar → Quit), then start it from a terminal, repeat the problem, quit, and attach the file:

- **macOS** (Terminal):
  `LUD_DEBUG=1 "/Applications/Let us drag!.app/Contents/MacOS/Let us drag!" > ~/Desktop/lud-log.txt 2>&1`
- **Windows** (Command Prompt; right-click the Start-menu entry → *Open file location* to find the folder):
  `set LUD_DEBUG=1` then `"Let us drag!.exe" > "%USERPROFILE%\Desktop\lud-log.txt" 2>&1`
  (If the file stays empty on Windows, just send the screen recording.)

Settings live in `~/Library/Application Support/Let us drag!/settings.json` (macOS) and
`%APPDATA%\Let us drag!\settings.json` (Windows); the Remove BG model is in the `models` folder next to it.

**Reporting a bug.** One line per problem under the step, plus:
1. what you did (step number + file type), 2. what you expected, 3. what happened (exact message on the Uncle's card),
4. screenshot or 10-second recording, 5. the log file if you made one, 6. computer + OS version + screens/scaling.
Send the filled-in checklist to QA; each unticked step becomes an entry in `docs/qa/BUGS.md`.

Thank you!
