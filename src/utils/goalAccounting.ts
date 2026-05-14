import type { AppState } from '../state/AppStateStore.js'
import type { AssistantMessage, Message, UserMessage } from '../types/message.js'
import type { ThreadGoal } from '../types/goal.js'
import { createSystemMessage, createUserMessage } from './messages.js'
import { getGoalPromptForStatus } from './goalPrompts.js'
import { markGoalBudgetLimited, normalizeGoal } from './goalState.js'
import { logGoalAudit } from './goalAudit.js'
import {
  formatGoalBudgetReachedNotice,
  formatGoalCompleteNotice,
} from './goalNotices.js'

type GoalAccountingParams = {
  assistantMessages: AssistantMessage[]
  getAppState: () => AppState
  setAppState: (updater: (prev: AppState) => AppState) => void
  includeModelNotice: boolean
  goalAtTurnStart?: ThreadGoal
}

type GoalAccountingResult = {
  modelNotice: UserMessage | null
  userNotice: Message | null
}

function sumAssistantUsage(assistantMessages: AssistantMessage[]): number {
  return assistantMessages.reduce((sum, message) => {
    const usage = message.message?.usage
    return sum + (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)
  }, 0)
}

export function accountGoalUsage({
  assistantMessages,
  getAppState,
  setAppState,
  includeModelNotice,
  goalAtTurnStart,
}: GoalAccountingParams): GoalAccountingResult {
  let modelNotice: UserMessage | null = null
  let userNotice: Message | null = null
  const currentGoal = goalAtTurnStart ?? getAppState().goal
  if (
    !currentGoal ||
    (currentGoal.status !== 'active' && currentGoal.status !== 'budget_limited')
  ) {
    return { modelNotice, userNotice }
  }

  const tokenDelta = sumAssistantUsage(assistantMessages)
  if (tokenDelta <= 0) {
    return { modelNotice, userNotice }
  }

  setAppState(prev => {
    if (!prev.goal) return prev
    const currentPrevGoal = normalizeGoal(prev.goal)
    const isSameGoal =
      currentPrevGoal.createdAt === currentGoal.createdAt &&
      currentPrevGoal.objective === currentGoal.objective
    const canChargeGoal =
      currentPrevGoal.status === 'active' ||
      currentPrevGoal.status === 'budget_limited' ||
      currentPrevGoal.status === 'complete'
    if (!isSameGoal || !canChargeGoal) {
      return prev
    }

    const newTokensUsed = currentPrevGoal.tokensUsed + tokenDelta
    const newStatus =
      currentPrevGoal.status === 'complete'
        ? 'complete'
        : currentPrevGoal.tokenBudget &&
            newTokensUsed >= currentPrevGoal.tokenBudget
          ? 'budget_limited'
          : currentPrevGoal.status
    const statusChanged = newStatus !== currentPrevGoal.status
    const now = Date.now()
    const updatedGoal: ThreadGoal = {
      ...currentPrevGoal,
      tokensUsed: newTokensUsed,
      timeUsedSeconds: Math.floor((now - currentPrevGoal.createdAt) / 1000),
      status: newStatus,
      ...(statusChanged ? { updatedAt: now } : {}),
    }
    const finalGoal =
      statusChanged && newStatus === 'budget_limited'
        ? markGoalBudgetLimited(updatedGoal, now)
        : updatedGoal

    if (statusChanged && newStatus === 'budget_limited') {
      if (includeModelNotice) {
        modelNotice = createUserMessage({
          content: getGoalPromptForStatus(finalGoal),
          isMeta: true,
        })
      }
      userNotice = createSystemMessage(
        formatGoalBudgetReachedNotice(finalGoal),
        'info',
      )
      logGoalAudit({
        goal: finalGoal,
        action: 'budget_limited',
        reason: 'Goal token budget reached.',
      })
    } else if (currentPrevGoal.status === 'complete') {
      if (includeModelNotice) {
        modelNotice = createUserMessage({
          content: `The active thread goal is complete and final usage has been updated after the last assistant turn.

Goal: ${finalGoal.objective}
Tokens used: ${finalGoal.tokensUsed}${finalGoal.tokenBudget ? ` of ${finalGoal.tokenBudget}` : ''}
Time used: ${finalGoal.timeUsedSeconds} seconds`,
          isMeta: true,
        })
      }
      userNotice = createSystemMessage(
        formatGoalCompleteNotice(finalGoal),
        'info',
      )
      logGoalAudit({
        goal: finalGoal,
        action: 'complete',
        reason: 'Goal completion usage finalized.',
      })
    }

    return {
      ...prev,
      goal: finalGoal,
    }
  })

  return { modelNotice, userNotice }
}
