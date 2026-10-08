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
import { getContextWindowForModel } from './context.js'
import { getSmallFastModel } from './model/model.js'
import { groupMessagesByApiRound } from '../services/compact/grouping.js'
import { isPromptTooLongMessage } from '../services/api/errors.js'

const EVALUATOR_CONTEXT_FRACTION = 0.5
const MAX_TASK_SUMMARY = 4000
const MAX_VERIFY_OUTPUT_TAIL = 2000
const VERIFY_COMMAND_TIMEOUT_MS = 120_000

const GOAL_EVALUATOR_PROMPT = `Evaluate whether the active thread goal is complete.

Return JSON only with:
- achieved: true only if the objective is actually complete and no required work remains.
- impossible: true only when the objective cannot be satisfied, rather than merely being unfinished or blocked temporarily.
- reason: one concise sentence quoting the specific conversation text that shows the objective is met, or naming what is missing or blocking it. If the conversation has no clear evidence of completion, it is not achieved.

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
    impossible: z.boolean().optional(),
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
    ...evaluation,
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
  const bytes = Buffer.from(segment, 'utf8')
  if (bytes.length <= maxLength) return segment

  const marker = '\n[truncated]\n'
  let headEnd = Math.max(0, Math.min(512, maxLength - marker.length - 1))
  while ((bytes[headEnd]! & 0xc0) === 0x80) headEnd--
  const header = bytes.subarray(0, headEnd).toString('utf8')
  const availableTailLength = Math.max(
    0,
    maxLength - headEnd - marker.length,
  )
  if (availableTailLength === 0) {
    return header.slice(0, maxLength)
  }
  let tailStart = bytes.length - availableTailLength
  while ((bytes[tailStart]! & 0xc0) === 0x80) tailStart++
  return `${header}${marker}${bytes.subarray(tailStart).toString('utf8')}`
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
    else if (key === 'content' && Array.isArray(value)) {
      const text = getContentText(value)
      if (text) parts.push(text)
    }
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
  if (message.type === 'user' && Array.isArray(message.message.content)) {
    for (const block of message.message.content) {
      if (block.type !== 'tool_result') continue
      messageParts.push(`tool result: is_error=${block.is_error === true} id=${block.tool_use_id}`)
    }
    for (const block of message.message.content) {
      if (block.type !== 'tool_result') continue
      if (message.toolUseResult === undefined) {
        const text = typeof block.content === 'string' ? block.content : getContentText(block.content)
        if (text) messageParts.push(text)
      }
    }
  }
  if (message.message) {
    const text =
      typeof message.message.content === 'string'
        ? message.message.content
        : getContentText(message.message.content)
    if (text) messageParts.push(text)
  }
  if (message.type === 'user' && message.toolUseResult !== undefined) {
    if (message.toolUseResult && typeof message.toolUseResult === 'object') {
      const result = message.toolUseResult as Record<string, unknown>
      const code = result.exitCode ?? result.code
      if (typeof code === 'number') messageParts.push(`tool exit code: ${code}`)
      if (result.isError === true) messageParts.push('tool is_error=true')
    }
    const toolText = toolResultText(message.toolUseResult).trim()
    if (toolText) messageParts.push(`tool result:\n${toolText}`)
  }
  if (messageParts.length === 0) return null
  return `${message.type}: ${messageParts.join('\n')}`
}

const OMITTED_NOTICE = '[Earlier conversation truncated to fit the evaluator context. If the required evidence may be in the omitted part, the goal is not achieved.]'

function evaluatorContextBudget(fraction: number): number {
  // UTF-8 bytes, conservatively budgeted at two bytes per token for dense text.
  return Math.floor(getContextWindowForModel(getSmallFastModel()) * fraction) * 2
}

// Newest API rounds first, as many as fit; the newest round is always kept,
// head+tail truncated if it alone overflows.
export function buildGoalEvaluatorContext(
  messages: Message[],
  maxLength = evaluatorContextBudget(EVALUATOR_CONTEXT_FRACTION),
): string {
  const separator = '\n\n'
  const kept: string[] = []
  let total = 0
  let omitted = false
  const rounds = groupMessagesByApiRound(messages)
  for (let i = rounds.length - 1; i >= 0; i--) {
    const text = rounds[i]!.map(formatMessageForEvaluator).filter(Boolean).join(separator)
    if (!text) continue
    const added = Buffer.byteLength(text, 'utf8') + (kept.length > 0 ? separator.length : 0)
    if (total + added > maxLength) {
      if (kept.length === 0) kept.push(fitSegmentToEvaluatorContext(text, maxLength))
      omitted = true
      break
    }
    kept.push(text)
    total += added
  }
  if (omitted) kept.push(OMITTED_NOTICE)
  return kept.reverse().join(separator)
}

export async function evaluateGoalCompletion({
  goal,
  messages,
  signal,
  isNonInteractiveSession,
  verifyResult,
  backgroundTasks = [],
}: {
  goal: ThreadGoal
  messages: Message[]
  signal: AbortSignal
  isNonInteractiveSession: boolean
  verifyResult?: GoalVerifyResult | null
  backgroundTasks?: readonly { id: string; description: string }[]
}): Promise<GoalEvaluationOutcome> {
  logGoalAudit({ goal, action: 'evaluator_start', reason: null })
  const verifyBlock =
    verifyResult && goal.verifyCommand
      ? `\n${formatVerifyResultForEvaluator(goal.verifyCommand, verifyResult)}\n`
      : ''
  const taskSummary = backgroundTasks.map(task => `- ${task.id}: ${task.description}`).join('\n')
  const taskBlock = backgroundTasks.length
    ? `Running work started during this goal (${backgroundTasks.length} tasks):\n${taskSummary.slice(0, MAX_TASK_SUMMARY)}${taskSummary.length > MAX_TASK_SUMMARY ? '\n[task details truncated]' : ''}\nA running task alone does not mean the goal is unfinished: a service may be expected to remain running. Determine whether required work is still pending.\n`
    : ''
  try {
    const ask = (fraction: number) => queryHaiku({
      systemPrompt: asSystemPrompt([GOAL_EVALUATOR_PROMPT]),
      userPrompt: `Goal: ${goal.objective}
Status: ${goal.status}
Tokens used: ${goal.tokensUsed}${goal.tokenBudget ? ` of ${goal.tokenBudget}` : ''}
Auto-continue turns: ${goal.autoContinueTurns} of ${goal.maxAutoContinueTurns}
${verifyBlock}
${taskBlock}
Recent conversation:
${buildGoalEvaluatorContext(messages, evaluatorContextBudget(fraction))}

Decision:`,
      outputFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            achieved: { type: 'boolean' },
            impossible: { type: 'boolean' },
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
    let response = await ask(EVALUATOR_CONTEXT_FRACTION)
    if (isPromptTooLongMessage(response)) response = await ask(EVALUATOR_CONTEXT_FRACTION / 2)

    const text = response.message
      ? typeof response.message.content === 'string'
        ? response.message.content
        : getContentText(response.message.content)
      : ''
    const json = (text ?? '').trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1')
    const parsed = goalEvaluationSchema().safeParse(safeParseJSON(json))
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
          achieved: parsed.data.achieved && !parsed.data.impossible,
          impossible: parsed.data.impossible,
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
