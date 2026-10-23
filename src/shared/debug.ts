// Field diagnostics only (src/main/README.md "Field diagnostics"). Main adds DEBUG_RENDERER_ARG to
// the overlay renderer only while diagnostics are on; only then does the preload report the
// window's HTML5 drag events on DEBUG_DRAG_CHANNEL (types and MIME kinds, never file names or
// paths), and only then does main listen to it. Not part of LudApi; not reachable from the page.

export const DEBUG_RENDERER_ARG = '--lud-debug'
export const DEBUG_DRAG_CHANNEL = 'lud:debug-drag'
/** Longest report main accepts on DEBUG_DRAG_CHANNEL (longer ones are cut). */
export const DEBUG_REPORT_MAX = 600
