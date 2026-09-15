// @ts-nocheck
/**
 * Side Question ("/btw") feature - allows asking quick questions without
 * interrupting the main agent context.
 *
 * Uses runForkedAgent to leverage prompt caching from the parent context
 * while keeping the side question response separate from main conversation.
 */

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
        : exchange.response,
    }),
  ])
}

/**
 * Run a side question using a forked agent.
 * Shares the parent's prompt cache — no thinking override, no cache write.
 * All tools are blocked and we cap at 1 turn.
 *
 * Earlier /btw exchanges from this session are replayed before the question
 * (`threadHistory`), and a real answer is appended to that history.
 */
export async function runSideQuestion({
  question,
  cacheSafeParams,
  abortController,
  onRetry,
  threadHistory = true,
}: {
  question: string
  cacheSafeParams: CacheSafeParams
  abortController?: AbortController
  onRetry?: (retry: SideQuestionRetry) => void
  threadHistory?: boolean
}): Promise<SideQuestionResult> {
  const history = threadHistory ? getBtwHistory() : null
  const historyMessages = buildBtwHistoryMessages(history?.exchanges ?? [])

  try {
    const agentResult = await runForkedAgent({
      promptMessages: [
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
  // Flatten all assistant content blocks across the per-block messages.
  const assistantBlocks = messages.flatMap(m =>
    m.type === 'assistant' ? m.message.content : [],
  )

  if (assistantBlocks.length > 0) {
    // Concatenate all text blocks (there's normally at most one, but be safe).
    const text = extractTextContent(assistantBlocks, '\n\n').trim()
    if (text) {
      return {
        response: containsLeakedToolCall(text)
          ? `${text}\n\n${NOT_EXECUTED_NOTICE}`
          : text,
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
