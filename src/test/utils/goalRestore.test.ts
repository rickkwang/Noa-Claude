import { describe, expect, test } from 'bun:test'
import { getDefaultAppState, type AppState } from '../../state/AppStateStore.js'
import { GoalTool } from '../../tools/GoalTool/GoalTool.js'
import type { Message } from '../../types/message.js'
import { createAssistantMessage, createCommandInputMessage } from '../../utils/messages.js'
import { restoreSessionStateFromLog } from '../../utils/sessionRestore.js'

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

  test('clears stale goal when resumed transcript has no goal', () => {
    const initialState: AppState = {
      ...getDefaultAppState(),
      goal: {
        objective: 'Old session goal',
        status: 'active',
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: 1,
        updatedAt: 1,
      },
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
      goal: {
        objective: 'Old session goal',
        status: 'active',
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: 1,
        updatedAt: 1,
      },
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
