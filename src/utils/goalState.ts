import type { ThreadGoal } from '../types/goal.js'

export const DEFAULT_MAX_GOAL_AUTO_CONTINUE_TURNS = 5

type GoalArgs = {
  objective: string
  tokenBudget: number | null
  maxAutoContinueTurns?: number | null
  verifyCommand?: string | null
}

type GoalFlagError =
  | 'invalid_budget'
  | 'invalid_max_turns'
  | 'invalid_verify'
  | 'invalid_verify_syntax'
  | 'duplicate_budget'
  | 'duplicate_max_turns'
  | 'duplicate_verify'

export type GoalCommandAction =
  | { kind: 'show' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'clear' }
  | { kind: 'replace'; args: GoalArgs }
  | { kind: 'set'; args: GoalArgs }
  | { kind: 'invalid'; message: string }

export const GOAL_OPTIONS_USAGE =
  '[--budget N] [--max-turns N] [--verify "<cmd>"]'

const GOAL_FLAG_ERROR_MESSAGES: Record<GoalFlagError, string> = {
  invalid_budget: '--budget must be a positive integer.',
  invalid_max_turns: '--max-turns must be a positive integer.',
  invalid_verify: '--verify must be a non-empty command.',
  invalid_verify_syntax: '--verify must be a non-empty, valid quoted command.',
  duplicate_budget: '--budget may only be specified once.',
  duplicate_max_turns: '--max-turns may only be specified once.',
  duplicate_verify: '--verify may only be specified once.',
}

export function normalizeGoal(goal: ThreadGoal): ThreadGoal {
  return {
    ...goal,
    verifyCommand: goal.verifyCommand ?? null,
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
  maxAutoContinueTurns,
  verifyCommand,
  now,
}: GoalArgs & { now: number }): ThreadGoal {
  return {
    objective,
    status: 'active',
    tokenBudget,
    verifyCommand: verifyCommand ?? null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    autoContinueTurns: 0,
    maxAutoContinueTurns:
      maxAutoContinueTurns ?? DEFAULT_MAX_GOAL_AUTO_CONTINUE_TURNS,
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

  if (trimmed === 'pause') return { kind: 'pause' }
  if (trimmed === 'resume') return { kind: 'resume' }
  if (trimmed === 'clear') return { kind: 'clear' }

  const isReplace = /^replace(?:\s+|$)/.test(trimmed)
  const kind = isReplace ? 'replace' : 'set'
  const parsed = parseGoalObjectiveAndBudget(
    isReplace ? trimmed.replace(/^replace(?:\s+|$)/, '') : trimmed,
  )
  if (typeof parsed === 'string') {
    return { kind: 'invalid', message: GOAL_FLAG_ERROR_MESSAGES[parsed] }
  }
  if (parsed) return { kind, args: parsed }
  const command = isReplace ? '/goal replace' : '/goal'
  return {
    kind: 'invalid',
    message: `Please provide an objective.\n\nUsage: ${command} <objective> ${GOAL_OPTIONS_USAGE}`,
  }
}

function extractVerifyCommand(
  args: string,
): { objective: string; verifyCommand: string | null } | GoalFlagError {
  const flagMatch = /(^|\s)--verify(?=\s|$)/.exec(args)
  if (!flagMatch) return { objective: args, verifyCommand: null }

  let cursor = flagMatch.index + flagMatch[0].length
  while (cursor < args.length && /\s/.test(args[cursor]!)) cursor++
  if (cursor >= args.length) return 'invalid_verify'

  let command = ''
  const quote =
    args[cursor] === '"' || args[cursor] === "'" ? args[cursor] : null
  if (quote) {
    cursor++
    let closed = false
    while (cursor < args.length) {
      const char = args[cursor]!
      if (char === quote) {
        cursor++
        closed = true
        break
      }
      if (
        char === '\\' &&
        cursor + 1 < args.length &&
        (args[cursor + 1] === quote || args[cursor + 1] === '\\')
      ) {
        command += args[cursor + 1]
        cursor += 2
        continue
      }
      command += char
      cursor++
    }
    if (!closed || (cursor < args.length && !/\s/.test(args[cursor]!))) {
      return 'invalid_verify_syntax'
    }
  } else {
    while (cursor < args.length && !/\s/.test(args[cursor]!)) {
      command += args[cursor]
      cursor++
    }
  }

  command = command.trim()
  if (!command) return 'invalid_verify'
  return {
    objective: `${args.slice(0, flagMatch.index)} ${args.slice(cursor)}`.trim(),
    verifyCommand: command,
  }
}

function extractPositiveIntegerFlag(
  args: string,
  flag: '--budget' | '--max-turns',
  errorKey: 'budget' | 'max_turns',
): { objective: string; value: number | null } | GoalFlagError {
  const marker = new RegExp(`(?:^|\\s)${flag}(?=\\s|$)`, 'g')
  const occurrences = args.match(marker)?.length ?? 0
  if (occurrences > 1) return `duplicate_${errorKey}`
  if (occurrences === 0) return { objective: args, value: null }

  const valuePattern = new RegExp(`(?:^|\\s)${flag}\\s+(\\d+)(?=\\s|$)`)
  const match = args.match(valuePattern)
  if (!match) return `invalid_${errorKey}`
  const value = Number.parseInt(match[1]!, 10)
  if (!Number.isFinite(value) || value <= 0) return `invalid_${errorKey}`
  return {
    objective: args.replace(valuePattern, ' ').trim(),
    value,
  }
}

export function parseGoalObjectiveAndBudget(
  args: string,
): GoalArgs | GoalFlagError | null {
  let objective = args.trim()

  // Extract verify first so flags inside its quoted command stay untouched.
  const verify = extractVerifyCommand(objective)
  if (typeof verify === 'string') return verify
  const { verifyCommand } = verify
  objective = verify.objective
  if (verifyCommand && /(?:^|\s)--verify(?=\s|$)/.test(objective)) {
    return 'duplicate_verify'
  }

  const budget = extractPositiveIntegerFlag(objective, '--budget', 'budget')
  if (typeof budget === 'string') return budget
  objective = budget.objective

  const maxTurns = extractPositiveIntegerFlag(
    objective,
    '--max-turns',
    'max_turns',
  )
  if (typeof maxTurns === 'string') return maxTurns
  objective = maxTurns.objective

  if (!objective) return null
  return {
    objective,
    tokenBudget: budget.value,
    maxAutoContinueTurns: maxTurns.value,
    verifyCommand,
  }
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
  maxAutoContinueTurns,
  verifyCommand,
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
    verifyCommand: verifyCommand ?? current.verifyCommand,
    autoContinueTurns: 0,
    maxAutoContinueTurns:
      maxAutoContinueTurns ?? current.maxAutoContinueTurns,
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
