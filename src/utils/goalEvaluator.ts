import { z } from 'zod/v4'
import { queryHaiku } from '../services/api/claude.js'
import type { ThreadGoal } from '../types/goal.js'
import type { AssistantMessage, Message } from '../types/message.js'
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

export type GoalEvaluationOutcome = {
  evaluation: GoalEvaluation | null
  evaluatorMessage: AssistantMessage | null
}

function fitSegmentToEvaluatorContext(segment: string, maxLength: number): string {
  if (maxLength <= 0) return ''
  if (segment.length <= maxLength) return segment

  const headerEnd = segment.indexOf('\n')
  const rawHeader =
    headerEnd === -1 ? segment.slice(0, 80) : segment.slice(0, headerEnd)
  const header =
    rawHeader.length > 80 ? `${rawHeader.slice(0, 77)}...` : rawHeader
  const marker = '\n[truncated]\n'
  const availableTailLength = Math.max(
    0,
    maxLength - header.length - marker.length,
  )
  if (availableTailLength === 0) {
    return header.slice(0, maxLength)
  }
  return `${header}${marker}${segment.slice(-availableTailLength)}`
}

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

function formatMessageForEvaluator(message: Message): string | null {
  if ('isMeta' in message && message.isMeta) return null
  if (message.type !== 'user' && message.type !== 'assistant') return null
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
  if (messageParts.length === 0) return null
  return `${message.type}: ${messageParts.join('\n')}`
}

export function buildGoalEvaluatorContext(messages: Message[]): string {
  const segmentsReversed: string[] = []
  let totalLength = 0
  const separator = '\n\n'
  for (let i = messages.length - 1; i >= 0; i--) {
    const segment = formatMessageForEvaluator(messages[i]!)
    if (!segment) continue
    const addedLength =
      segment.length + (segmentsReversed.length > 0 ? separator.length : 0)
    if (totalLength + addedLength > MAX_GOAL_EVALUATOR_CONTEXT) {
      const shouldFitPartialSegment =
        segment.length > MAX_GOAL_EVALUATOR_CONTEXT ||
        segment.includes('tool result:\n')
      if (!shouldFitPartialSegment) break

      const separatorLength =
        segmentsReversed.length > 0 ? separator.length : 0
      const remainingLength =
        MAX_GOAL_EVALUATOR_CONTEXT - totalLength - separatorLength
      const fittedSegment = fitSegmentToEvaluatorContext(
        segment,
        remainingLength,
      )
      if (fittedSegment) {
        segmentsReversed.push(fittedSegment)
      }
      break
    }
    segmentsReversed.push(segment)
    totalLength += addedLength
  }
  return segmentsReversed.reverse().join(separator)
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
}): Promise<GoalEvaluationOutcome> {
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
      return { evaluation: null, evaluatorMessage: response }
    }
    logGoalAudit({
      goal,
      action: 'evaluator_success',
      reason: parsed.data.reason,
    })
    return {
      evaluation: {
        achieved: parsed.data.achieved,
        reason: parsed.data.reason.trim() || 'No evaluator reason provided.',
      },
      evaluatorMessage: response,
    }
  } catch {
    logGoalAudit({
      goal,
      action: 'evaluator_failure',
      reason: 'Goal evaluator request failed.',
    })
    return { evaluation: null, evaluatorMessage: null }
  }
}
