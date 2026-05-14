import type { ThreadGoal } from '../types/goal.js'

export const DEFAULT_MAX_GOAL_AUTO_CONTINUE_TURNS = 5

type GoalArgs = {
  objective: string
  tokenBudget: number | null
}

export type GoalCommandAction =
  | { kind: 'show' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'clear' }
  | { kind: 'replace'; args: GoalArgs }
  | { kind: 'set'; args: GoalArgs }
  | { kind: 'invalid'; message: string }

export function normalizeGoal(goal: ThreadGoal): ThreadGoal {
  return {
    ...goal,
    autoContinueTurns: goal.autoContinueTurns ?? 0,
    maxAutoContinueTurns:
      goal.maxAutoContinueTurns ?? DEFAULT_MAX_GOAL_AUTO_CONTINUE_TURNS,
    lastEvaluatorReason: goal.lastEvaluatorReason ?? null,
    completedAt: goal.completedAt ?? null,
    stopReason: goal.stopReason ?? null,
  }
}

export function createThreadGoal({
  objective,
  tokenBudget,
  now,
}: GoalArgs & { now: number }): ThreadGoal {
  return {
    objective,
    status: 'active',
    tokenBudget,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    autoContinueTurns: 0,
    maxAutoContinueTurns: DEFAULT_MAX_GOAL_AUTO_CONTINUE_TURNS,
    lastEvaluatorReason: null,
    completedAt: null,
    stopReason: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function parseGoalCommandArgs(args: string): GoalCommandAction {
  const trimmed = args.trim()
  if (!trimmed) return { kind: 'show' }

  const [sub] = trimmed.split(/\s+/)
  if (sub === 'pause') return { kind: 'pause' }
  if (sub === 'resume') return { kind: 'resume' }
  if (sub === 'clear') return { kind: 'clear' }

  if (sub === 'replace') {
    const parsed = parseGoalObjectiveAndBudget(
      trimmed.replace(/^replace(?:\s+|$)/, ''),
    )
    if (parsed === 'invalid_budget') {
      return { kind: 'invalid', message: '--budget must be a positive integer.' }
    }
    return parsed
      ? { kind: 'replace', args: parsed }
      : {
          kind: 'invalid',
          message: 'Please provide an objective.\n\nUsage: /goal replace <objective> [--budget N]',
        }
  }

  const parsed = parseGoalObjectiveAndBudget(trimmed)
  if (parsed === 'invalid_budget') {
    return { kind: 'invalid', message: '--budget must be a positive integer.' }
  }
  return parsed
    ? { kind: 'set', args: parsed }
    : {
        kind: 'invalid',
        message: 'Please provide an objective.\n\nUsage: /goal <objective> [--budget N]',
      }
}

export function parseGoalObjectiveAndBudget(
  args: string,
): GoalArgs | 'invalid_budget' | null {
  const budgetMatch = args.match(/(?:^|\s)--budget\s+(\d+)(?=\s|$)/)
  const hasBudgetFlag = /(?:^|\s)--budget(?:\s|$)/.test(args)
  let tokenBudget: number | null = null
  let objective = args.trim()
  if (hasBudgetFlag && !budgetMatch) {
    return 'invalid_budget'
  }
  if (budgetMatch) {
    const parsed = parseInt(budgetMatch[1]!, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return 'invalid_budget'
    tokenBudget = parsed
    objective = args.replace(/(?:^|\s)--budget\s+\d+(?=\s|$)/, ' ').trim()
  }
  if (!objective) return null
  return { objective, tokenBudget }
}

export function pauseGoal(goal: ThreadGoal, now: number): ThreadGoal | null {
  const current = normalizeGoal(goal)
  if (current.status !== 'active') return null
  return { ...current, status: 'paused', updatedAt: now }
}

export function resumeGoal(goal: ThreadGoal, now: number): ThreadGoal | null {
  const current = normalizeGoal(goal)
  if (current.status !== 'paused') return null
  return {
    ...current,
    status: 'active',
    autoContinueTurns: 0,
    lastEvaluatorReason: null,
    stopReason: null,
    updatedAt: now,
  }
}

export function markGoalComplete(goal: ThreadGoal, now: number): ThreadGoal | null {
  const current = normalizeGoal(goal)
  if (current.status === 'complete') return null
  return {
    ...current,
    status: 'complete',
    completedAt: now,
    stopReason: 'complete',
    updatedAt: now,
  }
}

export function maybeResumeBudgetLimitedGoal({
  goal,
  objective,
  tokenBudget,
  now,
}: GoalArgs & { goal: ThreadGoal; now: number }): ThreadGoal | null {
  const current = normalizeGoal(goal)
  if (
    current.status !== 'budget_limited' ||
    current.objective !== objective ||
    tokenBudget === null ||
    tokenBudget <= current.tokensUsed
  ) {
    return null
  }
  return {
    ...current,
    status: 'active',
    tokenBudget,
    autoContinueTurns: 0,
    lastEvaluatorReason: null,
    stopReason: null,
    updatedAt: now,
  }
}

export function replaceGoal(args: GoalArgs & { now: number }): ThreadGoal {
  return createThreadGoal(args)
}

export function markGoalBudgetLimited(goal: ThreadGoal, now: number): ThreadGoal {
  const current = normalizeGoal(goal)
  return {
    ...current,
    status: 'budget_limited',
    stopReason: 'budget_limited',
    updatedAt: now,
  }
}

export function markGoalEvaluatorFailed({
  goal,
  reason,
  now,
}: {
  goal: ThreadGoal
  reason: string
  now: number
}): ThreadGoal {
  const current = normalizeGoal(goal)
  return {
    ...current,
    status: 'paused',
    lastEvaluatorReason: reason,
    stopReason: 'evaluator_failed',
    updatedAt: now,
  }
}

export function recordGoalEvaluatorResult({
  goal,
  reason,
  now,
}: {
  goal: ThreadGoal
  reason: string
  now: number
}): ThreadGoal {
  const current = normalizeGoal(goal)
  return {
    ...current,
    lastEvaluatorReason: reason,
    updatedAt: now,
  }
}

export function advanceGoalAutoContinue({
  goal,
  reason,
  now,
}: {
  goal: ThreadGoal
  reason: string
  now: number
}): { goal: ThreadGoal; shouldContinue: boolean } {
  const current = normalizeGoal(goal)
  const nextTurns = current.autoContinueTurns + 1
  if (nextTurns > current.maxAutoContinueTurns) {
    return {
      shouldContinue: false,
      goal: {
        ...current,
        status: 'paused',
        autoContinueTurns: current.maxAutoContinueTurns,
        lastEvaluatorReason: reason,
        stopReason: 'max_auto_continue_turns',
        updatedAt: now,
      },
    }
  }
  return {
    shouldContinue: true,
    goal: {
      ...current,
      autoContinueTurns: nextTurns,
      lastEvaluatorReason: reason,
      updatedAt: now,
    },
  }
}
