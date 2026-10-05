export type ThreadGoalStatus = 'active' | 'paused' | 'budget_limited' | 'complete'

export type ThreadGoalStopReason =
  | 'max_auto_continue_turns'
  | 'budget_limited'
  | 'evaluator_failed'
  | 'complete'
  | 'unrecoverable_error'
  | 'rate_limit'
  | 'retry_exhausted'
  | 'turn_failed'
  | 'impossible'
  | 'no_progress'
  | null

export type ThreadGoal = {
  objective: string
  status: ThreadGoalStatus
  tokenBudget: number | null
  verifyCommand: string | null
  tokensUsed: number
  timeUsedSeconds: number
  autoContinueTurns: number
  maxAutoContinueTurns: number
  lastEvaluatorReason: string | null
  completedAt: number | null
  stopReason: ThreadGoalStopReason
  createdAt: number
  updatedAt: number
  backgroundWaitingSince?: number | null
  nextCheckInAt?: number | null
  checkInCount?: number
  idleCheckInCount?: number
  retryAt?: number | null
  retryCount?: number
  noProgressTurns?: number
}
