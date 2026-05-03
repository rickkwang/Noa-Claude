export type ThreadGoalStatus = 'active' | 'paused' | 'budget_limited' | 'complete'

export type ThreadGoal = {
  objective: string
  status: ThreadGoalStatus
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: number
  updatedAt: number
}
