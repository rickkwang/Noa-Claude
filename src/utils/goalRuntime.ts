import type { AppState } from '../state/AppStateStore.js'
import type { Message, UserMessage } from '../types/message.js'
import type { ThreadGoal } from '../types/goal.js'
import {
  advanceGoalAutoContinue,
  markGoalComplete,
  markGoalEvaluatorFailed,
  normalizeGoal,
  recordGoalEvaluatorResult,
} from './goalState.js'
import { logGoalAudit, truncateGoalNoticeReason } from './goalAudit.js'
import { createSystemMessage, createUserMessage } from './messages.js'

export type GoalRuntimeEvaluation = {
  achieved: boolean
  reason: string
}

export type GoalRuntimeDecision =
  | { action: 'stop'; userNotice: Message | null }
  | { action: 'continue'; modelNotice: UserMessage; userNotice: Message | null }

export function shouldRunGoalEvaluator({
  goal,
  agentId,
  permissionMode,
}: {
  goal: ThreadGoal | undefined
  agentId?: string
  permissionMode: string
}): boolean {
  return Boolean(
    goal &&
      !agentId &&
      permissionMode !== 'plan' &&
      normalizeGoal(goal).status === 'active',
  )
}

export function buildGoalContinuationMessage(goal: ThreadGoal): string {
  const reason = goal.lastEvaluatorReason
    ? `Evaluator reason: ${goal.lastEvaluatorReason}`
    : 'Evaluator reason: Goal is not complete yet.'
  return `${reason}

Continue working toward the active thread goal. Choose the next concrete action that moves the objective closer to completion, avoid repeating completed work, and call the goal tool with operation "update_goal" and status "complete" only when the objective is actually complete.`
}

function formatGoalUsage(goal: ThreadGoal): string {
  const tokenPart = goal.tokenBudget
    ? `${goal.tokensUsed} of ${goal.tokenBudget} tokens`
    : `${goal.tokensUsed} tokens`
  return `${tokenPart}, ${goal.timeUsedSeconds} seconds`
}

export function applyGoalRuntimeEvaluation({
  evaluation,
  getAppState,
  setAppState,
}: {
  evaluation: GoalRuntimeEvaluation
  getAppState: () => AppState
  setAppState: (updater: (prev: AppState) => AppState) => void
}): GoalRuntimeDecision {
  let decision: GoalRuntimeDecision = { action: 'stop', userNotice: null }
  const now = Date.now()

  setAppState(prev => {
    if (!prev.goal) return prev
    const current = normalizeGoal(prev.goal)
    if (current.status !== 'active') return prev

    if (evaluation.achieved) {
      const completed = markGoalComplete(
        recordGoalEvaluatorResult({
          goal: current,
          reason: evaluation.reason,
          now,
        }),
        now,
      )
      if (!completed) return prev
      decision = {
        action: 'stop',
        userNotice: createSystemMessage(
          `Goal complete. Final usage: ${formatGoalUsage(completed)}.`,
          'info',
        ),
      }
      logGoalAudit({
        goal: completed,
        action: 'complete',
        reason: evaluation.reason,
      })
      return { ...prev, goal: completed }
    }

    const advanced = advanceGoalAutoContinue({
      goal: current,
      reason: evaluation.reason,
      now,
    })
    if (advanced.shouldContinue) {
      decision = {
        action: 'continue',
        modelNotice: createUserMessage({
          content: buildGoalContinuationMessage(advanced.goal),
          isMeta: true,
        }),
        userNotice: createSystemMessage(
          `Goal auto-continue ${advanced.goal.autoContinueTurns}/${advanced.goal.maxAutoContinueTurns}: ${truncateGoalNoticeReason(evaluation.reason)}`,
          'info',
        ),
      }
      logGoalAudit({
        goal: advanced.goal,
        action: 'auto_continue',
        reason: evaluation.reason,
      })
      return { ...prev, goal: advanced.goal }
    }

    decision = {
      action: 'stop',
      userNotice: createSystemMessage(
        `Goal paused after ${advanced.goal.maxAutoContinueTurns} auto-continue turns. Use /goal resume to continue.`,
        'info',
      ),
    }
    logGoalAudit({
      goal: advanced.goal,
      action: 'paused',
      reason: evaluation.reason,
    })
    return { ...prev, goal: advanced.goal }
  })

  return decision
}

export function applyGoalRuntimeEvaluationFailure({
  getAppState,
  setAppState,
}: {
  getAppState: () => AppState
  setAppState: (updater: (prev: AppState) => AppState) => void
}): GoalRuntimeDecision {
  let decision: GoalRuntimeDecision = { action: 'stop', userNotice: null }
  const now = Date.now()
  const reason = 'Goal evaluator failed to return a valid decision.'

  setAppState(prev => {
    if (!prev.goal) return prev
    const current = normalizeGoal(prev.goal)
    if (current.status !== 'active') return prev
    decision = {
      action: 'stop',
      userNotice: createSystemMessage(
        'Goal evaluator failed. Auto-continue has been paused; use /goal resume to try again.',
        'warning',
      ),
    }
    const failedGoal = markGoalEvaluatorFailed({ goal: current, reason, now })
    logGoalAudit({ goal: failedGoal, action: 'evaluator_failed', reason })
    return {
      ...prev,
      goal: failedGoal,
    }
  })

  return decision
}
