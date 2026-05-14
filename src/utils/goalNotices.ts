import type { ThreadGoal } from '../types/goal.js'
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
