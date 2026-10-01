import { z } from 'zod/v4'
import type {
  BetaMessage,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { APIError } from '@anthropic-ai/sdk'
import type { SDKAssistantMessageErrorSchema } from '../entrypoints/sdk/coreSchemas.js'
import type { Attachment } from '../utils/attachments.js'
import type { UUID } from 'crypto'

type SDKAssistantMessageError = z.infer<
  ReturnType<typeof SDKAssistantMessageErrorSchema>
>

export const MessageSchema = z.object({
  type: z.string(),
  id: z.string(),
  sessionId: z.string().optional(),
})

export type MessageUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

export type CompactPreservedSegment = {
  headUuid: UUID
  anchorUuid: UUID
  tailUuid: UUID
}

type MessageBase = z.infer<typeof MessageSchema> & {
  uuid: UUID
  parentUuid?: UUID | null
  logicalParentUuid?: UUID | null
  sessionId?: string
  timestamp?: string
  content?: unknown
  message?: {
    content?: unknown
    role?: string
    id?: string
    usage?: MessageUsage
    stop_reason?: string | null
  }
  isMeta?: boolean
  isCompactSummary?: boolean
  summarizeMetadata?: {
    messagesSummarized?: number
    userContext?: string
    direction?: PartialCompactDirection
    rawCompactSummary?: string
    /** Estimated tokens freed by this compaction (pre-compact context minus the
     *  resulting post-compact context). Surfaced in the compact summary UI. */
    tokensSaved?: number
  }
  isVisibleInTranscriptOnly?: boolean
  isVirtual?: boolean
  isSidechain?: boolean
  sourceToolAssistantUUID?: UUID
  toolUseResult?: unknown
  compactMetadata?: {
    trigger?: 'manual' | 'auto'
    preTokens?: number
    userContext?: string
    messagesSummarized?: number
    preservedSegment?: CompactPreservedSegment
  }
  microcompactMetadata?: {
    trigger?: 'auto'
    preTokens?: number
    tokensSaved?: number
    compactedToolIds?: string[]
    clearedAttachmentUUIDs?: string[]
  }
  attachment?: Attachment
  attachments?: unknown[]
  preservedSegment?: unknown
  agentId?: string
  teamName?: string
  agentName?: string
  agentColor?: string
  subtype?: string
  messageCount?: number
} & Record<string, unknown>

// The three transcript message kinds below mirror what their constructors in
// utils/messages.ts and utils/attachments.ts actually build.
export type UserMessage = MessageBase & {
  type: 'user'
  uuid: UUID
  timestamp: string
  message: {
    role: 'user'
    content: string | ContentBlockParam[]
  }
  imagePasteIds?: number[]
}

export type NormalizedUserMessage = UserMessage

export type AssistantMessage = MessageBase & {
  type: 'assistant'
  uuid: UUID
  timestamp: string
  message: BetaMessage
  requestId?: string
  apiError?: string
  error?: SDKAssistantMessageError
  errorDetails?: string
  isApiErrorMessage?: boolean
}

export type ProgressMessage<T = unknown> = MessageBase & {
  type: 'progress'
  data: T
  toolUseID: string
  parentToolUseID: string
}

export type HookResultMessage = MessageBase & {
  type: 'hook_result'
  hookEvent: string
  result: unknown
}

export type AttachmentMessage = MessageBase & {
  type: 'attachment'
  uuid: UUID
  timestamp: string
  attachment: Attachment
}

export type SystemMessage = MessageBase & {
  type: 'system'
  content: string
}

export type SystemAPIErrorMessage = SystemMessage & {
  subtype: 'api_error'
  error: APIError
  retryInMs: number
  retryAttempt: number
  maxRetries: number
}

export type SystemBridgeStatusMessage = SystemMessage & {
  subtype: 'bridge_status'
  connected: boolean
}

// A system message echoing a local slash-command invocation. Distinguished by
// subtype (see isSystemLocalCommandMessage). Excluded from appendSystemMessage's
// accepted input because it must not survive normalizeMessagesForAPI.
export type SystemLocalCommandMessage = SystemMessage & {
  subtype: 'local_command'
}

export type SystemTurnDurationMessage = SystemMessage & {
  subtype: 'turn_duration'
  durationMs: number
  messageCount?: number
}

export type SystemThinkingMessage = SystemMessage & {
  subtype: 'thinking'
  thinking: string
}

export type SystemMemorySavedMessage = SystemMessage & {
  subtype: 'memory_saved'
  path: string
}

export type SystemStopHookSummaryMessage = SystemMessage & {
  subtype: 'stop_hook_summary'
  summary: string
}

// Per-hook execution record collected by handleStopHooks and rendered in the
// stop-hook summary line (SystemTextMessage). command is 'prompt' for
// prompt-type hooks, with the prompt text alongside.
export type StopHookInfo = {
  command: string
  promptText?: string
  durationMs?: number
}

// Human-readable progress summary emitted after a tool batch completes.
// Created by createToolUseSummaryMessage (utils/messages.ts), mapped to the
// SDK's snake_case shape in QueryEngine. Not part of the model transcript.
export type ToolUseSummaryMessage = {
  type: 'tool_use_summary'
  summary: string
  precedingToolUseIds: string[]
  uuid: string
  timestamp: string
}

// Raw API stream event passthrough, yielded by queryModelWithStreaming
// (services/api/claude.ts) for partial-message consumers. ttftMs rides on
// the message_start event only.
export type StreamEvent = {
  type: 'stream_event'
  event: BetaRawMessageStreamEvent
  ttftMs?: number
}

// Yielded by the query loop at the top of each iteration, before the API
// call. UI/SDK layers use it as a spinner signal; never persisted.
export type RequestStartEvent = {
  type: 'stream_request_start'
}

// Retracts an already-yielded assistant message (streaming fallback orphans
// partial messages whose thinking signatures are invalid). Consumers remove
// `message` from UI and transcript.
export type TombstoneMessage = {
  type: 'tombstone'
  message: AssistantMessage
}

export type RenderableMessage = Message

export type PartialCompactDirection = 'from' | 'up_to'

export type NormalizedMessage = Message

export type SystemInformationalMessage = SystemMessage

export type SystemCompactBoundaryMessage = SystemMessage & {
  subtype: 'compact_boundary'
  compactMetadata: {
    trigger: 'manual' | 'auto'
    preTokens: number
    userContext?: string
    messagesSummarized?: number
    preservedSegment?: CompactPreservedSegment
    preCompactDiscoveredTools?: string[]
  }
  logicalParentUuid?: UUID
}

export type SystemMicrocompactBoundaryMessage = SystemMessage & {
  subtype: 'microcompact_boundary'
  microcompactMetadata: {
    trigger: 'auto'
    preTokens: number
    tokensSaved: number
    compactedToolIds: string[]
    clearedAttachmentUUIDs: string[]
  }
}

export type CollapsedReadSearchGroup = MessageBase & {
  type: 'collapsed_read_search_group'
  reads: unknown[]
}

export type GroupedToolUseMessage = MessageBase & {
  type: 'grouped_tool_use'
  toolUses: unknown[]
}

// Discriminated on `type`, so `msg.type === 'assistant'` narrows to the
// variant that actually carries `message.content` / `attachment`.
export type Message =
  | UserMessage
  | AssistantMessage
  | AttachmentMessage
  | SystemMessage
  | ProgressMessage
  | HookResultMessage
  | CollapsedReadSearchGroup
  | GroupedToolUseMessage
