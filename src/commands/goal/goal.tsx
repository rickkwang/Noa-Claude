import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import type { ThreadGoal } from '../../types/goal.js'

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

function buildGoalSummary(goal: ThreadGoal): string {
  const parts = [`Goal: ${goal.objective}`, `Status: ${goal.status}`]
  if (goal.timeUsedSeconds > 0) {
    parts.push(`Time: ${formatElapsed(goal.timeUsedSeconds)}`)
  }
  if (goal.tokenBudget) {
    parts.push(
      `Tokens: ${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget)}`,
    )
  } else if (goal.tokensUsed > 0) {
    parts.push(`Tokens: ${formatTokens(goal.tokensUsed)}`)
  }
  const commands =
    goal.status === 'active'
      ? 'Commands: /goal pause, /goal clear'
      : goal.status === 'paused'
        ? 'Commands: /goal resume, /goal clear'
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
  const trimmed = args.trim()

  // Bare /goal — show current goal
  if (!trimmed) {
    const goal = getAppState().goal
    if (!goal) {
      onDone('No goal is currently set.\n\nUsage: /goal <objective> [--budget N]')
      return null
    }
    onDone(buildGoalSummary(goal))
    return null
  }

  const argList = trimmed.split(/\s+/).filter(Boolean)
  const sub = argList[0]

  // Subcommands — read-modify-write done inside the setAppState callback so
  // a concurrent /goal clear or token-accounting update can't race us.
  if (sub === 'pause') {
    const box: { result: 'paused' | 'already' | 'missing' } = { result: 'missing' }
    setAppState(prev => {
      if (!prev.goal) return prev
      if (prev.goal.status === 'paused') {
        box.result = 'already'
        return prev
      }
      box.result = 'paused'
      return {
        ...prev,
        goal: { ...prev.goal, status: 'paused', updatedAt: Date.now() },
      }
    })
    onDone(
      box.result === 'paused'
        ? 'Goal paused.'
        : box.result === 'already'
          ? 'Goal is already paused.'
          : 'No goal to pause.',
    )
    return null
  }

  if (sub === 'resume') {
    const box: { result: 'resumed' | 'already' | 'missing' } = { result: 'missing' }
    setAppState(prev => {
      if (!prev.goal) return prev
      if (prev.goal.status === 'active') {
        box.result = 'already'
        return prev
      }
      box.result = 'resumed'
      return {
        ...prev,
        goal: { ...prev.goal, status: 'active', updatedAt: Date.now() },
      }
    })
    onDone(
      box.result === 'resumed'
        ? 'Goal resumed.'
        : box.result === 'already'
          ? 'Goal is already active.'
          : 'No goal to resume.',
    )
    return null
  }

  if (sub === 'clear') {
    let hadGoal = false
    setAppState(prev => {
      if (!prev.goal) return prev
      hadGoal = true
      return { ...prev, goal: undefined }
    })
    onDone(hadGoal ? 'Goal cleared.' : 'No goal to clear.')
    return null
  }

  // Parse --budget flag. Reject 0/negative (regex already excludes negative).
  let tokenBudget: number | null = null
  let objectiveText = trimmed
  const budgetMatch = trimmed.match(/--budget\s+(\d+)/)
  if (budgetMatch) {
    const parsed = parseInt(budgetMatch[1]!, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      onDone('--budget must be a positive integer.')
      return null
    }
    tokenBudget = parsed
    objectiveText = trimmed.replace(/--budget\s+\d+/, '').trim()
  }

  if (!objectiveText) {
    onDone('Please provide an objective.\n\nUsage: /goal <objective> [--budget N]')
    return null
  }

  // Set / replace / reactivate the goal — all three branches handled inside
  // the callback so the existing-goal check sees current state.
  const now = Date.now()
  const box: { outcome: 'reactivated' | 'updated_budget' | 'set' } = {
    outcome: 'set',
  }
  setAppState(prev => {
    const existing = prev.goal
    if (
      existing &&
      existing.objective === objectiveText &&
      existing.status !== 'complete'
    ) {
      const nextBudget = tokenBudget ?? existing.tokenBudget
      const budgetChanged = nextBudget !== existing.tokenBudget
      const statusChanged = existing.status !== 'active'
      if (!budgetChanged && !statusChanged) {
        box.outcome = 'reactivated'
        return prev
      }
      box.outcome = budgetChanged ? 'updated_budget' : 'reactivated'
      return {
        ...prev,
        goal: {
          ...existing,
          status: 'active',
          tokenBudget: nextBudget,
          updatedAt: now,
        },
      }
    }
    box.outcome = 'set'
    return {
      ...prev,
      goal: {
        objective: objectiveText,
        status: 'active',
        tokenBudget,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: now,
        updatedAt: now,
      },
    }
  })

  const budgetStr = tokenBudget
    ? ` (budget: ${formatTokens(tokenBudget)} tokens)`
    : ''
  if (box.outcome === 'reactivated') {
    onDone(`Goal active: ${objectiveText}`)
  } else if (box.outcome === 'updated_budget') {
    onDone(`Goal active: ${objectiveText}${budgetStr}`)
  } else {
    onDone(`Goal set: ${objectiveText}${budgetStr}`)
  }
  return null
}
