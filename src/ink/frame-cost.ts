/**
 * Frame-cost backpressure for the shared animation clock.
 *
 * Modeled on omp's Loader backpressure (`loader.ts`: idle for 9× frame cost,
 * animation capped at ~10% CPU). When frames get expensive, animation ticks
 * slow down so the render pipeline keeps its CPU budget instead of animation
 * commits fighting it. Under normal load this never fires and animations run
 * at full rate.
 *
 * ink.tsx reports every frame's duration; ClockContext listens and raises the
 * tick interval while the smoothed cost stays over budget. Hysteresis keeps
 * the interval from oscillating frame to frame.
 *
 * State is render-driven and module-global, which has two consequences worth
 * knowing before "fixing" either: pressure decays only as new frames arrive,
 * so it stays latched while rendering is idle (harmless — nothing is animating
 * then, and the animation that would resume is itself what feeds recovery);
 * and all Ink instances sharing this process share one EMA.
 */

// EMA smoothing — one expensive frame (startup, resize) must not trip
// backpressure; sustained cost must. At alpha 0.1 a single 80ms spike against
// a 2ms baseline lands at ~10ms (under budget), while sustained over-budget
// frames trip within ~8 frames (~130-250ms).
const EMA_ALPHA = 0.1
// At a 16ms tick, a >12ms frame leaves <4ms of slack for input and timers.
const OVER_BUDGET_MS = 12
// Recover only well below the raise threshold (hysteresis).
const RECOVER_MS = 8

let emaMs = 0
let pressured = false
let listener: ((pressured: boolean) => void) | null = null

/** Called from ink.tsx's onRender with the total frame duration in ms. */
export function reportFrameCost(durationMs: number): void {
  // Seed clamped to RECOVER_MS: the very first frame is the initial
  // full-screen paint (often >12ms) and must not trip pressure on its own.
  emaMs = emaMs === 0 ? Math.min(durationMs, RECOVER_MS) : emaMs + (durationMs - emaMs) * EMA_ALPHA
  const next = pressured ? emaMs >= RECOVER_MS : emaMs > OVER_BUDGET_MS
  if (next !== pressured) {
    pressured = next
    listener?.(pressured)
  }
}

/** Single subscriber (the ClockProvider). Returns an unsubscribe function.
 *  Replays the current state synchronously: module state can outlive the
 *  provider (e.g. dev Fast Refresh remount), and notifications are
 *  transition-only, so a fresh subscriber must learn a latched pressure. */
export function setFramePressureListener(
  cb: (pressured: boolean) => void,
): () => void {
  listener = cb
  cb(pressured)
  return () => {
    if (listener === cb) listener = null
  }
}

/** Test hook: reset smoothing and pressure state. */
export function resetFrameCost(): void {
  emaMs = 0
  if (pressured) {
    pressured = false
    listener?.(false)
  }
}
