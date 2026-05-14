import { describe, expect, test } from 'bun:test'
import {
  advanceGoalAutoContinue,
  createThreadGoal,
  markGoalComplete,
  markGoalEvaluatorFailed,
  maybeResumeBudgetLimitedGoal,
  parseGoalCommandArgs,
  pauseGoal,
  resumeGoal,
} from '../../utils/goalState.js'

describe('goal state machine', () => {
  test('only active goals can be paused', () => {
    const active = createThreadGoal({
      objective: 'Ship',
      tokenBudget: null,
      now: 1,
    })
    expect(pauseGoal(active, 2)?.status).toBe('paused')
    expect(pauseGoal({ ...active, status: 'complete' }, 2)).toBeNull()
    expect(pauseGoal({ ...active, status: 'budget_limited' }, 2)).toBeNull()
  })

  test('only paused goals can be resumed', () => {
    const active = createThreadGoal({
      objective: 'Ship',
      tokenBudget: null,
      now: 1,
    })
    expect(
      resumeGoal(
        {
          ...active,
          status: 'paused',
          autoContinueTurns: 3,
          lastEvaluatorReason: 'Old reason',
        },
        2,
      ),
    ).toMatchObject({
      status: 'active',
      autoContinueTurns: 0,
      lastEvaluatorReason: null,
      stopReason: null,
    })
    expect(resumeGoal(active, 2)).toBeNull()
    expect(resumeGoal({ ...active, status: 'complete' }, 2)).toBeNull()
  })

  test('budget-limited goals require a larger budget to resume', () => {
    const goal = {
      ...createThreadGoal({ objective: 'Ship', tokenBudget: 100, now: 1 }),
      status: 'budget_limited' as const,
      tokensUsed: 120,
      stopReason: 'budget_limited' as const,
    }

    expect(
      maybeResumeBudgetLimitedGoal({
        goal,
        objective: 'Ship',
        tokenBudget: 120,
        now: 2,
      }),
    ).toBeNull()
    expect(
      maybeResumeBudgetLimitedGoal({
        goal,
        objective: 'Ship',
        tokenBudget: 150,
        now: 2,
      }),
    ).toMatchObject({
      status: 'active',
      tokenBudget: 150,
      stopReason: null,
    })
  })

  test('auto-continue pauses after max turns', () => {
    const goal = {
      ...createThreadGoal({ objective: 'Ship', tokenBudget: null, now: 1 }),
      autoContinueTurns: 5,
      maxAutoContinueTurns: 5,
    }

    const result = advanceGoalAutoContinue({
      goal,
      reason: 'Still missing tests.',
      now: 2,
    })

    expect(result.shouldContinue).toBe(false)
    expect(result.goal.status).toBe('paused')
    expect(result.goal.stopReason).toBe('max_auto_continue_turns')
  })

  test('complete goals receive completion metadata', () => {
    const goal = createThreadGoal({ objective: 'Ship', tokenBudget: null, now: 1 })
    const complete = markGoalComplete(goal, 2)

    expect(complete).toMatchObject({
      status: 'complete',
      completedAt: 2,
      stopReason: 'complete',
    })
  })

  test('evaluator failures pause the goal with a visible stop reason', () => {
    const goal = createThreadGoal({ objective: 'Ship', tokenBudget: null, now: 1 })
    const failed = markGoalEvaluatorFailed({
      goal,
      reason: 'Evaluator failed.',
      now: 2,
    })

    expect(failed).toMatchObject({
      status: 'paused',
      lastEvaluatorReason: 'Evaluator failed.',
      stopReason: 'evaluator_failed',
    })
  })

  test('rejects zero budgets as invalid budget input', () => {
    expect(parseGoalCommandArgs('Ship --budget 0')).toMatchObject({
      kind: 'invalid',
      message: '--budget must be a positive integer.',
    })
  })

  test('rejects partially numeric budget values', () => {
    expect(parseGoalCommandArgs('Ship --budget 10abc')).toMatchObject({
      kind: 'invalid',
      message: '--budget must be a positive integer.',
    })
  })

  test('allows objectives that contain budget-like words', () => {
    expect(parseGoalCommandArgs('Document the --budgeting behavior')).toMatchObject({
      kind: 'set',
      args: {
        objective: 'Document the --budgeting behavior',
        tokenBudget: null,
      },
    })
  })
})
