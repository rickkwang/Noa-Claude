// Frame pacing for the Ink renderer.
//
// Normal commits paint at FRAME_INTERVAL_MS cadence (~60fps). A real
// keystroke arms an INPUT_PRIORITY_WINDOW_MS window in which the pacer's next
// frame waits at most INPUT_PRIORITY_FRAME_INTERVAL_MS, so a typed character
// never waits out a frame window started by a spinner/streaming repaint.
//
// The window is one-shot: the first frame it buys consumes it. Typing is a
// stream of keystrokes and each re-arms the window for its own frame, so
// continuous input still gets continuous priority — the alternative (a fixed
// 50ms of 4ms cadence per keystroke) would hold streaming repaints at 250fps
// long after the keystroke that justified them has painted.

import {
  FRAME_INTERVAL_MS,
  INPUT_PRIORITY_FRAME_INTERVAL_MS,
  INPUT_PRIORITY_WINDOW_MS,
} from './constants.js'

// Injectable so tests can run a manual clock and drain timers synchronously.
type FramePacerOptions = {
  now?: () => number
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
  queueMicrotaskFn?: typeof queueMicrotask
}

export class FramePacer {
  // lastFrameAt starts at -Infinity so the first frame renders immediately.
  private lastFrameAt = -Infinity
  private timer: ReturnType<typeof setTimeout> | null = null
  private timerDueAt = 0
  private microtaskQueued = false
  private inputPriorityUntil = 0

  private readonly now: () => number
  private readonly setTimeoutFn: typeof setTimeout
  private readonly clearTimeoutFn: typeof clearTimeout
  private readonly queueMicrotaskFn: typeof queueMicrotask

  constructor(
    private readonly onFrame: () => void,
    options: FramePacerOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now())
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
    this.queueMicrotaskFn = options.queueMicrotaskFn ?? queueMicrotask
  }

  /**
   * App calls this when a batch of parsed input contains a real keystroke
   * (not mouse/wheel/focus events). The pacer's next frame then waits at most
   * INPUT_PRIORITY_FRAME_INTERVAL_MS; the frame consumes the window.
   */
  requestInputPriorityFrame = (): void => {
    this.inputPriorityUntil = this.now() + INPUT_PRIORITY_WINDOW_MS
  }

  /**
   * Frame callback runs on a microtask, not synchronously: schedule() is
   * called from the reconciler's resetAfterCommit, which runs BEFORE React's
   * layout phase (ref attach + useLayoutEffect). Any state set in layout
   * effects — notably the cursorDeclaration from useDeclaredCursor — would
   * lag one commit behind if the frame ran synchronously.
   */
  schedule = (): void => {
    if (this.microtaskQueued) {
      return
    }
    const now = this.now()
    const elapsed = now - this.lastFrameAt
    const interval =
      now < this.inputPriorityUntil
        ? INPUT_PRIORITY_FRAME_INTERVAL_MS
        : FRAME_INTERVAL_MS
    if (elapsed >= interval) {
      this.queueFrame()
      return
    }
    // Not due yet — arm a timer for the exact due time. An earlier existing
    // timer is left alone; a later one is re-armed earlier.
    const dueAt = this.lastFrameAt + interval
    if (this.timer === null || dueAt < this.timerDueAt) {
      this.cancel()
      this.timerDueAt = dueAt
      this.timer = this.setTimeoutFn(() => {
        this.timer = null
        this.queueFrame()
      }, Math.max(0, dueAt - now))
    }
  }

  cancel = (): void => {
    if (this.timer !== null) {
      this.clearTimeoutFn(this.timer)
      this.timer = null
    }
  }

  private queueFrame(): void {
    this.cancel()
    this.microtaskQueued = true
    // The priority window buys one early frame; consuming it here keeps a
    // post-keystroke spinner frame from also running at the short interval.
    this.inputPriorityUntil = 0
    this.lastFrameAt = this.now()
    this.queueMicrotaskFn(() => {
      this.microtaskQueued = false
      this.onFrame()
    })
  }
}
