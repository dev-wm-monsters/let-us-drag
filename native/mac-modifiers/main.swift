// lud-modifiers: tiny macOS helper for "Let us drag!" (src/main/platform/modifier-probe.ts).
//
// During a Finder drag the app's CGEventTap (uiohook) stops receiving events, so a trigger key
// pressed mid-drag is never seen. The main process runs this helper only while a left-button drag
// is in progress; it polls the modifier state of the login session every 30 ms with
// CGEventSource.flagsState(.combinedSessionState) (CoreGraphics, macOS 10.4+) and prints
//
//   shift=0|1 ctrl=0|1 alt=0|1 meta=0|1
//
// once at start and then only when that line changes. Nothing else is read, printed or logged
// (no other keys, no pointer position). It exits when stdin closes, i.e. with its parent.
//
// Built in CI (.github/workflows/package.yml):
//   swiftc -O -target <arm64|x86_64>-apple-macos12 native/mac-modifiers/main.swift \
//     -o resources/bin/darwin-<arch>/lud-modifiers && codesign -s - <that file>

import CoreGraphics
import Foundation

// Exit as soon as the parent closes our stdin (or dies).
let stdinWatcher = Thread {
  _ = FileHandle.standardInput.readDataToEndOfFile()
  exit(0)
}
stdinWatcher.start()

func bit(_ flags: CGEventFlags, _ mask: CGEventFlags) -> Int {
  return flags.contains(mask) ? 1 : 0
}

var last = ""
while true {
  let f = CGEventSource.flagsState(.combinedSessionState)
  let line = "shift=\(bit(f, .maskShift)) ctrl=\(bit(f, .maskControl)) alt=\(bit(f, .maskAlternate)) meta=\(bit(f, .maskCommand))"
  if line != last {
    last = line
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
  }
  usleep(30_000)
}
