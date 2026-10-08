import type { AppState } from '../state/AppStateStore.js'
import type { ApiFailureCategory, Message, UserMessage } from '../types/message.js'
import type { ThreadGoal } from '../types/goal.js'
import {
  advanceGoalAutoContinue,
  markGoalComplete,
  normalizeGoal,
  recordGoalEvaluatorResult,
} from './goalState.js'
import { logGoalAudit } from './goalAudit.js'
import { createSystemMessage, createUserMessage } from './messages.js'
import {
  GOAL_CONTINUATION_MARKER,
  GOAL_CONTINUATION_REASON_PREFIX,
  formatGoalAutoContinueNotice,
  formatGoalCompleteNotice,
  formatGoalPausedNotice,
} from './goalNotices.js'

export type GoalRuntimeEvaluation = {
  achieved: boolean
  impossible?: boolean
  reason: string
}

export type GoalRuntimeDecision =
  | { action: 'stop'; userNotice: Message | null }
  | { action: 'continue'; modelNotice: UserMessage; userNotice: Message | null }

export type GoalEvaluatorAction = 'run' | 'skip'

const MAX_IDLE_CHECK_INS = 3
const GOAL_RETRY_DELAYS_MS = [60_000, 300_000, 900_000]
const MAX_GOAL_RETRIES = GOAL_RETRY_DELAYS_MS.length
// A failure that a new user prompt may fix; other paused goals wait for /goal resume.
const PROMPT_RESUMABLE_STOP_REASONS = new Set(['rate_limit', 'retry_exhausted', 'turn_failed', 'no_progress'])
const MAX_NO_PROGRESS_TURNS = 3

export function isSameGoal(a: ThreadGoal | undefined, b: ThreadGoal): boolean {
  return !!a && a.createdAt === b.createdAt && a.objective === b.objective
}

export function goalFailureCategory(message: Message): ApiFailureCategory {
  if (message.type !== 'assistant') return 'other'
  if (message.apiFailureCategory && message.apiFailureCategory !== 'other') return message.apiFailureCategory
  switch (message.error) {
    case 'authentication_failed': return 'auth'
    case 'billing_error': return 'credit'
    case 'rate_limit': return 'rate_limit'
    case 'server_error':
    case 'max_output_tokens':
    case 'unknown': return 'transient'
    default: return 'other'
  }
}

function checkInIntervalMs(): number {
  const raw = process.env.CLAUDE_CODE_GOAL_CHECKIN_MINUTES
  const minutes = raw === undefined ? 30 : Number(raw)
  return Number.isFinite(minutes) && minutes > 0 ? Math.max(1, minutes * 60_000) : 0
}

export function getGoalBackgroundTasks(state: AppState, goal: ThreadGoal) {
  return Object.values(state.tasks ?? {}).filter(task =>
    task.status === 'running' &&
    task.startTime >= goal.createdAt &&
    (task.type === 'local_bash' || task.type === 'local_agent' || task.type === 'remote_agent') &&
    !('isBackgrounded' in task && task.isBackgrounded === false),
  )
}

function backgroundCheckInPrompt(goal: ThreadGoal, state: AppState): string {
  const tasks = getGoalBackgroundTasks(state, goal)
  const running = tasks.map(task => `- ${task.id}: ${task.description}`).join('\n')
  return `<!-- goal-wake -->\nGoal: ${goal.objective}\n\n${running
    ? `Background work is still running:\n${running}\nRead its output. Keep waiting if it is progressing; fix or stop tasks that are stuck.`
    : 'Background work is no longer running. Continue toward the goal and verify the result.'}`
}

export function deferGoalForBackground({
  goal, getAppState, setAppState, now = Date.now(),
}: {
  goal: ThreadGoal
  getAppState: () => AppState
  setAppState: (updater: (prev: AppState) => AppState) => void
  now?: number
}): { waiting: boolean; modelNotice: UserMessage | null; userNotice: Message | null } {
  const result = { waiting: false, modelNotice: null as UserMessage | null, userNotice: null as Message | null }
  if (getGoalBackgroundTasks(getAppState(), goal).length === 0) {
    setAppState(prev => !isSameGoal(prev.goal, goal) || !prev.goal?.backgroundWaitingSince
      ? prev
      : { ...prev, goal: { ...prev.goal, backgroundWaitingSince: null, nextCheckInAt: null, checkInCount: 0 } })
    return result
  }
  result.waiting = true
  const interval = checkInIntervalMs()
  setAppState(prev => {
    if (!isSameGoal(prev.goal, goal) || prev.goal?.status !== 'active') return prev
    const current = normalizeGoal(prev.goal)
    const since = current.backgroundWaitingSince ?? now
    const due = current.nextCheckInAt ?? (interval ? since + interval : null)
    if (interval && due !== null && now >= due) {
      const advanced = advanceGoalAutoContinue({ goal: current, reason: 'Checking background work.', now })
      if (!advanced.shouldContinue) {
        result.userNotice = createSystemMessage(formatGoalPausedNotice(advanced.goal.maxAutoContinueTurns), 'warning')
        return { ...prev, goal: advanced.goal }
      }
      const count = (current.checkInCount ?? 0) + 1
      result.modelNotice = createUserMessage({ content: backgroundCheckInPrompt(current, prev), isMeta: true })
      return { ...prev, goal: { ...advanced.goal, backgroundWaitingSince: since, checkInCount: count, nextCheckInAt: now + interval * 2 ** Math.min(count, 2) } }
    }
    if (current.backgroundWaitingSince === since && current.nextCheckInAt === due) return prev
    return { ...prev, goal: { ...current, backgroundWaitingSince: since, nextCheckInAt: due } }
  })
  return result
}

export function applyGoalTurnFailure({
  category, goal, setAppState, isNonInteractiveSession, managedAuth = false, now = Date.now(),
}: {
  category: ApiFailureCategory
  goal: ThreadGoal | undefined
  setAppState: (updater: (prev: AppState) => AppState) => void
  isNonInteractiveSession: boolean
  managedAuth?: boolean
  now?: number
}): Message | null {
  if (!goal) return null
  let notice: Message | null = null
  setAppState(prev => {
    if (!isSameGoal(prev.goal, goal) || prev.goal?.status !== 'active') return prev
    const current = normalizeGoal(prev.goal)
    const reset = { retryAt: null, nextCheckInAt: null, backgroundWaitingSince: null }
    // The host restores managed credentials itself, so retry as for an outage.
    const kind = category === 'auth' && managedAuth ? 'transient' : category
    const interval = checkInIntervalMs()
    if (kind === 'transient') {
      if (isNonInteractiveSession) return prev
      const count = current.retryCount ?? 0
      if (interval && count < MAX_GOAL_RETRIES) {
        const delay = Math.min(Math.round(GOAL_RETRY_DELAYS_MS[count]! * (1 + Math.random() * 0.2)), interval)
        notice = createSystemMessage(`Goal still active: API failure; retry ${count + 1}/${MAX_GOAL_RETRIES} in ${Math.max(1, Math.round(delay / 60_000))} min. Send a message to retry now.`, 'warning')
        return { ...prev, goal: { ...current, ...reset, retryCount: count + 1, retryAt: now + delay } }
      }
    }
    const fatal = ['auth', 'credit', 'context', 'model'].includes(kind)
    const reason = fatal ? `Unrecoverable ${kind} error; fix the cause and use /goal resume.`
      : kind === 'transient' ? 'Automatic retries are exhausted or disabled; send a message to continue.'
      : kind === 'rate_limit' ? 'API rate limit; send a message once access resets to continue.'
      : 'The turn ended without a usable result; send a message to continue.'
    notice = createSystemMessage(`Goal paused: ${reason}`, 'warning')
    return { ...prev, goal: { ...current, ...reset, status: 'paused', stopReason: fatal ? 'unrecoverable_error' : kind === 'rate_limit' ? 'rate_limit' : kind === 'transient' ? 'retry_exhausted' : 'turn_failed', lastEvaluatorReason: reason, updatedAt: now } }
  })
  return notice
}

export function getGoalWakeDelay(goal: ThreadGoal | undefined, now = Date.now()): number | null {
  if (!goal || goal.status !== 'active' || !checkInIntervalMs()) return null
  const due = goal.retryAt ?? ((goal.idleCheckInCount ?? 0) < MAX_IDLE_CHECK_INS ? goal.nextCheckInAt : null)
  return due == null ? null : Math.max(0, due - now)
}

export function consumeGoalWake({ goal, getAppState, setAppState, now = Date.now() }: {
  goal: ThreadGoal
  getAppState: () => AppState
  setAppState: (updater: (prev: AppState) => AppState) => void
  now?: number
}): string | null {
  let prompt: string | null = null
  setAppState(prev => {
    if (!isSameGoal(prev.goal, goal) || prev.goal?.status !== 'active' || getGoalWakeDelay(prev.goal, now) !== 0) return prev
    const current = normalizeGoal(prev.goal)
    if (current.retryAt != null) {
      prompt = `<!-- goal-wake -->\nRetry the interrupted turn toward the active goal: ${current.objective}`
      return { ...prev, goal: { ...current, retryAt: null } }
    }
    const count = (current.checkInCount ?? 0) + 1
    const idleCount = (current.idleCheckInCount ?? 0) + 1
    prompt = backgroundCheckInPrompt(current, getAppState())
    if (idleCount >= MAX_IDLE_CHECK_INS) prompt += '\nThis is the third idle check-in; further idle check-ins wait for the next user prompt.'
    return { ...prev, goal: { ...current, checkInCount: count, idleCheckInCount: idleCount, nextCheckInAt: now + checkInIntervalMs() * 2 ** Math.min(count, 2) } }
  })
  return prompt
}

export function decideGoalEvaluatorAction({
  goal,
  agentId,
  permissionMode,
}: {
  goal: ThreadGoal | undefined
  agentId?: string
  permissionMode: string
}): GoalEvaluatorAction {
  if (!goal || agentId || permissionMode === 'plan') return 'skip'
  const current = normalizeGoal(goal)
  if (current.status !== 'active') return 'skip'
  return 'run'
}

// Auto-continue nudge injected mid-loop after the evaluator votes "not yet".
// Intentionally short — the heavyweight per-turn priming (objective wrapping,
// completion audit checklist) is in buildContinuationPrompt() at goalPrompts.ts
// and runs at the start of every fresh user turn, so we don't repeat it here.
export function buildGoalContinuationMessage(goal: ThreadGoal): string {
  const reasonLine = goal.lastEvaluatorReason
    ? `${GOAL_CONTINUATION_REASON_PREFIX}${goal.lastEvaluatorReason}`
    : `${GOAL_CONTINUATION_REASON_PREFIX}Goal is not complete yet.`
  return `${GOAL_CONTINUATION_MARKER}
${reasonLine}

Continue working toward the active thread goal. Choose the next concrete action that moves the objective closer to completion, avoid repeating completed work, and call the goal tool with operation "update_goal" and status "complete" only when the objective is actually complete.`
}

// maxAutoContinueTurns caps auto-continues WITHIN one user turn, mirroring the
// stop-hook block cap (query.ts) which also resets per turn. Without this reset
// the counter accumulated for the lifetime of the goal, so a goal with the
// default cap of 5 stopped auto-continuing forever after its 5th continuation
// and needed a manual /goal resume. Only 'active' goals reset: a goal already
// paused at the cap must stay paused until the user resumes it. A user prompt
// does resume a goal paused by a failure it may have fixed (see
// PROMPT_RESUMABLE_STOP_REASONS), as official CC continues on the next message.
export function resetGoalAutoContinueForNewTurn({
  setAppState,
  resetWakeCounters = true,
}: {
  setAppState: (updater: (prev: AppState) => AppState) => void
  resetWakeCounters?: boolean
}): void {
  setAppState(prev => {
    if (!prev.goal) return prev
    const current = normalizeGoal(prev.goal)
    if (resetWakeCounters && current.status === 'paused' && PROMPT_RESUMABLE_STOP_REASONS.has(current.stopReason ?? '')) {
      return { ...prev, goal: { ...current, status: 'active', stopReason: null, lastEvaluatorReason: null, autoContinueTurns: 0, idleCheckInCount: 0, retryCount: 0, retryAt: null, noProgressTurns: 0, backgroundWaitingSince: null, nextCheckInAt: null, checkInCount: 0, updatedAt: Date.now() } }
    }
    if (current.status !== 'active' || (current.autoContinueTurns === 0 && !resetWakeCounters)) {
      return prev
    }
    return { ...prev, goal: { ...current, autoContinueTurns: 0, ...(resetWakeCounters ? { idleCheckInCount: 0, retryCount: 0, retryAt: null, noProgressTurns: 0 } : {}) } }
  })
}

export function applyGoalRuntimeEvaluation({
  evaluation,
  setAppState,
  goal,
  madeProgress = true,
}: {
  evaluation: GoalRuntimeEvaluation
  setAppState: (updater: (prev: AppState) => AppState) => void
  goal?: ThreadGoal
  madeProgress?: boolean
}): GoalRuntimeDecision {
  let decision: GoalRuntimeDecision = { action: 'stop', userNotice: null }
  const now = Date.now()

  setAppState(prev => {
    if (!prev.goal || (goal && !isSameGoal(prev.goal, goal))) return prev
    const current = normalizeGoal(prev.goal)
    if (current.status !== 'active') return prev

    const noProgress = madeProgress ? 0 : (current.noProgressTurns ?? 0) + 1
    if (evaluation.impossible || (!evaluation.achieved && noProgress >= MAX_NO_PROGRESS_TURNS)) {
      const reason = evaluation.impossible ? evaluation.reason : 'No successful tool use for three evaluated turns; send a message with new direction to continue.'
      decision = { action: 'stop', userNotice: createSystemMessage(`Goal paused: ${reason}`, 'warning') }
      return { ...prev, goal: { ...current, status: 'paused', stopReason: evaluation.impossible ? 'impossible' : 'no_progress', lastEvaluatorReason: reason, retryAt: null, nextCheckInAt: null, updatedAt: now } }
    }

    if (evaluation.achieved) {
      const completed = markGoalComplete(
        recordGoalEvaluatorResult({
          goal: current,
          reason: evaluation.reason,
          now,
        }),
        now,
      )
      if (!completed) return prev
      decision = {
        action: 'stop',
        userNotice: createSystemMessage(
          formatGoalCompleteNotice(completed),
          'info',
        ),
      }
      logGoalAudit({
        goal: completed,
        action: 'complete',
        reason: evaluation.reason,
      })
      return { ...prev, goal: { ...completed, retryAt: null, nextCheckInAt: null } }
    }

    const advanced = advanceGoalAutoContinue({
      goal: { ...current, noProgressTurns: noProgress, retryCount: 0, retryAt: null },
      reason: evaluation.reason,
      now,
    })
    if (advanced.shouldContinue) {
      decision = {
        action: 'continue',
        modelNotice: createUserMessage({
          content: buildGoalContinuationMessage(advanced.goal),
          isMeta: true,
        }),
        userNotice: createSystemMessage(
          formatGoalAutoContinueNotice(advanced.goal, evaluation.reason),
          'info',
        ),
      }
      logGoalAudit({
        goal: advanced.goal,
        action: 'auto_continue',
        reason: evaluation.reason,
      })
      return { ...prev, goal: advanced.goal }
    }

    decision = {
      action: 'stop',
      userNotice: createSystemMessage(
        formatGoalPausedNotice(advanced.goal.maxAutoContinueTurns),
        'info',
      ),
    }
    logGoalAudit({
      goal: advanced.goal,
      action: 'paused',
      reason: evaluation.reason,
    })
    return { ...prev, goal: advanced.goal }
  })

  return decision
}
