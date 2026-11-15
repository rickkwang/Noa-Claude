// @ts-nocheck
/**
 * Side Question ("/btw") feature - allows asking quick questions without
 * interrupting the main agent context.
 *
 * Uses runForkedAgent to leverage prompt caching from the parent context
 * while keeping the side question response separate from main conversation.
 */

import { API_ERROR_MESSAGE_PREFIX } from '../services/api/errors.js'
import { formatAPIError } from '../services/api/errorUtils.js'
import { EMPTY_USAGE, type NonNullableUsage } from '../services/api/logging.js'
import type { Message, SystemAPIErrorMessage } from '../types/message.js'
import { type BtwExchange, getBtwHistory } from './btwHistory.js'
import { type CacheSafeParams, runForkedAgent } from './forkedAgent.js'
import {
  createAssistantMessage,
  createUserMessage,
  extractTextContent,
} from './messages.js'

// Pattern to detect "/btw" at start of input (case-insensitive, word boundary)
const BTW_PATTERN = /^\/btw\b/gi

// The system-reminder tells the model not to write tool-call markup as text, but
// it sometimes does anyway — and a fabricated tool result reads exactly like a
// real one. Detect the markup and label the answer as not executed.
const ANTML_PREFIX = 'antml:'
const LEAKED_TOOL_CALL_PATTERN = new RegExp(
  `<(?:${ANTML_PREFIX})?(?:function_calls>|invoke name=)|</(?:${ANTML_PREFIX})?(?:function_calls|invoke)>`,
)
const NOT_EXECUTED_NOTICE =
  "_/btw can't run tools: any tool calls or tool output shown above were not executed and may not reflect your actual files or data. Ask in the main conversation to check._"
// Replayed in place of such an answer, so the next side question doesn't
// see fabricated tool output as established context.
const LEAKED_TOOL_CALL_OMITTED =
  '(That answer wrote tool calls as text. Nothing was executed, so it is omitted here.)'
// An API error ended the answer partway; the partial text is kept but marked,
// and not replayed as if it were complete.
const CUT_OFF_NOTICE =
  '_(This answer was cut off before it finished. Ask again to retry.)_'
const CUT_OFF_OMITTED =
  '(That answer was cut off before it finished, so it is omitted here.)'
// Given to tool calls of the running turn that have no result yet, so the
// side question doesn't read them as failed.
const TOOL_IN_PROGRESS =
  '[No result yet \u2014 this call is still in progress in the main conversation (running, awaiting approval, or queued)]'

export function containsLeakedToolCall(text: string): boolean {
  return LEAKED_TOOL_CALL_PATTERN.test(text)
}

/**
 * Find positions of "/btw" keyword at the start of text for highlighting.
 * Similar to findThinkingTriggerPositions in thinking.ts.
 */
export function findBtwTriggerPositions(text: string): Array<{
  word: string
  start: number
  end: number
}> {
  const positions: Array<{ word: string; start: number; end: number }> = []
  const matches = text.matchAll(BTW_PATTERN)

  for (const match of matches) {
    if (match.index !== undefined) {
      positions.push({
        word: match[0],
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }

  return positions
}

export type SideQuestionRetry = {
  retryAttempt: number
  maxRetries: number
  retryInMs: number
  status: number | undefined
}

export type SideQuestionResult = {
  response: string | null
  /** A notice written by us (tool-call attempt, API error), not a model answer. */
  synthetic: boolean
  usage: NonNullableUsage
  aborted?: true
}

const SIDE_QUESTION_REMINDER = `<system-reminder>This is a side question from the user. You must answer this question directly in a single response.

IMPORTANT CONTEXT:
- You are a separate, lightweight agent spawned to answer this one question
- The main agent is NOT interrupted - it continues working independently in the background
- You share the conversation context but are a completely separate instance
- Do NOT reference being interrupted or what you were "previously doing" - that framing is incorrect

CRITICAL CONSTRAINTS:
- You have NO tools available - you cannot read files, run commands, search, or take any actions
- Do NOT write tool calls or tool output as text (for example invoke or function_calls XML blocks) - nothing you write here is executed; if answering would need reading files, running commands, or searching, say that can't be checked from a side question and suggest asking in the main conversation
- This is a one-off response - there will be no follow-up turns
- You can ONLY provide information based on what you already know from the conversation context
- NEVER say things like "Let me try...", "I'll now...", "Let me check...", or promise to take any action
- If you don't know the answer, say so - do not offer to look it up or investigate

Simply answer the question with the information you have.</system-reminder>`

/** Earlier side questions, replayed as prior user/assistant turns. */
export function buildBtwHistoryMessages(
  exchanges: readonly BtwExchange[],
): Message[] {
  return exchanges.flatMap(exchange => [
    createUserMessage({ content: exchange.question }),
    createAssistantMessage({
      content: containsLeakedToolCall(exchange.response)
        ? LEAKED_TOOL_CALL_OMITTED
        : exchange.response.endsWith(CUT_OFF_NOTICE)
          ? CUT_OFF_OMITTED
          : exchange.response,
    }),
  ])
}

/**
 * Placeholder results for the tool calls of the latest assistant response that
 * have none yet. Without them the API request would pair those calls with a
 * synthetic error result, and the answer would call a running command failed.
 */
export function buildInProgressToolResults(
  messages: readonly Message[],
): Message | undefined {
  const last = messages.findLast(m => m.type === 'assistant')
  if (!last) return undefined
  const answered = new Set<string>()
  const calls: string[] = []
  for (const message of messages) {
    if (message.type === 'user' && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type === 'tool_result') answered.add(block.tool_use_id)
      }
    } else if (
      message.type === 'assistant' &&
      message.message.id === last.message.id
    ) {
      for (const block of message.message.content) {
        if (block.type === 'tool_use') calls.push(block.id)
      }
    }
  }
  const pending = calls.filter(id => !answered.has(id))
  if (pending.length === 0) return undefined
  return createUserMessage({
    content: pending.map(id => ({
      type: 'tool_result' as const,
      tool_use_id: id,
      content: TOOL_IN_PROGRESS,
    })),
    isMeta: true,
  })
}

/**
 * Run a side question using a forked agent.
 * Shares the parent's prompt cache — no thinking override, no cache write.
 * All tools are blocked and we cap at 1 turn.
 *
 * Earlier /btw exchanges from this session are replayed before the question
 * (`threadHistory`), and a real answer is appended to that history. A caller
 * that keeps its own thread passes `history` instead.
 */
export async function runSideQuestion({
  question,
  cacheSafeParams,
  abortController,
  onRetry,
  threadHistory = true,
  history: exchanges,
  turnInProgress = false,
}: {
  question: string
  cacheSafeParams: CacheSafeParams
  abortController?: AbortController
  onRetry?: (retry: SideQuestionRetry) => void
  threadHistory?: boolean
  history?: readonly BtwExchange[]
  /** The main turn is still running, so its last tool calls may have no result yet. */
  turnInProgress?: boolean
}): Promise<SideQuestionResult> {
  const history = threadHistory ? getBtwHistory() : null
  const historyMessages = buildBtwHistoryMessages(
    exchanges ?? history?.exchanges ?? [],
  )
  const inProgress = turnInProgress
    ? buildInProgressToolResults(cacheSafeParams.forkContextMessages)
    : undefined

  try {
    const agentResult = await runForkedAgent({
      promptMessages: [
        ...(inProgress ? [inProgress] : []),
        ...historyMessages,
        createUserMessage({
          content: `${SIDE_QUESTION_REMINDER}\n\n${question}`,
        }),
      ],
      // Do NOT override thinkingConfig — thinking is part of the API cache key,
      // and diverging from the main thread's config busts the prompt cache.
      // Adaptive thinking on a quick Q&A has negligible overhead.
      cacheSafeParams,
      canUseTool: async () => ({
        behavior: 'deny' as const,
        message: 'Side questions cannot use tools',
        decisionReason: { type: 'other' as const, reason: 'side_question' },
      }),
      querySource: 'side_question',
      forkLabel: 'side_question',
      maxTurns: 1, // Single turn only - no tool use loops
      // No future request shares this suffix; skip writing cache entries.
      skipCacheWrite: true,
      // Sidechain entries are filtered out of resume/branch/stats anyway, so
      // recording would only re-write the whole fork context to the session log
      // (awaited before the first token) for nobody to read.
      skipTranscript: true,
      overrides: abortController ? { abortController } : undefined,
      onMessage: onRetry
        ? message => {
            if (isAPIErrorMessage(message)) {
              onRetry({
                retryAttempt: message.retryAttempt,
                maxRetries: message.maxRetries,
                retryInMs: message.retryInMs,
                status: message.error?.status,
              })
            }
          }
        : undefined,
    })

    const { response, synthetic } = extractSideQuestionResponse(
      agentResult.messages,
    )
    if (history && response && !synthetic) history.append(question, response)
    return { response, synthetic, usage: agentResult.totalUsage }
  } catch (error) {
    if (abortController?.signal.aborted) {
      return {
        response: null,
        synthetic: false,
        usage: EMPTY_USAGE,
        aborted: true,
      }
    }
    throw error
  }
}

/**
 * Extract a display string from forked agent messages.
 *
 * IMPORTANT: claude.ts yields one AssistantMessage PER CONTENT BLOCK, not one
 * per API response. With adaptive thinking enabled (inherited from the main
 * thread to preserve the cache key), a thinking response arrives as:
 *   messages[0] = assistant { content: [thinking_block] }
 *   messages[1] = assistant { content: [text_block] }
 * So flatten every assistant message — picking the first one can yield a
 * thinking-only message with no text, which surfaces as "No response received".
 *
 * Other paths that leave no text to show:
 *   - Model attempts tool_use → content = [thinking, tool_use], no text.
 *     Rare — the system-reminder usually prevents this, but handled here.
 *   - API error exhausts retries → query yields system api_error + user
 *     interruption, no assistant message at all.
 */
export function extractSideQuestionResponse(messages: Message[]): {
  response: string | null
  synthetic: boolean
} {
  // Flatten all assistant content blocks across the per-block messages. An
  // API error arrives as an assistant message too; it is not part of the answer.
  const assistantBlocks = messages.flatMap(m =>
    m.type === 'assistant' && !m.isApiErrorMessage ? m.message.content : [],
  )
  const apiErrorMessage = messages.find(
    m => m.type === 'assistant' && m.isApiErrorMessage === true,
  )

  if (assistantBlocks.length > 0) {
    // Concatenate all text blocks (there's normally at most one, but be safe).
    const text = extractTextContent(assistantBlocks, '\n\n').trim()
    if (text) {
      return {
        response: [
          text,
          ...(containsLeakedToolCall(text) ? [NOT_EXECUTED_NOTICE] : []),
          ...(apiErrorMessage ? [CUT_OFF_NOTICE] : []),
        ].join('\n\n'),
        synthetic: false,
      }
    }

    // No text — check if the model tried to call a tool despite instructions.
    const toolUse = assistantBlocks.find(b => b.type === 'tool_use')
    if (toolUse) {
      const toolName = 'name' in toolUse ? toolUse.name : 'a tool'
      return {
        response: `(The model tried to call ${toolName} instead of answering directly. Try rephrasing or ask in the main conversation.)`,
        synthetic: true,
      }
    }
  }

  const apiErrorText = apiErrorMessage
    ? extractTextContent(apiErrorMessage.message.content, '\n\n').trim()
    : ''
  if (apiErrorText) {
    return {
      response: `(API error: ${
        apiErrorText.startsWith(`${API_ERROR_MESSAGE_PREFIX}: `)
          ? apiErrorText.slice(API_ERROR_MESSAGE_PREFIX.length + 2)
          : apiErrorText
      })`,
      synthetic: true,
    }
  }

  // No assistant content — likely API error exhausted retries. Surface the
  // first system api_error message so the user sees what happened.
  const apiErr = messages.find(isAPIErrorMessage)
  if (apiErr) {
    return {
      response: `(API error: ${formatAPIError(apiErr.error)})`,
      synthetic: true,
    }
  }

  return { response: null, synthetic: false }
}

function isAPIErrorMessage(message: Message): message is SystemAPIErrorMessage {
  return (
    message.type === 'system' &&
    'subtype' in message &&
    message.subtype === 'api_error'
  )
}
