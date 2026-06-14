import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { ThreadGoal } from '../../types/goal.js'
import {
  createThreadGoal,
  markGoalComplete,
  normalizeGoal,
} from '../../utils/goalState.js'

const GOAL_TOOL_NAME = 'goal'

const inputSchema = lazySchema(() =>
  z.discriminatedUnion('operation', [
    z.strictObject({
      operation: z.literal('get_goal'),
    }),
    z.strictObject({
      operation: z.literal('create_goal'),
      objective: z.string().describe('The concrete objective to start pursuing'),
      token_budget: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Optional positive token budget for the new goal'),
    }),
    z.strictObject({
      operation: z.literal('update_goal'),
      status: z
        .literal('complete')
        .describe('Request completion only when the objective is achieved'),
    }),
  ]),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    goal: z
      .object({
        objective: z.string(),
        status: z.string(),
        token_budget: z.number().nullable(),
        verify_command: z.string().nullable(),
        tokens_used: z.number(),
        time_used_seconds: z.number(),
        auto_continue_turns: z.number(),
        max_auto_continue_turns: z.number(),
        last_evaluator_reason: z.string().nullable(),
        completed_at: z.number().nullable(),
        stop_reason: z.string().nullable(),
      })
      .nullable(),
    remaining_tokens: z.number().nullable(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type GoalToolOutput = z.infer<OutputSchema>

function formatGoalForResponse(goal: ThreadGoal | null) {
  if (!goal) return null
  const current = normalizeGoal(goal)
  return {
    objective: current.objective,
    status: current.status,
    token_budget: current.tokenBudget,
    verify_command: current.verifyCommand,
    tokens_used: current.tokensUsed,
    time_used_seconds: current.timeUsedSeconds,
    auto_continue_turns: current.autoContinueTurns,
    max_auto_continue_turns: current.maxAutoContinueTurns,
    last_evaluator_reason: current.lastEvaluatorReason,
    completed_at: current.completedAt,
    stop_reason: current.stopReason,
  }
}

function computeRemainingTokens(goal: ThreadGoal | null): number | null {
  if (!goal || !goal.tokenBudget) return null
  return Math.max(0, goal.tokenBudget - goal.tokensUsed)
}

function goalToolResult(
  success: boolean,
  goal: ThreadGoal | null,
  message: string,
): { data: GoalToolOutput } {
  return {
    data: {
      success,
      goal: formatGoalForResponse(goal),
      remaining_tokens: computeRemainingTokens(goal),
      message,
    },
  }
}

function buildCompletionReport(goal: ThreadGoal): string | null {
  if (!goal.tokenBudget && goal.timeUsedSeconds <= 0) return null
  const parts: string[] = []
  if (goal.tokenBudget) {
    parts.push(`tokens used: ${goal.tokensUsed} of ${goal.tokenBudget}`)
  }
  if (goal.timeUsedSeconds > 0) {
    parts.push(`time used: ${goal.timeUsedSeconds} seconds`)
  }
  return `Goal achieved. Report final usage: ${parts.join('; ')}.`
}

export const GoalTool = buildTool({
  name: GOAL_TOOL_NAME,
  searchHint: 'manage thread goals',
  maxResultSizeChars: 10_000,
  strict: true,
  async description() {
    return 'Manage the active thread goal. Three operations: get_goal (read current), create_goal (set new, fails if exists), update_goal (request completion only).'
  },
  async prompt() {
    return `Use this tool to manage the thread's active goal.

Operations:
- get_goal: Read the current goal state including tokens used and budget.
- create_goal: Create a new goal. Fails if a goal already exists (status != complete). Provide a clear, concrete objective.
- update_goal: Request completion for the existing goal. ONLY use this when the objective has actually been achieved and no required work remains. When a verify command is configured, the goal remains active until verification passes and the evaluator approves completion. Do not request completion merely because the budget is nearly exhausted or because you are stopping work.

The model cannot pause, resume, or clear goals — those are user-controlled via slash commands.`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'Goal'
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly(input) {
    return input.operation === 'get_goal'
  },
  toAutoClassifierInput(input) {
    return input.operation
  },
  renderToolUseMessage() {
    return null
  },
  async call(input, context) {
    if (context.agentId) {
      return goalToolResult(
        false,
        null,
        'Goal management is only available on the main thread, not inside subagents.',
      )
    }
    const { getAppState, setAppState } = context

    switch (input.operation) {
      case 'get_goal': {
        const current = getAppState().goal ?? null
        return goalToolResult(
          true,
          current,
          current
            ? `Current goal: ${current.objective} (status: ${current.status})`
            : 'No goal is currently set for this thread.',
        )
      }

      case 'create_goal': {
        const objective = input.objective.trim()
        if (!objective) {
          return goalToolResult(false, null, 'Objective cannot be empty.')
        }

        const tokenBudget = input.token_budget ?? null
        const now = Date.now()
        let conflict: ThreadGoal | null = null
        let created: ThreadGoal | null = null

        setAppState(prev => {
          const existing = prev.goal
          if (existing && existing.status !== 'complete') {
            conflict = existing
            return prev
          }
          created = createThreadGoal({ objective, tokenBudget, now })
          return { ...prev, goal: created }
        })

        if (conflict) {
          const c = conflict as ThreadGoal
          return goalToolResult(
            false,
            c,
            `Cannot create a new goal because this thread already has an active goal: "${c.objective}". Use update_goal only when the existing goal is complete.`,
          )
        }

        const g = created as ThreadGoal | null
        return goalToolResult(
          true,
          g,
          `Goal created: ${objective}${tokenBudget ? ` (budget: ${tokenBudget} tokens)` : ''}`,
        )
      }

      case 'update_goal': {
        let alreadyComplete: ThreadGoal | null = null
        let pendingVerification: ThreadGoal | null = null
        let updated: ThreadGoal | null = null

        setAppState(prev => {
          const existing = prev.goal
          if (!existing) return prev
          if (existing.status === 'complete') {
            alreadyComplete = existing
            return prev
          }
          const current = normalizeGoal(existing)
          if (current.verifyCommand) {
            pendingVerification = current
            return prev
          }
          updated = markGoalComplete(existing, Date.now())
          return { ...prev, goal: updated ?? undefined }
        })

        if (alreadyComplete) {
          return goalToolResult(
            false,
            alreadyComplete as ThreadGoal,
            'Goal is already complete.',
          )
        }

        if (pendingVerification) {
          return goalToolResult(
            true,
            pendingVerification as ThreadGoal,
            'Goal completion is pending verify command and evaluator approval.',
          )
        }

        if (!updated) {
          return goalToolResult(false, null, 'No goal exists to update.')
        }

        const u = updated as ThreadGoal
        return goalToolResult(
          true,
          u,
          buildCompletionReport(u) ?? 'Goal marked as complete.',
        )
      }
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const result = content as GoalToolOutput
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(
        {
          message: result.message,
          goal: result.goal,
          remaining_tokens: result.remaining_tokens,
        },
        null,
        2,
      ),
    }
  },
} satisfies ToolDef<InputSchema, GoalToolOutput>)
