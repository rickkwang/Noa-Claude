/**
 * Reading the running turn when the conversation is handed to a background
 * session: is a reply streaming (stop it now) or are tools running between
 * model calls (let the turn finish first), what partial reply to carry, and
 * where the fork should cut the transcript.
 *
 * Works on the live REPL messages: only there does the last assistant message
 * of a response carry its stop_reason (persisted ones are written before
 * message_delta and always read null).
 */
import type { Message } from '../../types/message.js'
import {
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  TURN_ENDED_FOR_MESSAGE_TOOL_RESULT,
} from '../messages.js'

type AnyMessage = Message & {
  message?: { stop_reason?: string | null; content?: unknown }
}

function blocks(m: AnyMessage): Array<{ type?: string; text?: unknown; content?: unknown; is_error?: boolean }> {
  const content = m.message?.content
  return Array.isArray(content) ? content : []
}

/** The newest response is still being written (no stop_reason yet). */
function lastAssistantIsPartial(messages: readonly Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as AnyMessage
    if (m.type === 'assistant') return m.message?.stop_reason === null
    if (m.type === 'user') return false
  }
  return false
}

/**
 * Tools are running, or a request is out with nothing streamed back yet:
 * the turn is between model calls, so it can be let finish. A running tool
 * settles it even before the response's stop_reason lands — some providers
 * send message_delta well after the tool_use block that started the tool.
 */
export function isBetweenModelCalls(
  messages: readonly Message[],
  streamingText: string | null,
  toolsRunning = false,
): boolean {
  return streamingText === null && (toolsRunning || !lastAssistantIsPartial(messages))
}

/** Text of the response being written: its finished text blocks plus the live stream. */
export function partialReplyText(messages: readonly Message[], streamingText: string | null): string {
  let start = messages.length
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as AnyMessage
    if (m.type === 'assistant') {
      if (m.message?.stop_reason !== null) break
      start = i
    } else if (m.type === 'user') {
      break
    }
  }
  let text = ''
  for (let i = start; i < messages.length; i++) {
    const m = messages[i] as AnyMessage
    if (m.type !== 'assistant') continue
    for (const b of blocks(m)) if (b.type === 'text' && typeof b.text === 'string') text += b.text
  }
  return text + (streamingText ?? '')
}

const MARKERS = [INTERRUPT_MESSAGE, INTERRUPT_MESSAGE_FOR_TOOL_USE, TURN_ENDED_FOR_MESSAGE_TOOL_RESULT]

function markerText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const first = value.find(v => v?.type === 'text')
    return typeof first?.text === 'string' ? first.text : undefined
  }
  return undefined
}

/** A user message that only records the turn being cut off. */
export function isInterruptionMarker(m: Message): boolean {
  if (m.type !== 'user') return false
  const content = (m as AnyMessage).message?.content
  if (typeof content === 'string') return MARKERS.some(p => content.startsWith(p))
  const list = blocks(m as AnyMessage)
  return (
    list.length > 0 &&
    list.every(b => {
      const text = b.type === 'text' ? b.text : b.type === 'tool_result' ? markerText(b.content) : undefined
      return typeof text === 'string' && MARKERS.some(p => text.startsWith(p))
    })
  )
}

function isToolResultsOnly(m: Message): boolean {
  if (m.type !== 'user') return false
  const list = blocks(m as AnyMessage)
  return list[0]?.type === 'tool_result' && list.every(b => b.type === 'tool_result' || b.type === 'text' || b.type === 'image')
}

function isAbortedResponse(m: AnyMessage): boolean {
  const reason = m.message?.stop_reason
  return reason === null || reason === 'tool_use'
}

/** Drop the aborted end of the turn: unfinished responses and the markers cutting them off. */
export function stripAbortedTail(messages: readonly Message[]): readonly Message[] {
  let n = messages.length
  let afterMarker = false
  while (n > 0) {
    const m = messages[n - 1] as AnyMessage
    if (m.type === 'user') {
      if (isInterruptionMarker(m)) afterMarker ||= isToolResultsOnly(m)
      else if (!(afterMarker && isToolResultsOnly(m))) break
    } else if (m.type === 'assistant') {
      if (!isAbortedResponse(m)) break
      afterMarker = false
    }
    n--
  }
  return messages.slice(0, n)
}

/**
 * The last message the fork keeps: what came after it is the reply being cut
 * off, which the fork regenerates from the carried partial text.
 */
export function handoffBoundaryUuid(messages: readonly Message[]): string | undefined {
  const kept = stripAbortedTail(messages)
  for (let i = kept.length - 1; i >= 0; i--) {
    const m = kept[i]!
    if (m.type === 'user' || m.type === 'assistant') return m.uuid
  }
  return undefined
}
