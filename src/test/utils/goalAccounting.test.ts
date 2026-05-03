import { describe, expect, test } from 'bun:test'
import { getDefaultAppState, type AppState } from '../../state/AppStateStore.js'
import type { AssistantMessage } from '../../types/message.js'
import type { ThreadGoal } from '../../types/goal.js'
import { createAssistantMessage } from '../../utils/messages.js'
import { accountGoalUsage } from '../../utils/goalAccounting.js'

function assistantWithUsage(inputTokens: number, outputTokens: number): AssistantMessage {
  return createAssistantMessage({
    content: 'done',
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    } as never,
  })
}

function activeGoal(overrides: Partial<ThreadGoal> = {}): ThreadGoal {
  return {
    objective: 'Finish the goal',
    status: 'active',
    tokenBudget: 100,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: Date.now() - 1000,
    updatedAt: Date.now() - 1000,
    ...overrides,
  }
}

function stateWithGoal(goal: ThreadGoal | undefined): AppState {
  return {
    ...getDefaultAppState(),
    goal,
  }
}

function makeStateHarness(initialState: AppState) {
  let state = initialState
  return {
    getAppState: () => state,
    setAppState: (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    },
    get state() {
      return state
    },
  }
}

describe('goal accounting', () => {
  test('counts pure assistant text turns and emits visible budget notice', () => {
    const harness = makeStateHarness(stateWithGoal(activeGoal({ tokensUsed: 90 })))

    const result = accountGoalUsage({
      assistantMessages: [assistantWithUsage(8, 5)],
      getAppState: harness.getAppState,
      setAppState: harness.setAppState,
      includeModelNotice: false,
    })

    expect(harness.state.goal?.tokensUsed).toBe(103)
    expect(harness.state.goal?.status).toBe('budget_limited')
    expect(result.userNotice?.type).toBe('system')
    expect(result.userNotice?.content).toContain('Goal budget reached')
    expect(result.modelNotice).toBeNull()
  })

  test('preserves final-turn accounting after update_goal marks complete', () => {
    const goalAtTurnStart = activeGoal({ tokensUsed: 20 })
    const harness = makeStateHarness(
      stateWithGoal({ ...goalAtTurnStart, status: 'complete' }),
    )

    const result = accountGoalUsage({
      assistantMessages: [assistantWithUsage(10, 7)],
      getAppState: harness.getAppState,
      setAppState: harness.setAppState,
      includeModelNotice: true,
      goalAtTurnStart,
    })

    expect(harness.state.goal?.tokensUsed).toBe(37)
    expect(harness.state.goal?.status).toBe('complete')
    expect(result.userNotice?.type).toBe('system')
    expect(result.userNotice?.content).toContain('Goal complete')
    expect(result.modelNotice?.isMeta).toBe(true)
  })
})
