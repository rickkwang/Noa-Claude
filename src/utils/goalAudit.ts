import type { ThreadGoal } from '../types/goal.js'
import { logForDebugging } from './debug.js'
import { normalizeGoal } from './goalState.js'

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

export function truncateGoalNoticeReason(reason: string): string {
  return truncate(reason.replace(/\s+/g, ' ').trim(), 220)
}

export function logGoalAudit({
  goal,
  action,
  reason,
}: {
  goal: ThreadGoal
  action: string
  reason?: string | null
}): void {
  const current = normalizeGoal(goal)
  logForDebugging(
    `[goal] ${JSON.stringify({
      createdAt: current.createdAt,
      status: current.status,
      tokensUsed: current.tokensUsed,
      tokenBudget: current.tokenBudget,
      autoContinueTurns: current.autoContinueTurns,
      maxAutoContinueTurns: current.maxAutoContinueTurns,
      action,
      stopReason: current.stopReason,
      reason: reason ? truncate(reason, 500) : null,
      objective: truncate(current.objective, 120),
    })}`,
  )
}
