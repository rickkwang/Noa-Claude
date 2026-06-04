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
      ...createThreadGoal({
        objective: 'Ship',
        tokenBudget: 100,
        maxAutoContinueTurns: 5,
        verifyCommand: 'old-check',
        now: 1,
      }),
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
        maxAutoContinueTurns: 9,
        verifyCommand: 'new-check',
        now: 2,
      }),
    ).toMatchObject({
      status: 'active',
      tokenBudget: 150,
      maxAutoContinueTurns: 9,
      verifyCommand: 'new-check',
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

  test('parses --max-turns into maxAutoContinueTurns', () => {
    expect(parseGoalCommandArgs('Ship it --max-turns 12')).toMatchObject({
      kind: 'set',
      args: {
        objective: 'Ship it',
        tokenBudget: null,
        maxAutoContinueTurns: 12,
      },
    })
  })

  test('rejects non-positive --max-turns', () => {
    expect(parseGoalCommandArgs('Ship --max-turns 0')).toMatchObject({
      kind: 'invalid',
      message: '--max-turns must be a positive integer.',
    })
    expect(parseGoalCommandArgs('Ship --max-turns')).toMatchObject({
      kind: 'invalid',
      message: '--max-turns must be a positive integer.',
    })
  })

  test('parses --verify into verifyCommand and strips it from objective', () => {
    expect(
      parseGoalCommandArgs('Fix types --verify "bun run typecheck"'),
    ).toMatchObject({
      kind: 'set',
      args: {
        objective: 'Fix types',
        verifyCommand: 'bun run typecheck',
      },
    })
  })

  test('rejects empty --verify command', () => {
    expect(parseGoalCommandArgs('Fix types --verify ""')).toMatchObject({
      kind: 'invalid',
      message: '--verify must be a non-empty command.',
    })
  })

  test('rejects a trailing --verify with no value', () => {
    expect(parseGoalCommandArgs('Fix types --verify')).toMatchObject({
      kind: 'invalid',
      message: '--verify must be a non-empty command.',
    })
  })

  test('rejects an unterminated quoted --verify command', () => {
    expect(
      parseGoalCommandArgs('Fix types --verify "bun run typecheck'),
    ).toMatchObject({
      kind: 'invalid',
      message: '--verify must be a non-empty, valid quoted command.',
    })
  })

  test('parses escaped quotes inside a quoted --verify command', () => {
    expect(
      parseGoalCommandArgs(
        'Fix types --verify "node -e \\"process.exit(0)\\""',
      ),
    ).toMatchObject({
      kind: 'set',
      args: {
        objective: 'Fix types',
        verifyCommand: 'node -e "process.exit(0)"',
      },
    })
  })

  test('accepts an unquoted single-token --verify command', () => {
    expect(parseGoalCommandArgs('Fix types --verify make')).toMatchObject({
      kind: 'set',
      args: { objective: 'Fix types', verifyCommand: 'make' },
    })
  })

  test('combines --budget, --max-turns and --verify', () => {
    expect(
      parseGoalCommandArgs(
        'Ship --budget 5000 --max-turns 8 --verify "make test"',
      ),
    ).toMatchObject({
      kind: 'set',
      args: {
        objective: 'Ship',
        tokenBudget: 5000,
        maxAutoContinueTurns: 8,
        verifyCommand: 'make test',
      },
    })
  })

  test('rejects duplicate goal flags instead of adding them to the objective', () => {
    expect(parseGoalCommandArgs('Ship --budget 5 --budget 6')).toMatchObject({
      kind: 'invalid',
      message: '--budget may only be specified once.',
    })
    expect(
      parseGoalCommandArgs('Ship --max-turns 2 --max-turns 3'),
    ).toMatchObject({
      kind: 'invalid',
      message: '--max-turns may only be specified once.',
    })
    expect(
      parseGoalCommandArgs('Ship --verify "check-a" --verify "check-b"'),
    ).toMatchObject({
      kind: 'invalid',
      message: '--verify may only be specified once.',
    })
  })

  test('createThreadGoal honors verifyCommand and maxAutoContinueTurns', () => {
    const goal = createThreadGoal({
      objective: 'Ship',
      tokenBudget: null,
      maxAutoContinueTurns: 9,
      verifyCommand: 'bun test',
      now: 1,
    })
    expect(goal.maxAutoContinueTurns).toBe(9)
    expect(goal.verifyCommand).toBe('bun test')
  })

  test('treats control words with extra text as objectives', () => {
    expect(parseGoalCommandArgs('clear cache issue')).toMatchObject({
      kind: 'set',
      args: {
        objective: 'clear cache issue',
        tokenBudget: null,
      },
    })
    expect(parseGoalCommandArgs('pause release work')).toMatchObject({
      kind: 'set',
      args: {
        objective: 'pause release work',
        tokenBudget: null,
      },
    })
    expect(parseGoalCommandArgs('resume migration')).toMatchObject({
      kind: 'set',
      args: {
        objective: 'resume migration',
        tokenBudget: null,
      },
    })
  })
})
