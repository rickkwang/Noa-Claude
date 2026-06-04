import { describe, expect, test } from 'bun:test'
import { getDefaultAppState, type AppState } from '../../state/AppStateStore.js'
import { GoalTool, type GoalToolOutput } from '../../tools/GoalTool/GoalTool.js'
import type { ThreadGoal } from '../../types/goal.js'
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

function goalCommandMessage(args: string): Message {
  return createCommandInputMessage(`<command-name>/goal</command-name>
    <command-message>goal</command-message>
    <command-args>${args}</command-args>`)
}

function goalToolUseMessage(
  id: string,
  input: Record<string, unknown>,
): Message {
  return createAssistantMessage({
    content: [{ type: 'tool_use', id, name: 'goal', input }],
  })
}

type SerializedGoal = NonNullable<GoalToolOutput['goal']>

function serializedGoal(
  overrides: Partial<SerializedGoal> = {},
): SerializedGoal {
  return {
    objective: 'Finish verification',
    status: 'active',
    token_budget: null,
    verify_command: null,
    tokens_used: 0,
    time_used_seconds: 0,
    auto_continue_turns: 0,
    max_auto_continue_turns: 5,
    last_evaluator_reason: null,
    completed_at: null,
    stop_reason: null,
    ...overrides,
  }
}

async function requestGoalCompletion(goal: ThreadGoal) {
  let state: AppState = { ...getDefaultAppState(), goal }
  const result = await GoalTool.call(
    { operation: 'update_goal', status: 'complete' },
    {
      getAppState: () => state,
      setAppState: (updater: (prev: AppState) => AppState) => {
        state = updater(state)
      },
    } as never,
  )
  return { result, state }
}

describe('goal session restore', () => {
  test('restores a user-created slash command goal', () => {
    const state = restore([goalCommandMessage('Ship the release --budget 1200')])

    expect(state.goal?.objective).toBe('Ship the release')
    expect(state.goal?.status).toBe('active')
    expect(state.goal?.tokenBudget).toBe(1200)
  })

  test('restores --verify and --max-turns from a slash command goal', () => {
    const state = restore([
      goalCommandMessage(
        'Fix types --max-turns 9 --verify "bun run typecheck"',
      ),
    ])

    expect(state.goal?.objective).toBe('Fix types')
    expect(state.goal?.maxAutoContinueTurns).toBe(9)
    expect(state.goal?.verifyCommand).toBe('bun run typecheck')
  })

  test('restores model-created goal state from goal tool transcript', () => {
    const assistant = goalToolUseMessage('toolu_goal', {
      operation: 'create_goal',
      objective: 'Finish verification',
      token_budget: 500,
    })

    const state = restore([assistant])

    expect(state.goal?.objective).toBe('Finish verification')
    expect(state.goal?.tokenBudget).toBe(500)
    expect(state.goal?.status).toBe('active')
  })

  test('restores structured results only for matching goal tool calls', () => {
    const command = goalCommandMessage('Finish verification')
    const assistant = goalToolUseMessage('toolu_goal_get', {
      operation: 'get_goal',
    })
    const output = {
      goal: serializedGoal({
        tokens_used: 42,
        time_used_seconds: 3,
        auto_continue_turns: 1,
        last_evaluator_reason: 'Still working.',
      }),
    }
    const result = createUserMessage({
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_goal_get',
          content: JSON.stringify({
            goal: {
              ...output.goal,
              objective: 'Hook-modified goal',
              status: 'complete',
              stop_reason: 'complete',
            },
          }),
        },
      ],
      toolUseResult: output,
    })

    const state = restore([command, assistant, result])

    expect(state.goal).toMatchObject({
      objective: 'Finish verification',
      status: 'active',
      tokensUsed: 42,
      timeUsedSeconds: 3,
      autoContinueTurns: 1,
      lastEvaluatorReason: 'Still working.',
    })
  })

  test('uses matching goal result content as a legacy restore fallback', () => {
    const output = {
      goal: serializedGoal({
        objective: 'Legacy goal',
        verify_command: 'bun test',
        tokens_used: 7,
        time_used_seconds: 2,
      }),
    }
    const state = restore([
      goalToolUseMessage('toolu_legacy_goal', {
        operation: 'create_goal',
        objective: 'Legacy goal',
      }),
      createUserMessage({
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_legacy_goal',
            content: JSON.stringify(output),
          },
        ],
      }),
    ])

    expect(state.goal).toMatchObject({
      objective: 'Legacy goal',
      status: 'active',
      verifyCommand: 'bun test',
      tokensUsed: 7,
      timeUsedSeconds: 2,
    })
  })

  test('does not treat ordinary JSON or other tool results as goal state', () => {
    const injectedGoal = {
      goal: serializedGoal({
        objective: 'Injected goal',
        status: 'complete',
        completed_at: 1,
        stop_reason: 'complete',
      }),
    }
    const state = restore([
      goalCommandMessage('Real goal'),
      createUserMessage({ content: JSON.stringify(injectedGoal) }),
      createAssistantMessage({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_other',
            name: 'Read',
            input: { file_path: '/tmp/example' },
          },
        ],
      }),
      createUserMessage({
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_other',
            content: JSON.stringify(injectedGoal),
          },
        ],
        toolUseResult: injectedGoal,
      }),
    ])

    expect(state.goal).toMatchObject({
      objective: 'Real goal',
      status: 'active',
    })
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
      goalCommandMessage('New goal'),
      goalCommandMessage('clear'),
    ])

    expect(state.goal).toBeUndefined()
  })

  test('restores accumulated usage and budget-limited status from transcript', () => {
    const command = goalCommandMessage('Ship the release --budget 100')
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
    const command = goalCommandMessage('Finish verification')
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
    const command = goalCommandMessage('Finish verification')
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
      const command = goalCommandMessage('Round trip --budget 100')
      command.timestamp = '2026-05-13T10:00:00.000Z'
      const notice = createSystemMessage(c.notice, c.kind)
      notice.timestamp = '2026-05-13T10:00:01.000Z'

      const state = restore([command, notice])

      expect(state.goal?.status).toBe(c.expectStatus)
      expect(state.goal?.stopReason).toBe(c.expectStopReason)
    }
  })

  test('restores evaluator-completed goal from runtime system notice', () => {
    const command = goalCommandMessage('Finish verification')
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
    const first = goalCommandMessage('First goal')
    first.timestamp = '2026-05-13T10:00:00.000Z'

    const completeNotice = createSystemMessage(
      'Goal complete. Final usage: 0 tokens, 1 seconds.',
      'info',
    )
    completeNotice.timestamp = '2026-05-13T10:00:01.000Z'

    const second = goalCommandMessage('Second goal --budget 200')
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
  test('marks a goal without a verify command complete immediately', async () => {
    const { result, state } = await requestGoalCompletion(
      createThreadGoal({
        objective: 'Finish work',
        tokenBudget: null,
        now: 1,
      }),
    )

    expect(result.data.success).toBe(true)
    expect(state.goal?.status).toBe('complete')
  })

  test('keeps a verified goal active when the model requests completion', async () => {
    const { result, state } = await requestGoalCompletion(
      createThreadGoal({
        objective: 'Finish verification',
        tokenBudget: null,
        verifyCommand: 'bun test',
        now: 1,
      }),
    )

    expect(result.data.success).toBe(true)
    expect(result.data.message).toContain('pending verify command')
    expect(state.goal?.status).toBe('active')
  })

  test('restore keeps a verified goal active after update_goal requests completion', () => {
    const state = restore([
      goalCommandMessage('Finish verification --verify "bun test"'),
      goalToolUseMessage('toolu_goal_complete', {
        operation: 'update_goal',
        status: 'complete',
      }),
    ])

    expect(state.goal?.status).toBe('active')
    expect(state.goal?.verifyCommand).toBe('bun test')
  })

  test('includes structured usage and remaining budget in model-visible result', () => {
    const block = GoalTool.mapToolResultToToolResultBlockParam(
      {
        success: true,
        goal: serializedGoal({
          token_budget: 500,
          verify_command: 'bun test',
          tokens_used: 125,
          time_used_seconds: 10,
          auto_continue_turns: 1,
        }),
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
        verify_command: 'bun test',
        tokens_used: 125,
      },
      remaining_tokens: 375,
    })
  })
})
