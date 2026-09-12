// @ts-nocheck
// Shared frame interval for render pacing and animations (~60fps)
export const FRAME_INTERVAL_MS = 16

// Input-priority scheduling: for INPUT_PRIORITY_WINDOW_MS after a real
// keystroke, the render pacer uses INPUT_PRIORITY_FRAME_INTERVAL_MS instead
// of FRAME_INTERVAL_MS, so a typed character never waits out a frame window
// started by a spinner/streaming repaint.
export const INPUT_PRIORITY_FRAME_INTERVAL_MS = 4
export const INPUT_PRIORITY_WINDOW_MS = 50
