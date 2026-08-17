import type { UUID } from 'crypto'
import type { Message } from './message.js'

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
