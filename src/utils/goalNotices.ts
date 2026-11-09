import type { ThreadGoal, ThreadGoalStopReason } from '../types/goal.js'
import { truncateGoalNoticeReason } from './goalAudit.js'

export const GOAL_EVALUATOR_FAILED_NOTICE =
  'Goal evaluator failed. Auto-continue has been paused; use /goal resume to try again.'

export const GOAL_EVALUATOR_FAILED_REASON =
  'Goal evaluator failed to return a valid decision.'

export const GOAL_BUDGET_REACHED_PREFIX = 'Goal budget reached: '
export const GOAL_COMPLETE_PREFIX = 'Goal complete. Final usage: '
export const GOAL_AUTO_CONTINUE_PREFIX = 'Goal auto-continue '
export const GOAL_PAUSED_AFTER_PREFIX = 'Goal paused after '
export const GOAL_CONTINUATION_REASON_PREFIX = 'Evaluator reason: '
export const GOAL_CONTINUATION_MARKER = '<!-- goal-auto-continue -->'

// Pause notices are shown to the user and replayed on restore (sessionRestore.ts)
// for transcripts without a goal-state snapshot, so both sides use these.
export const GOAL_PAUSE_NOTICE_PREFIX = 'Goal paused: '
export const GOAL_PAUSE_REASON = {
  unrecoverablePrefix: 'Unrecoverable ',
  retriesExhausted:
    'Automatic retries are exhausted or disabled; send a message to continue.',
  rateLimit: 'API rate limit; send a message once access resets to continue.',
  turnFailed: 'The turn ended without a usable result; send a message to continue.',
  noProgress:
    'No successful tool use for three evaluated turns; send a message with new direction to continue.',
} as const

export function unrecoverablePauseReason(kind: string): string {
  return `${GOAL_PAUSE_REASON.unrecoverablePrefix}${kind} error; fix the cause and use /goal resume.`
}

export function formatGoalPausedReasonNotice(reason: string): string {
  return `${GOAL_PAUSE_NOTICE_PREFIX}${reason}`
}

/**
 * Stop reason for a pause notice we wrote; null for any other text (e.g. an evaluator's own reason).
 * Matches by prefix because the wording changed across releases and older transcripts must still restore.
 */
export function stopReasonForPauseReason(
  reason: string,
): ThreadGoalStopReason | null {
  if (reason.startsWith(GOAL_PAUSE_REASON.unrecoverablePrefix)) return 'unrecoverable_error'
  if (reason.startsWith('Automatic retries')) return 'retry_exhausted'
  if (reason.startsWith('API rate limit')) return 'rate_limit'
  if (reason.startsWith('The turn ended')) return 'turn_failed'
  if (reason.startsWith('No tool use') || reason.startsWith('No successful tool use')) return 'no_progress'
  return null
}

export function formatGoalUsage(goal: ThreadGoal): string {
  const tokenPart = goal.tokenBudget
    ? `${goal.tokensUsed} of ${goal.tokenBudget} tokens`
    : `${goal.tokensUsed} tokens`
  return `${tokenPart}, ${goal.timeUsedSeconds} seconds`
}

export function formatGoalBudgetReachedNotice(goal: ThreadGoal): string {
  return `${GOAL_BUDGET_REACHED_PREFIX}${formatGoalUsage(goal)}. Wrapping up.`
}

export function formatGoalCompleteNotice(goal: ThreadGoal): string {
  return `${GOAL_COMPLETE_PREFIX}${formatGoalUsage(goal)}.`
}

export function formatGoalAutoContinueNotice(
  goal: ThreadGoal,
  reason: string,
): string {
  return `${GOAL_AUTO_CONTINUE_PREFIX}${goal.autoContinueTurns}/${goal.maxAutoContinueTurns}: ${truncateGoalNoticeReason(reason)}`
}

export function formatGoalPausedNotice(maxTurns: number): string {
  return `${GOAL_PAUSED_AFTER_PREFIX}${maxTurns} auto-continue turns. Use /goal resume to continue.`
}
