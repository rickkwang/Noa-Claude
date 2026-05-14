import { z } from 'zod/v4'
import { queryHaiku } from '../services/api/claude.js'
import type { ThreadGoal } from '../types/goal.js'
import type { Message } from '../types/message.js'
import { getContentText } from './messages.js'
import { safeParseJSON } from './json.js'
import { lazySchema } from './lazySchema.js'
import { asSystemPrompt } from './systemPromptType.js'
import { logGoalAudit } from './goalAudit.js'

const MAX_GOAL_EVALUATOR_CONTEXT = 4000

const GOAL_EVALUATOR_PROMPT = `Evaluate whether the active thread goal is complete.

Return JSON only with:
- achieved: true only if the objective is actually complete and no required work remains.
- reason: one concise sentence explaining the decision.

Be conservative. Treat missing verification, unclear state, blocked work, or partial progress as not achieved.`

const goalEvaluationSchema = lazySchema(() =>
  z.object({
    achieved: z.boolean(),
    reason: z.string(),
  }),
)

export type GoalEvaluation = z.infer<ReturnType<typeof goalEvaluationSchema>>

function toolResultText(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return typeof result === 'string' ? result : ''
  }
  const record = result as Record<string, unknown>
  if (typeof record.stdout === 'string') {
    const stderr = typeof record.stderr === 'string' ? record.stderr : ''
    return record.stdout + (stderr ? `\n${stderr}` : '')
  }
  if (
    record.file &&
    typeof record.file === 'object' &&
    typeof (record.file as { content?: unknown }).content === 'string'
  ) {
    return (record.file as { content: string }).content
  }
  const parts: string[] = []
  for (const key of ['content', 'output', 'result', 'text', 'message']) {
    const value = record[key]
    if (typeof value === 'string') parts.push(value)
  }
  for (const key of ['filenames', 'lines', 'results']) {
    const value = record[key]
    if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
      parts.push((value as string[]).join('\n'))
    }
  }
  return parts.join('\n')
}

export function buildGoalEvaluatorContext(messages: Message[]): string {
  const parts: string[] = []
  for (const message of messages) {
    if ('isMeta' in message && message.isMeta) continue
    if (message.type !== 'user' && message.type !== 'assistant') continue
    const messageParts: string[] = []
    if (message.message) {
      const text =
        typeof message.message.content === 'string'
          ? message.message.content
          : getContentText(message.message.content)
      if (text) messageParts.push(text)
    }
    if (message.type === 'user' && message.toolUseResult !== undefined) {
      const toolText = toolResultText(message.toolUseResult).trim()
      if (toolText) messageParts.push(`tool result:\n${toolText}`)
    }
    if (messageParts.length > 0) {
      parts.push(`${message.type}: ${messageParts.join('\n')}`)
    }
  }
  const text = parts.join('\n\n')
  return text.length > MAX_GOAL_EVALUATOR_CONTEXT
    ? text.slice(-MAX_GOAL_EVALUATOR_CONTEXT)
    : text
}

export async function evaluateGoalCompletion({
  goal,
  messages,
  signal,
  isNonInteractiveSession,
}: {
  goal: ThreadGoal
  messages: Message[]
  signal: AbortSignal
  isNonInteractiveSession: boolean
}): Promise<GoalEvaluation | null> {
  logGoalAudit({ goal, action: 'evaluator_start', reason: null })
  try {
    const response = await queryHaiku({
      systemPrompt: asSystemPrompt([GOAL_EVALUATOR_PROMPT]),
      userPrompt: `Goal: ${goal.objective}
Status: ${goal.status}
Tokens used: ${goal.tokensUsed}${goal.tokenBudget ? ` of ${goal.tokenBudget}` : ''}
Auto-continue turns: ${goal.autoContinueTurns} of ${goal.maxAutoContinueTurns}

Recent conversation:
${buildGoalEvaluatorContext(messages)}

Decision:`,
      outputFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            achieved: { type: 'boolean' },
            reason: { type: 'string' },
          },
          required: ['achieved', 'reason'],
          additionalProperties: false,
        },
      },
      signal,
      options: {
        querySource: 'goal_evaluator',
        agents: [],
        isNonInteractiveSession,
        hasAppendSystemPrompt: false,
        mcpTools: [],
      },
    })

    const text = response.message
      ? typeof response.message.content === 'string'
        ? response.message.content
        : getContentText(response.message.content)
      : ''
    const parsed = goalEvaluationSchema().safeParse(safeParseJSON(text))
    if (!parsed.success) {
      logGoalAudit({
        goal,
        action: 'evaluator_failure',
        reason: 'Goal evaluator returned invalid JSON.',
      })
      return null
    }
    logGoalAudit({
      goal,
      action: 'evaluator_success',
      reason: parsed.data.reason,
    })
    return {
      achieved: parsed.data.achieved,
      reason: parsed.data.reason.trim() || 'No evaluator reason provided.',
    }
  } catch {
    logGoalAudit({
      goal,
      action: 'evaluator_failure',
      reason: 'Goal evaluator request failed.',
    })
    return null
  }
}
