import { describe, expect, test } from 'bun:test'
import { getDefaultAppState, type AppState } from '../../state/AppStateStore.js'
import {
  applyGoalRuntimeEvaluation,
  applyGoalRuntimeEvaluationFailure,
  shouldRunGoalEvaluator,
} from '../../utils/goalRuntime.js'
import { createThreadGoal } from '../../utils/goalState.js'

function harness(goal: AppState['goal']) {
  let state: AppState = { ...getDefaultAppState(), goal }
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

describe('goal runtime', () => {
  test('marks active goal complete when evaluator says achieved', () => {
    const state = harness(
      createThreadGoal({ objective: 'Ship', tokenBudget: null, now: 1 }),
    )

    const decision = applyGoalRuntimeEvaluation({
      evaluation: { achieved: true, reason: 'All checks passed.' },
      getAppState: state.getAppState,
      setAppState: state.setAppState,
    })

    expect(decision.action).toBe('stop')
    expect(state.state.goal?.status).toBe('complete')
    expect(state.state.goal?.lastEvaluatorReason).toBe('All checks passed.')
  })

  test('continues active goal when evaluator says incomplete', () => {
    const state = harness(
      createThreadGoal({ objective: 'Ship', tokenBudget: null, now: 1 }),
    )

    const decision = applyGoalRuntimeEvaluation({
      evaluation: { achieved: false, reason: 'Tests are still missing.' },
      getAppState: state.getAppState,
      setAppState: state.setAppState,
    })

    expect(decision.action).toBe('continue')
    expect(decision.userNotice?.type).toBe('system')
    expect(decision.userNotice?.content).toContain('Goal auto-continue 1/5')
    expect(decision.userNotice?.content).toContain('Tests are still missing.')
    expect(state.state.goal?.autoContinueTurns).toBe(1)
    expect(state.state.goal?.status).toBe('active')
  })

  test('pauses after max auto-continue turns', () => {
    const state = harness({
      ...createThreadGoal({ objective: 'Ship', tokenBudget: null, now: 1 }),
      autoContinueTurns: 5,
      maxAutoContinueTurns: 5,
    })

    const decision = applyGoalRuntimeEvaluation({
      evaluation: { achieved: false, reason: 'Still incomplete.' },
      getAppState: state.getAppState,
      setAppState: state.setAppState,
    })

    expect(decision.action).toBe('stop')
    expect(state.state.goal?.status).toBe('paused')
    expect(state.state.goal?.stopReason).toBe('max_auto_continue_turns')
  })

  test('does nothing for non-active goals', () => {
    const state = harness({
      ...createThreadGoal({ objective: 'Ship', tokenBudget: null, now: 1 }),
      status: 'paused',
    })

    const decision = applyGoalRuntimeEvaluation({
      evaluation: { achieved: false, reason: 'Still incomplete.' },
      getAppState: state.getAppState,
      setAppState: state.setAppState,
    })

    expect(decision.action).toBe('stop')
    expect(state.state.goal?.status).toBe('paused')
    expect(state.state.goal?.autoContinueTurns).toBe(0)
  })

  test('pauses active goal when evaluator fails', () => {
    const state = harness(
      createThreadGoal({ objective: 'Ship', tokenBudget: null, now: 1 }),
    )

    const decision = applyGoalRuntimeEvaluationFailure({
      getAppState: state.getAppState,
      setAppState: state.setAppState,
    })

    expect(decision.action).toBe('stop')
    expect(decision.userNotice?.type).toBe('system')
    expect(state.state.goal?.status).toBe('paused')
    expect(state.state.goal?.stopReason).toBe('evaluator_failed')
  })

  test('does not emit evaluator failure notice for non-active goals', () => {
    const state = harness({
      ...createThreadGoal({ objective: 'Ship', tokenBudget: null, now: 1 }),
      status: 'paused',
    })

    const decision = applyGoalRuntimeEvaluationFailure({
      getAppState: state.getAppState,
      setAppState: state.setAppState,
    })

    expect(decision.action).toBe('stop')
    expect(decision.userNotice).toBeNull()
    expect(state.state.goal?.status).toBe('paused')
    expect(state.state.goal?.stopReason).toBeNull()
  })

  test('gates evaluator to main-thread non-plan active goals', () => {
    const goal = createThreadGoal({ objective: 'Ship', tokenBudget: null, now: 1 })

    expect(
      shouldRunGoalEvaluator({
        goal,
        permissionMode: 'default',
      }),
    ).toBe(true)
    expect(
      shouldRunGoalEvaluator({
        goal,
        agentId: 'agent-1',
        permissionMode: 'default',
      }),
    ).toBe(false)
    expect(
      shouldRunGoalEvaluator({
        goal,
        permissionMode: 'plan',
      }),
    ).toBe(false)
    expect(
      shouldRunGoalEvaluator({
        goal: { ...goal, status: 'budget_limited' },
        permissionMode: 'default',
      }),
    ).toBe(false)
  })
})
