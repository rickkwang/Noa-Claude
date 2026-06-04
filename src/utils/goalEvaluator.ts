import { z } from 'zod/v4'
import stripAnsi from 'strip-ansi'
import { queryHaiku } from '../services/api/claude.js'
import type { ThreadGoal } from '../types/goal.js'
import type { AssistantMessage, Message } from '../types/message.js'
import { getContentText } from './messages.js'
import { safeParseJSON } from './json.js'
import { lazySchema } from './lazySchema.js'
import { asSystemPrompt } from './systemPromptType.js'
import { logGoalAudit, truncateGoalNoticeReason } from './goalAudit.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { getCwd } from './cwd.js'

const MAX_GOAL_EVALUATOR_CONTEXT = 4000
const MAX_VERIFY_OUTPUT_TAIL = 2000
const VERIFY_COMMAND_TIMEOUT_MS = 120_000

const GOAL_EVALUATOR_PROMPT = `Evaluate whether the active thread goal is complete.

Return JSON only with:
- achieved: true only if the objective is actually complete and no required work remains.
- reason: one concise sentence explaining the decision.

Be conservative. Treat missing verification, unclear state, blocked work, or partial progress as not achieved.

If a verify command result is provided, it is deterministic evidence: a non-zero exit code means the objective is NOT achieved. A zero exit code is necessary but not sufficient on its own — still confirm the conversation shows the objective's other requirements are met.`

export type GoalVerifyResult = {
  code: number
  stdout: string
  stderr: string
}

function cleanVerifyOutput(result: GoalVerifyResult): string {
  return stripAnsi(
    [result.stdout, result.stderr]
      .filter(part => part.trim())
      .join('\n'),
  )
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, ' ')
    .trim()
}

// Keep the output tail because failures and summaries usually appear last.
export function formatVerifyResultForEvaluator(
  command: string,
  result: GoalVerifyResult,
): string {
  const combined = cleanVerifyOutput(result)
  const tail =
    combined.length > MAX_VERIFY_OUTPUT_TAIL
      ? `[truncated]\n${combined.slice(-MAX_VERIFY_OUTPUT_TAIL)}`
      : combined
  return `Verify command: ${command}
Verify command exit code: ${result.code}
Verify command output:
${tail || '(no output)'}`
}

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

export function enforceGoalVerifyResult(
  evaluation: GoalEvaluation,
  verifyResult?: GoalVerifyResult | null,
): GoalEvaluation {
  if (!verifyResult || verifyResult.code === 0) return evaluation
  const evaluatorReason = evaluation.achieved
    ? ''
    : truncateGoalNoticeReason(evaluation.reason)
  return {
    achieved: false,
    reason: `Verify command failed with exit code ${verifyResult.code}.${evaluatorReason ? ` ${evaluatorReason}` : ''}`,
  }
}

// --verify explicitly opts into automatic shell execution in the project cwd.
export async function runGoalVerifyCommand({
  goal,
  signal,
}: {
  goal: ThreadGoal
  signal: AbortSignal
}): Promise<GoalVerifyResult | null> {
  if (!goal.verifyCommand) return null
  logGoalAudit({ goal, action: 'verify_start', reason: goal.verifyCommand })
  try {
    const result = await execFileNoThrowWithCwd(goal.verifyCommand, [], {
      shell: true,
      cwd: getCwd(),
      abortSignal: signal,
      timeout: VERIFY_COMMAND_TIMEOUT_MS,
      preserveOutputOnError: true,
      maxBuffer: 1_000_000,
    })
    logGoalAudit({ goal, action: 'verify_done', reason: `exit ${result.code}` })
    const stderr =
      result.stderr || (!result.stdout && result.code !== 0 ? result.error ?? '' : '')
    return { code: result.code, stdout: result.stdout, stderr }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logGoalAudit({ goal, action: 'verify_done', reason: `failed: ${reason}` })
    return { code: 1, stdout: '', stderr: reason }
  }
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
  verifyResult,
}: {
  goal: ThreadGoal
  messages: Message[]
  signal: AbortSignal
  isNonInteractiveSession: boolean
  verifyResult?: GoalVerifyResult | null
}): Promise<GoalEvaluationOutcome> {
  logGoalAudit({ goal, action: 'evaluator_start', reason: null })
  const verifyBlock =
    verifyResult && goal.verifyCommand
      ? `\n${formatVerifyResultForEvaluator(goal.verifyCommand, verifyResult)}\n`
      : ''
  try {
    const response = await queryHaiku({
      systemPrompt: asSystemPrompt([GOAL_EVALUATOR_PROMPT]),
      userPrompt: `Goal: ${goal.objective}
Status: ${goal.status}
Tokens used: ${goal.tokensUsed}${goal.tokenBudget ? ` of ${goal.tokenBudget}` : ''}
Auto-continue turns: ${goal.autoContinueTurns} of ${goal.maxAutoContinueTurns}
${verifyBlock}
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
      evaluation: enforceGoalVerifyResult(
        {
          achieved: parsed.data.achieved,
          reason: parsed.data.reason.trim() || 'No evaluator reason provided.',
        },
        verifyResult,
      ),
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
