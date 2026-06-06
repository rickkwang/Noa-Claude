import type { Message, PartialCompactDirection } from '../../types/message.js'

type InternalSummarizeMetadata = NonNullable<Message['summarizeMetadata']>

export type SDKSummarizeMetadata = {
  messages_summarized?: number
  user_context?: string
  direction?: PartialCompactDirection
  raw_compact_summary?: string
  tokens_saved?: number
}

export function toSDKSummarizeMetadata(
  meta: Message['summarizeMetadata'],
): SDKSummarizeMetadata | undefined {
  if (!meta) return undefined
  return {
    messages_summarized: meta.messagesSummarized,
    user_context: meta.userContext,
    direction: meta.direction,
    raw_compact_summary: meta.rawCompactSummary,
    tokens_saved: meta.tokensSaved,
  }
}

export function fromSDKSummarizeMetadata(
  meta: SDKSummarizeMetadata | undefined,
): Message['summarizeMetadata'] | undefined {
  if (!meta) return undefined
  return {
    messagesSummarized: meta.messages_summarized,
    userContext: meta.user_context,
    direction: meta.direction as InternalSummarizeMetadata['direction'],
    rawCompactSummary: meta.raw_compact_summary,
    tokensSaved: meta.tokens_saved,
  }
}
