import type { AppState } from '../state/AppStateStore.js'
import type { AssistantMessage, Message, UserMessage } from '../types/message.js'
import type { ThreadGoal } from '../types/goal.js'
import { createSystemMessage, createUserMessage } from './messages.js'
import { getGoalPromptForStatus } from './goalPrompts.js'

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

function formatGoalUsage(goal: ThreadGoal): string {
  const tokenPart = goal.tokenBudget
    ? `${goal.tokensUsed} of ${goal.tokenBudget} tokens`
    : `${goal.tokensUsed} tokens`
  return `${tokenPart}, ${goal.timeUsedSeconds} seconds`
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
    const isSameGoal =
      prev.goal.createdAt === currentGoal.createdAt &&
      prev.goal.objective === currentGoal.objective
    const canChargeGoal =
      prev.goal.status === 'active' ||
      prev.goal.status === 'budget_limited' ||
      prev.goal.status === 'complete'
    if (!isSameGoal || !canChargeGoal) {
      return prev
    }

    const newTokensUsed = prev.goal.tokensUsed + tokenDelta
    const newStatus =
      prev.goal.status === 'complete'
        ? 'complete'
        : prev.goal.tokenBudget && newTokensUsed >= prev.goal.tokenBudget
          ? 'budget_limited'
          : prev.goal.status
    const statusChanged = newStatus !== prev.goal.status
    const updatedGoal: ThreadGoal = {
      ...prev.goal,
      tokensUsed: newTokensUsed,
      timeUsedSeconds: Math.floor((Date.now() - prev.goal.createdAt) / 1000),
      status: newStatus,
      ...(statusChanged ? { updatedAt: Date.now() } : {}),
    }

    if (statusChanged && newStatus === 'budget_limited') {
      if (includeModelNotice) {
        modelNotice = createUserMessage({
          content: getGoalPromptForStatus(updatedGoal),
          isMeta: true,
        })
      }
      userNotice = createSystemMessage(
        `Goal budget reached: ${formatGoalUsage(updatedGoal)}. Wrapping up.`,
        'info',
      )
    } else if (prev.goal.status === 'complete') {
      if (includeModelNotice) {
        modelNotice = createUserMessage({
          content: `The active thread goal is complete and final usage has been updated after the last assistant turn.

Goal: ${updatedGoal.objective}
Tokens used: ${updatedGoal.tokensUsed}${updatedGoal.tokenBudget ? ` of ${updatedGoal.tokenBudget}` : ''}
Time used: ${updatedGoal.timeUsedSeconds} seconds`,
          isMeta: true,
        })
      }
      userNotice = createSystemMessage(
        `Goal complete. Final usage: ${formatGoalUsage(updatedGoal)}.`,
        'info',
      )
    }

    return {
      ...prev,
      goal: updatedGoal,
    }
  })

  return { modelNotice, userNotice }
}
