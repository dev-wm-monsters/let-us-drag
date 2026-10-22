#!/usr/bin/env python3
# QA phase 4: real X11 pointer input through the XTest extension (no xdotool in the container).
# Moves the OS pointer and clicks like a user would, so the window manager / X server decides which
# window gets the click (unlike Playwright's CDP input, which always lands in the page it targets).
#
#   python3 -I tests/qa/probes/xtest.py move X Y      # absolute screen coordinates
#   python3 -I tests/qa/probes/xtest.py click X Y     # move, then left button down/up
#   python3 -I tests/qa/probes/xtest.py where         # prints "X Y" of the pointer
#   python3 -I tests/qa/probes/xtest.py raise XID     # XRaiseWindow (no window manager under Xvfb)
# Needs DISPLAY (run under xvfb-run) and libXtst.so.6 / libX11.so.6.
import ctypes
import sys
import time

x11 = ctypes.CDLL('libX11.so.6')
xtst = ctypes.CDLL('libXtst.so.6')
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XFlush.argtypes = [ctypes.c_void_p]
x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x11.XDefaultRootWindow.restype = ctypes.c_ulong
xtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
xtst.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
x11.XQueryPointer.argtypes = [ctypes.c_void_p, ctypes.c_ulong] + [ctypes.c_void_p] * 7

dpy = x11.XOpenDisplay(None)
if not dpy:
    sys.exit('cannot open display')
cmd = sys.argv[1]
if cmd == 'where':
    root = x11.XDefaultRootWindow(dpy)
    r, c = ctypes.c_ulong(), ctypes.c_ulong()
    rx, ry, wx, wy = ctypes.c_int(), ctypes.c_int(), ctypes.c_int(), ctypes.c_int()
    m = ctypes.c_uint()
    x11.XQueryPointer(dpy, root, ctypes.byref(r), ctypes.byref(c), ctypes.byref(rx), ctypes.byref(ry), ctypes.byref(wx), ctypes.byref(wy), ctypes.byref(m))
    print(rx.value, ry.value)
elif cmd == 'raise':
    # Xvfb has no window manager: "always on top" is not enforced, so tests raise a window themselves.
    x11.XRaiseWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XRaiseWindow(dpy, int(sys.argv[2]))
    x11.XFlush(dpy)
else:
    x, y = int(sys.argv[2]), int(sys.argv[3])
    xtst.XTestFakeMotionEvent(dpy, -1, x, y, 0)
    x11.XFlush(dpy)
    if cmd == 'click':
        time.sleep(0.05)
        xtst.XTestFakeButtonEvent(dpy, 1, 1, 0)
        x11.XFlush(dpy)
        time.sleep(0.05)
        xtst.XTestFakeButtonEvent(dpy, 1, 0, 0)
        x11.XFlush(dpy)
x11.XCloseDisplay(dpy)
