# Owner test guide: crash reports and update notices

Short, hands-on checks for the product owner, on an **installed** copy of the app (a `.dmg` / `.exe` / `.AppImage`
from CI, not `npm run dev`). The full QA steps are in `MANUAL_CHECKLIST.md` sections S and U.

**Where the app keeps its files (the "settings folder"):**

- macOS: `~/Library/Application Support/Let's Drag!/`
- Windows: `%APPDATA%\Let's Drag!\` (paste it into the Explorer address bar)
- Linux: `~/.config/Let's Drag!/`

To **quit** the app: tray / menu bar icon → **Quit** (closing a window is not enough).

---

## 1. See a test crash report in Sentry

You need access to the Sentry project **wakeup-monster / lets-drag**.

1. Open the app's Settings → Privacy and check that **Send crash reports** is **on** (it is on by default).
2. Quit the app.
3. Create an empty file named `sentry-test.flag` in the settings folder:
   - macOS, in Terminal: `touch ~/Library/Application\ Support/Let\'s\ Drag\!/sentry-test.flag`
   - Windows, in PowerShell: `New-Item "$env:APPDATA\Let's Drag!\sentry-test.flag" -ItemType File`
     (Explorer's "New → Text Document" usually leaves a hidden `.txt` on the end, which does not work.)
4. Start the app (with internet on). The file disappears straight away.
5. Within about a minute, Sentry → **Issues** shows **"Error: Let's Drag! test crash report (sentry-test.flag)"**
   (environment `production`, release `lets-drag@<version>`).
6. Open it and check: no user name, no computer name, no IP address, no file or folder names anywhere (also under
   Breadcrumbs). Tags are only `app.version`, `os`, `arch`, `character`, `channel`, `dodo_env` and the process ones.
7. Opt-out check: turn **Send crash reports** off, quit, create the file again, start. Expect: nothing new in Sentry and
   the file stays there. Turn the setting back on and restart: now the event arrives.

If nothing arrives: the event is sent once, with no retry (nothing is queued on disk). Make sure you were online, then
repeat from step 2.

## 2. Test a soft update ("Update available")

You need to edit `update.json` on the website (`https://letsdrag.wakeupmonster.com/update.json`). Keep a copy of the
original first. Below, "current" is the version shown at the bottom of Settings (e.g. `v0.1.0`).

1. Set `"latest"` to a **higher** version than current (e.g. `"0.2.0"`), leave `"minimum"` at or below current. Save and
   publish.
2. Open Settings → Updates → **Check for updates** (or wait: the app checks 20 to 60 seconds after it starts, then every
   6 hours).
3. Expect: a yellow **Update available: v0.2.0** banner at the top of Settings with **Download** and **Later**; the tray
   menu starts with **Update available**; the next Shift-drag shows "I learned new tricks! Update in Settings." once.
   Converting still works.
4. **Download** opens the website in your browser (never inside the app). **Later** hides the banner for this version.

## 3. Test a forced update ("Please update me")

1. Set `"minimum"` (and `"latest"`) to a **higher** version than current (e.g. both `"0.2.0"`). `"minimum"` must not be
   higher than `"latest"`, or the app ignores the file. Publish, then **Check for updates**.
2. Expect: a red **Update required** banner in Settings (no Later), tray **Update required**, and Shift-drag / the Feed
   Window show **Please update me** with a **Download** button. Nothing converts. **×** and **Esc** still close the Uncle.
3. The block is remembered: quit, go offline, start again. It still says **Please update me**.

## 4. Restore (do not forget)

1. Put the original `update.json` back on the website (`"latest"` = the real current version, `"minimum"` at or below it).
2. In the app: Settings → **Check for updates**. Expect: "You're up to date", and conversions work again.

Notes: if the website sits behind a cache/CDN, a change can take a few minutes to show; check the URL in a browser first.
A broken or unreachable `update.json` never blocks anything: the app keeps what it knew before.
