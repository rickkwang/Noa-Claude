import type { UUID } from 'crypto'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { Message } from './message.js'
import type { PastedContent } from '../utils/config.js'
import type { PromptInputMode, QueuePriority } from './textInputTypes.js'

export type QueueOperation =
  | 'enqueue'
  | 'dequeue'
  | 'remove'
  | 'popAll'

export type QueueOperationMessage = Message & {
  type: 'queue-operation'
  operation: QueueOperation
  timestamp: string
  sessionId: UUID | string
  content?: string
}

export type QueueCommandValue = string | ContentBlockParam[]

export type QueueCommandOrigin =
  | {
      kind: 'channel'
      channelName?: string
    }
  | {
      kind: 'local'
    }
  | undefined

export type QueuedCommand = {
  value: QueueCommandValue
  mode: PromptInputMode
  priority?: QueuePriority
  isMeta?: boolean
  origin?: QueueCommandOrigin
  pastedContents?: Record<string, PastedContent>
  agentId?: string
  sessionId?: UUID | string
  uuid?: UUID | string
  message?: {
    content?: unknown
  }
}
