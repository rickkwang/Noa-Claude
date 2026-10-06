// Background time limit for shell tasks. Kept free of React/Ink, like
// guards.ts, so the Bash prompt can read the gate without the task UI.

import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { resolveBackgroundTimeoutMs } from '../../utils/timeouts.js'

/**
 * Whether a shell in the background is stopped once it has run for its time
 * limit.
 *
 * Only in non-interactive sessions: there nobody watches the task list, so a
 * hung background command would leave the model waiting for a notification
 * that never arrives. Interactively the user sees and can stop the task, and
 * long-lived commands like dev servers are expected to outlive any limit.
 */
export function isBackgroundDeadlineEnabled(): boolean {
  return (
    getIsNonInteractiveSession() &&
    !isEnvTruthy(process.env.NOA_CLAUDE_DISABLE_BACKGROUND_DEADLINE)
  )
}

/**
 * The time limit for a shell entering the background, or undefined when none
 * applies. `requestedTimeoutMs` is the `timeout` the model passed with
 * `run_in_background`; a shell backgrounded any other way gets the default.
 */
export function getBackgroundDeadlineMs(
  requestedTimeoutMs?: number,
): number | undefined {
  return isBackgroundDeadlineEnabled()
    ? resolveBackgroundTimeoutMs(requestedTimeoutMs)
    : undefined
}

export type BackgroundStopCause = 'deadline'

/** How a stopped task's notification describes the stop, and what to do next. */
export const BACKGROUND_STOP_CAUSES: Record<
  BackgroundStopCause,
  { summary: string; note: string }
> = {
  deadline: {
    summary: 'stopped after reaching its background time limit',
    note: 'If the work in progress still needs it, start it again with `run_in_background` and a longer `timeout`. If it already had the longest `timeout` allowed, do not restart it. Either way, report that it was stopped.',
  },
}
