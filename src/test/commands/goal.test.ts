import { describe, expect, test } from 'bun:test'
import { getDefaultAppState, type AppState } from '../../state/AppStateStore.js'
import { call as goalCommand } from '../../commands/goal/goal.js'
import { createThreadGoal } from '../../utils/goalState.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

function makeContext(initialGoal?: AppState['goal']) {
  let state: AppState = {
    ...getDefaultAppState(),
    goal: initialGoal,
  }
  const outputs: string[] = []
  return {
    outputs,
    context: {
      getAppState: () => state,
      setAppState: (updater: (prev: AppState) => AppState) => {
        state = updater(state)
      },
    } as never,
    get state() {
      return state
    },
    onDone: ((value?: string) => {
      if (value) outputs.push(value)
    }) satisfies LocalJSXCommandOnDone,
  }
}

describe('/goal command', () => {
  test('does not overwrite an existing active goal without replace', async () => {
    const harness = makeContext(
      createThreadGoal({ objective: 'Old goal', tokenBudget: null, now: 1 }),
    )

    await goalCommand(harness.onDone, harness.context, 'New goal')

    expect(harness.state.goal?.objective).toBe('Old goal')
    expect(harness.outputs.at(-1)).toContain('/goal replace')
  })

  test('replace explicitly overwrites the current goal', async () => {
    const harness = makeContext(
      createThreadGoal({ objective: 'Old goal', tokenBudget: null, now: 1 }),
    )

    await goalCommand(harness.onDone, harness.context, 'replace New goal --budget 200')

    expect(harness.state.goal?.objective).toBe('New goal')
    expect(harness.state.goal?.tokenBudget).toBe(200)
    expect(harness.state.goal?.tokensUsed).toBe(0)
  })

  test('rejects malformed budget values', async () => {
    const harness = makeContext()

    await goalCommand(harness.onDone, harness.context, 'Ship --budget nope')

    expect(harness.state.goal).toBeUndefined()
    expect(harness.outputs.at(-1)).toContain('positive integer')
  })

  test('budget-limited goal resumes only with a larger budget', async () => {
    const goal = {
      ...createThreadGoal({ objective: 'Ship', tokenBudget: 100, now: 1 }),
      status: 'budget_limited' as const,
      tokensUsed: 120,
      stopReason: 'budget_limited' as const,
    }
    const harness = makeContext(goal)

    await goalCommand(harness.onDone, harness.context, 'Ship --budget 120')
    expect(harness.state.goal?.status).toBe('budget_limited')

    await goalCommand(harness.onDone, harness.context, 'Ship --budget 150')
    expect(harness.state.goal?.status).toBe('active')
    expect(harness.state.goal?.tokenBudget).toBe(150)
  })

  test('shows human-readable stop reasons', async () => {
    const cases = [
      {
        goal: {
          ...createThreadGoal({ objective: 'Ship', tokenBudget: 100, now: 1 }),
          status: 'budget_limited' as const,
          tokensUsed: 120,
          stopReason: 'budget_limited' as const,
        },
        expected: 'Token budget reached. Increase the budget to resume.',
        raw: 'Stop reason: budget_limited',
      },
      {
        goal: {
          ...createThreadGoal({ objective: 'Ship', tokenBudget: null, now: 1 }),
          status: 'paused' as const,
          autoContinueTurns: 5,
          maxAutoContinueTurns: 5,
          stopReason: 'max_auto_continue_turns' as const,
        },
        expected:
          'Paused after 5 auto-continue turns. Use /goal resume to continue.',
        raw: 'Stop reason: max_auto_continue_turns',
      },
      {
        goal: {
          ...createThreadGoal({ objective: 'Ship', tokenBudget: null, now: 1 }),
          status: 'paused' as const,
          stopReason: 'evaluator_failed' as const,
        },
        expected: 'Evaluator failed. Use /goal resume to try again.',
        raw: 'Stop reason: evaluator_failed',
      },
      {
        goal: {
          ...createThreadGoal({ objective: 'Ship', tokenBudget: null, now: 1 }),
          status: 'complete' as const,
          stopReason: 'complete' as const,
        },
        expected: 'Goal is complete.',
        raw: 'Stop reason: complete',
      },
    ]

    for (const { goal, expected, raw } of cases) {
      const harness = makeContext(goal)

      await goalCommand(harness.onDone, harness.context, '')

      const output = harness.outputs.at(-1)
      expect(output).toContain(`Stop reason: ${expected}`)
      expect(output).not.toContain(raw)
    }
  })
})
