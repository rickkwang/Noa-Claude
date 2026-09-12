// @ts-nocheck
// Shared frame interval for render pacing and animations (~60fps)
export const FRAME_INTERVAL_MS = 16

// Input-priority scheduling: a real keystroke arms an INPUT_PRIORITY_WINDOW_MS
// window in which the pacer's next frame waits at most
// INPUT_PRIORITY_FRAME_INTERVAL_MS instead of FRAME_INTERVAL_MS, so a typed
// character never waits out a frame window started by a spinner/streaming
// repaint. The window buys one frame and is consumed by it — each keystroke
// in a typing burst re-arms it. See frame-pacer.ts.
export const INPUT_PRIORITY_FRAME_INTERVAL_MS = 4
export const INPUT_PRIORITY_WINDOW_MS = 50
