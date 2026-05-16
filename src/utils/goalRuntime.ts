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
import { logGoalAudit } from './goalAudit.js'
import { createSystemMessage, createUserMessage } from './messages.js'
import {
  GOAL_CONTINUATION_MARKER,
  GOAL_CONTINUATION_REASON_PREFIX,
  GOAL_EVALUATOR_FAILED_NOTICE,
  GOAL_EVALUATOR_FAILED_REASON,
  formatGoalAutoContinueNotice,
  formatGoalCompleteNotice,
  formatGoalPausedNotice,
} from './goalNotices.js'

export type GoalRuntimeEvaluation = {
  achieved: boolean
  reason: string
}

export type GoalRuntimeDecision =
  | { action: 'stop'; userNotice: Message | null }
  | { action: 'continue'; modelNotice: UserMessage; userNotice: Message | null }

export type GoalEvaluatorAction = 'run' | 'exhausted' | 'skip'

export function decideGoalEvaluatorAction({
  goal,
  agentId,
  permissionMode,
}: {
  goal: ThreadGoal | undefined
  agentId?: string
  permissionMode: string
}): GoalEvaluatorAction {
  if (!goal || agentId || permissionMode === 'plan') return 'skip'
  const current = normalizeGoal(goal)
  if (current.status !== 'active') return 'skip'
  if (current.autoContinueTurns >= current.maxAutoContinueTurns)
    return 'exhausted'
  return 'run'
}

// Auto-continue nudge injected mid-loop after the evaluator votes "not yet".
// Intentionally short — the heavyweight per-turn priming (objective wrapping,
// completion audit checklist) is in buildContinuationPrompt() at goalPrompts.ts
// and runs at the start of every fresh user turn, so we don't repeat it here.
export function buildGoalContinuationMessage(goal: ThreadGoal): string {
  const reasonLine = goal.lastEvaluatorReason
    ? `${GOAL_CONTINUATION_REASON_PREFIX}${goal.lastEvaluatorReason}`
    : `${GOAL_CONTINUATION_REASON_PREFIX}Goal is not complete yet.`
  return `${GOAL_CONTINUATION_MARKER}
${reasonLine}

Continue working toward the active thread goal. Choose the next concrete action that moves the objective closer to completion, avoid repeating completed work, and call the goal tool with operation "update_goal" and status "complete" only when the objective is actually complete.`
}

export function applyGoalRuntimeEvaluation({
  evaluation,
  setAppState,
}: {
  evaluation: GoalRuntimeEvaluation
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
          formatGoalCompleteNotice(completed),
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
          formatGoalAutoContinueNotice(advanced.goal, evaluation.reason),
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
        formatGoalPausedNotice(advanced.goal.maxAutoContinueTurns),
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

export function applyGoalAutoContinueExhausted({
  setAppState,
}: {
  setAppState: (updater: (prev: AppState) => AppState) => void
}): GoalRuntimeDecision {
  let decision: GoalRuntimeDecision = { action: 'stop', userNotice: null }
  const now = Date.now()

  setAppState(prev => {
    if (!prev.goal) return prev
    const current = normalizeGoal(prev.goal)
    if (current.status !== 'active') return prev
    const advanced = advanceGoalAutoContinue({
      goal: current,
      reason:
        current.lastEvaluatorReason ?? 'Auto-continue turn limit reached.',
      now,
    })
    decision = {
      action: 'stop',
      userNotice: createSystemMessage(
        formatGoalPausedNotice(advanced.goal.maxAutoContinueTurns),
        'info',
      ),
    }
    logGoalAudit({
      goal: advanced.goal,
      action: 'paused',
      reason: 'Auto-continue turn limit reached.',
    })
    return { ...prev, goal: advanced.goal }
  })

  return decision
}

export function applyGoalRuntimeEvaluationFailure({
  setAppState,
}: {
  setAppState: (updater: (prev: AppState) => AppState) => void
}): GoalRuntimeDecision {
  let decision: GoalRuntimeDecision = { action: 'stop', userNotice: null }
  const now = Date.now()

  setAppState(prev => {
    if (!prev.goal) return prev
    const current = normalizeGoal(prev.goal)
    if (current.status !== 'active') return prev
    decision = {
      action: 'stop',
      userNotice: createSystemMessage(GOAL_EVALUATOR_FAILED_NOTICE, 'warning'),
    }
    const failedGoal = markGoalEvaluatorFailed({
      goal: current,
      reason: GOAL_EVALUATOR_FAILED_REASON,
      now,
    })
    logGoalAudit({
      goal: failedGoal,
      action: 'evaluator_failed',
      reason: GOAL_EVALUATOR_FAILED_REASON,
    })
    return {
      ...prev,
      goal: failedGoal,
    }
  })

  return decision
}
