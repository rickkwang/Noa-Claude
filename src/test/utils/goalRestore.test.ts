import { describe, expect, test } from 'bun:test'
import { getDefaultAppState, type AppState } from '../../state/AppStateStore.js'
import { GoalTool } from '../../tools/GoalTool/GoalTool.js'
import type { Message } from '../../types/message.js'
import {
  createAssistantMessage,
  createCommandInputMessage,
  createSystemMessage,
  createUserMessage,
} from '../../utils/messages.js'
import { restoreSessionStateFromLog } from '../../utils/sessionRestore.js'
import {
  createThreadGoal,
  DEFAULT_MAX_GOAL_AUTO_CONTINUE_TURNS,
} from '../../utils/goalState.js'
import {
  formatGoalBudgetReachedNotice,
  formatGoalCompleteNotice,
  formatGoalPausedNotice,
  GOAL_EVALUATOR_FAILED_NOTICE,
} from '../../utils/goalNotices.js'

function restore(messages: Message[]): AppState {
  let state = getDefaultAppState()
  restoreSessionStateFromLog({ messages }, updater => {
    state = updater(state)
  })
  return state
}

function restoreInto(initialState: AppState, messages: Message[]): AppState {
  let state = initialState
  restoreSessionStateFromLog({ messages }, updater => {
    state = updater(state)
  })
  return state
}

describe('goal session restore', () => {
  test('restores a user-created slash command goal', () => {
    const state = restore([
      createCommandInputMessage(`<command-name>/goal</command-name>
        <command-message>goal</command-message>
        <command-args>Ship the release --budget 1200</command-args>`),
    ])

    expect(state.goal?.objective).toBe('Ship the release')
    expect(state.goal?.status).toBe('active')
    expect(state.goal?.tokenBudget).toBe(1200)
  })

  test('restores model-created goal state from goal tool transcript', () => {
    const assistant = createAssistantMessage({
      content: [
        {
          type: 'tool_use',
          id: 'toolu_goal',
          name: 'goal',
          input: {
            operation: 'create_goal',
            objective: 'Finish verification',
            token_budget: 500,
          },
        },
      ],
    })

    const state = restore([assistant])

    expect(state.goal?.objective).toBe('Finish verification')
    expect(state.goal?.tokenBudget).toBe(500)
    expect(state.goal?.status).toBe('active')
  })

  test('does not charge usage from the assistant turn that creates a goal', () => {
    const assistant = createAssistantMessage({
      content: [
        {
          type: 'tool_use',
          id: 'toolu_goal',
          name: 'goal',
          input: {
            operation: 'create_goal',
            objective: 'Finish verification',
            token_budget: 50,
          },
        },
      ],
      usage: {
        input_tokens: 40,
        output_tokens: 20,
      } as never,
    })

    const state = restore([assistant])

    expect(state.goal).toMatchObject({
      objective: 'Finish verification',
      status: 'active',
      tokenBudget: 50,
      tokensUsed: 0,
    })
  })

  test('clears stale goal when resumed transcript has no goal', () => {
    const initialState: AppState = {
      ...getDefaultAppState(),
      goal: createThreadGoal({
        objective: 'Old session goal',
        tokenBudget: null,
        now: 1,
      }),
    }

    const state = restoreInto(initialState, [
      createCommandInputMessage(`<command-name>/help</command-name>
        <command-message>help</command-message>
        <command-args></command-args>`),
    ])

    expect(state.goal).toBeUndefined()
  })

  test('clears stale goal when resumed transcript ended with goal clear', () => {
    const initialState: AppState = {
      ...getDefaultAppState(),
      goal: createThreadGoal({
        objective: 'Old session goal',
        tokenBudget: null,
        now: 1,
      }),
    }

    const state = restoreInto(initialState, [
      createCommandInputMessage(`<command-name>/goal</command-name>
        <command-message>goal</command-message>
        <command-args>New goal</command-args>`),
      createCommandInputMessage(`<command-name>/goal</command-name>
        <command-message>goal</command-message>
        <command-args>clear</command-args>`),
    ])

    expect(state.goal).toBeUndefined()
  })

  test('restores accumulated usage and budget-limited status from transcript', () => {
    const command = createCommandInputMessage(`<command-name>/goal</command-name>
      <command-message>goal</command-message>
      <command-args>Ship the release --budget 100</command-args>`)
    command.timestamp = '2026-05-13T10:00:00.000Z'

    const assistant = createAssistantMessage({
      content: 'Worked on the release',
      usage: {
        input_tokens: 80,
        output_tokens: 30,
      } as never,
    })
    assistant.timestamp = '2026-05-13T10:00:05.000Z'

    const budgetNotice = createSystemMessage(
      'Goal budget reached: 110 of 100 tokens, 5 seconds. Wrapping up.',
      'info',
    )
    budgetNotice.timestamp = '2026-05-13T10:00:05.000Z'

    const state = restore([command, assistant, budgetNotice])

    expect(state.goal).toMatchObject({
      objective: 'Ship the release',
      status: 'budget_limited',
      tokenBudget: 100,
      tokensUsed: 110,
      timeUsedSeconds: 5,
      stopReason: 'budget_limited',
    })
  })

  test('restores auto-continue counters and evaluator pause state from transcript', () => {
    const command = createCommandInputMessage(`<command-name>/goal</command-name>
      <command-message>goal</command-message>
      <command-args>Finish verification</command-args>`)
    command.timestamp = '2026-05-13T10:00:00.000Z'

    const continuation = createUserMessage({
      content: `Evaluator reason: Tests are still missing.

Continue working toward the active thread goal.`,
      isMeta: true,
    })
    continuation.timestamp = '2026-05-13T10:00:10.000Z'

    const failedNotice = createSystemMessage(
      'Goal evaluator failed. Auto-continue has been paused; use /goal resume to try again.',
      'warning',
    )
    failedNotice.timestamp = '2026-05-13T10:00:11.000Z'

    const state = restore([command, continuation, failedNotice])

    expect(state.goal).toMatchObject({
      objective: 'Finish verification',
      status: 'paused',
      autoContinueTurns: 1,
      lastEvaluatorReason: 'Goal evaluator failed to return a valid decision.',
      stopReason: 'evaluator_failed',
    })
  })

  test('paused-after-N restore preserves default maxAutoContinueTurns', () => {
    const command = createCommandInputMessage(`<command-name>/goal</command-name>
      <command-message>goal</command-message>
      <command-args>Finish verification</command-args>`)
    command.timestamp = '2026-05-13T10:00:00.000Z'

    const pausedNotice = createSystemMessage(formatGoalPausedNotice(3), 'info')
    pausedNotice.timestamp = '2026-05-13T10:00:30.000Z'

    const state = restore([command, pausedNotice])

    expect(state.goal?.status).toBe('paused')
    expect(state.goal?.autoContinueTurns).toBe(3)
    expect(state.goal?.maxAutoContinueTurns).toBe(
      DEFAULT_MAX_GOAL_AUTO_CONTINUE_TURNS,
    )
    expect(state.goal?.stopReason).toBe('max_auto_continue_turns')
  })

  test('notices round-trip through restore for all goal lifecycle states', () => {
    const baseGoal = createThreadGoal({
      objective: 'Round trip',
      tokenBudget: 100,
      now: 1,
    })

    const cases = [
      {
        notice: formatGoalBudgetReachedNotice({
          ...baseGoal,
          tokensUsed: 110,
          timeUsedSeconds: 5,
        }),
        kind: 'warning' as const,
        expectStatus: 'budget_limited' as const,
        expectStopReason: 'budget_limited' as const,
      },
      {
        notice: formatGoalCompleteNotice({
          ...baseGoal,
          tokensUsed: 30,
          timeUsedSeconds: 3,
        }),
        kind: 'info' as const,
        expectStatus: 'complete' as const,
        expectStopReason: 'complete' as const,
      },
      {
        notice: GOAL_EVALUATOR_FAILED_NOTICE,
        kind: 'warning' as const,
        expectStatus: 'paused' as const,
        expectStopReason: 'evaluator_failed' as const,
      },
      {
        notice: formatGoalPausedNotice(5),
        kind: 'info' as const,
        expectStatus: 'paused' as const,
        expectStopReason: 'max_auto_continue_turns' as const,
      },
    ]

    for (const c of cases) {
      const command = createCommandInputMessage(`<command-name>/goal</command-name>
        <command-message>goal</command-message>
        <command-args>Round trip --budget 100</command-args>`)
      command.timestamp = '2026-05-13T10:00:00.000Z'
      const notice = createSystemMessage(c.notice, c.kind)
      notice.timestamp = '2026-05-13T10:00:01.000Z'

      const state = restore([command, notice])

      expect(state.goal?.status).toBe(c.expectStatus)
      expect(state.goal?.stopReason).toBe(c.expectStopReason)
    }
  })

  test('restores evaluator-completed goal from runtime system notice', () => {
    const command = createCommandInputMessage(`<command-name>/goal</command-name>
      <command-message>goal</command-message>
      <command-args>Finish verification</command-args>`)
    command.timestamp = '2026-05-13T10:00:00.000Z'

    const assistant = createAssistantMessage({
      content: 'Verification is complete',
      usage: {
        input_tokens: 10,
        output_tokens: 20,
      } as never,
    })
    assistant.timestamp = '2026-05-13T10:00:03.000Z'

    const completeNotice = createSystemMessage(
      'Goal complete. Final usage: 30 tokens, 3 seconds.',
      'info',
    )
    completeNotice.timestamp = '2026-05-13T10:00:03.000Z'

    const state = restore([command, assistant, completeNotice])

    expect(state.goal).toMatchObject({
      objective: 'Finish verification',
      status: 'complete',
      tokensUsed: 30,
      timeUsedSeconds: 3,
      stopReason: 'complete',
    })
  })

  test('restores a new slash command goal after the previous goal completed', () => {
    const first = createCommandInputMessage(`<command-name>/goal</command-name>
      <command-message>goal</command-message>
      <command-args>First goal</command-args>`)
    first.timestamp = '2026-05-13T10:00:00.000Z'

    const completeNotice = createSystemMessage(
      'Goal complete. Final usage: 0 tokens, 1 seconds.',
      'info',
    )
    completeNotice.timestamp = '2026-05-13T10:00:01.000Z'

    const second = createCommandInputMessage(`<command-name>/goal</command-name>
      <command-message>goal</command-message>
      <command-args>Second goal --budget 200</command-args>`)
    second.timestamp = '2026-05-13T10:00:02.000Z'

    const state = restore([first, completeNotice, second])

    expect(state.goal).toMatchObject({
      objective: 'Second goal',
      status: 'active',
      tokenBudget: 200,
      tokensUsed: 0,
    })
  })
})

describe('goal tool result mapping', () => {
  test('includes structured usage and remaining budget in model-visible result', () => {
    const block = GoalTool.mapToolResultToToolResultBlockParam(
      {
        success: true,
        goal: {
          objective: 'Finish verification',
          status: 'active',
          token_budget: 500,
          tokens_used: 125,
          time_used_seconds: 10,
          auto_continue_turns: 1,
          max_auto_continue_turns: 5,
          last_evaluator_reason: null,
          completed_at: null,
          stop_reason: null,
        },
        remaining_tokens: 375,
        message: 'Current goal: Finish verification (status: active)',
      },
      'toolu_goal',
    )

    expect(block.type).toBe('tool_result')
    expect(JSON.parse(block.content as string)).toMatchObject({
      goal: {
        objective: 'Finish verification',
        token_budget: 500,
        tokens_used: 125,
      },
      remaining_tokens: 375,
    })
  })
})
