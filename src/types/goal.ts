export type ThreadGoalStatus = 'active' | 'paused' | 'budget_limited' | 'complete'

export type ThreadGoalStopReason =
  | 'max_auto_continue_turns'
  | 'budget_limited'
  | 'evaluator_failed'
  | 'complete'
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
}
