import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import type { ThreadGoal } from '../../types/goal.js'
import {
  createThreadGoal,
  GOAL_OPTIONS_USAGE,
  maybeResumeBudgetLimitedGoal,
  normalizeGoal,
  parseGoalCommandArgs,
  pauseGoal,
  replaceGoal,
  resumeGoal,
} from '../../utils/goalState.js'

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remHours = hours % 24
    return `${days}d ${remHours}h ${remMinutes}m`
  }
  return remMinutes === 0 ? `${hours}h` : `${hours}h ${remMinutes}m`
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

// Keep auto-execution explicit when a verify command is set.
function goalDetailsSuffix(
  tokenBudget: number | null,
  verifyCommand?: string | null,
): string {
  const budget = tokenBudget
    ? ` (budget: ${formatTokens(tokenBudget)} tokens)`
    : ''
  const verify = verifyCommand
    ? `\nVerify command will run automatically each turn: ${verifyCommand}`
    : ''
  return budget + verify
}

function formatStopReason(goal: ThreadGoal): string | null {
  const current = normalizeGoal(goal)
  if (!current.stopReason) return null
  switch (current.stopReason) {
    case 'budget_limited':
      return 'Token budget reached. Increase the budget to resume.'
    case 'max_auto_continue_turns':
      return `Paused after ${current.maxAutoContinueTurns} auto-continue turns. Use /goal resume to continue.`
    case 'evaluator_failed':
      return 'Evaluator failed. Use /goal resume to try again.'
    case 'complete':
      return 'Goal is complete.'
  }
  return null
}

function buildGoalSummary(goal: ThreadGoal): string {
  const current = normalizeGoal(goal)
  const parts = [`Goal: ${current.objective}`, `Status: ${current.status}`]
  if (current.timeUsedSeconds > 0) {
    parts.push(`Time: ${formatElapsed(current.timeUsedSeconds)}`)
  }
  if (current.tokenBudget) {
    parts.push(
      `Tokens: ${formatTokens(current.tokensUsed)} / ${formatTokens(current.tokenBudget)}`,
    )
  } else if (current.tokensUsed > 0) {
    parts.push(`Tokens: ${formatTokens(current.tokensUsed)}`)
  }
  parts.push(
    `Auto-continue: ${current.autoContinueTurns} / ${current.maxAutoContinueTurns}`,
  )
  if (current.verifyCommand) {
    parts.push(`Verify: ${current.verifyCommand} (runs each turn)`)
  }
  if (current.lastEvaluatorReason) {
    parts.push(`Last evaluator: ${current.lastEvaluatorReason}`)
  }
  const stopReason = formatStopReason(current)
  if (stopReason) {
    parts.push(`Stop reason: ${stopReason}`)
  }
  const commands =
    current.status === 'active'
      ? 'Commands: /goal pause, /goal clear'
      : current.status === 'paused'
        ? 'Commands: /goal resume, /goal clear'
        : current.status === 'budget_limited'
          ? 'Commands: /goal <same objective> --budget N, /goal clear'
        : 'Commands: /goal clear'
  parts.push(commands)
  return parts.join('\n')
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const { getAppState, setAppState } = context
  const action = parseGoalCommandArgs(args)

  // Bare /goal — show current goal
  if (action.kind === 'show') {
    const goal = getAppState().goal
    if (!goal) {
      onDone(
        `No goal is currently set.\n\nUsage: /goal <objective> ${GOAL_OPTIONS_USAGE}`,
      )
      return null
    }
    onDone(buildGoalSummary(goal))
    return null
  }

  if (action.kind === 'invalid') {
    onDone(action.message)
    return null
  }

  // Subcommands — read-modify-write done inside the setAppState callback so
  // a concurrent /goal clear or token-accounting update can't race us.
  if (action.kind === 'pause') {
    const box: { result: 'paused' | 'invalid' | 'missing'; status?: string } = {
      result: 'missing',
    }
    setAppState(prev => {
      if (!prev.goal) return prev
      const next = pauseGoal(prev.goal, Date.now())
      if (!next) {
        box.result = 'invalid'
        box.status = normalizeGoal(prev.goal).status
        return prev
      }
      box.result = 'paused'
      return { ...prev, goal: next }
    })
    onDone(
      box.result === 'paused'
        ? 'Goal paused.'
        : box.result === 'invalid'
          ? `Cannot pause goal with status: ${box.status}.`
          : 'No goal to pause.',
    )
    return null
  }

  if (action.kind === 'resume') {
    const box: { result: 'resumed' | 'invalid' | 'missing'; status?: string } = {
      result: 'missing',
    }
    setAppState(prev => {
      if (!prev.goal) return prev
      const next = resumeGoal(prev.goal, Date.now())
      if (!next) {
        box.result = 'invalid'
        box.status = normalizeGoal(prev.goal).status
        return prev
      }
      box.result = 'resumed'
      return { ...prev, goal: next }
    })
    onDone(
      box.result === 'resumed'
        ? 'Goal resumed.'
        : box.result === 'invalid'
          ? `Cannot resume goal with status: ${box.status}.`
          : 'No goal to resume.',
    )
    return null
  }

  if (action.kind === 'clear') {
    let hadGoal = false
    setAppState(prev => {
      if (!prev.goal) return prev
      hadGoal = true
      return { ...prev, goal: undefined }
    })
    onDone(hadGoal ? 'Goal cleared.' : 'No goal to clear.')
    return null
  }

  const now = Date.now()
  if (action.kind === 'replace') {
    setAppState(prev => ({
      ...prev,
      goal: replaceGoal({ ...action.args, now }),
    }))
    onDone(
      `Goal replaced: ${action.args.objective}${goalDetailsSuffix(action.args.tokenBudget, action.args.verifyCommand)}`,
    )
    return null
  }

  const { objective, tokenBudget } = action.args
  const box: {
    outcome:
      | 'set'
      | 'budget_resumed'
      | 'conflict'
      | 'budget_too_small'
    existing?: ThreadGoal
  } = {
    outcome: 'set',
  }
  setAppState(prev => {
    const existing = prev.goal
    if (existing) {
      const current = normalizeGoal(existing)
      if (current.status === 'budget_limited') {
        const resumed = maybeResumeBudgetLimitedGoal({
          goal: current,
          ...action.args,
          now,
        })
        if (resumed) {
          box.outcome = 'budget_resumed'
          return { ...prev, goal: resumed }
        }
        if (current.objective === objective) {
          box.outcome = 'budget_too_small'
          box.existing = current
          return prev
        }
      }

      if (current.status === 'complete') {
        box.outcome = 'set'
        return { ...prev, goal: createThreadGoal({ ...action.args, now }) }
      }

      box.outcome = 'conflict'
      box.existing = current
      return prev
    }
    box.outcome = 'set'
    return { ...prev, goal: createThreadGoal({ ...action.args, now }) }
  })

  const details = goalDetailsSuffix(tokenBudget, action.args.verifyCommand)
  if (box.outcome === 'budget_resumed') {
    onDone(`Goal resumed with new budget: ${objective}${details}`)
  } else if (box.outcome === 'conflict') {
    onDone(
      `A goal is already ${box.existing?.status}: ${box.existing?.objective}\n\nUse /goal replace <objective> to replace it, or /goal clear first.`,
    )
  } else if (box.outcome === 'budget_too_small') {
    onDone(
      `Goal is budget_limited. Provide a larger budget than current usage (${formatTokens(box.existing?.tokensUsed ?? 0)} tokens).`,
    )
  } else {
    onDone(`Goal set: ${objective}${details}`)
  }
  return null
}
