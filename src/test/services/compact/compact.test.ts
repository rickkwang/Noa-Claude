import { describe, expect, test } from 'bun:test'
import { APIUserAbortError } from '@anthropic-ai/sdk'
import {
  buildPostCompactMessages,
  isCompactionUserAbort,
  isStaleFullCompactSummary,
} from '../../../services/compact/compact.js'
import {
  createCompactBoundaryMessage,
  createUserMessage,
} from '../../../utils/messages.js'
import type { Message } from '../../../types/message.js'

const OLD_TURN_ID = '00000000-0000-0000-0000-000000000001'

function makeAssistantMessage(
  uuid: string,
  text: string,
  extra?: Partial<Message>,
): Message {
  return {
    type: 'assistant',
    id: uuid,
    uuid,
    message: {
      id: uuid,
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
    ...extra,
  }
}

describe('buildPostCompactMessages', () => {
  test('places preserved messages after the compact summary', () => {
    const boundary = createCompactBoundaryMessage('manual', 1000, OLD_TURN_ID)
    boundary.uuid = 'boundary-order'

    const summary = createUserMessage({
      content: 'Summary:\n- compacted context',
      isCompactSummary: true,
    })
    summary.uuid = 'summary-order'

    const kept = makeAssistantMessage('kept-order', 'kept tail')

    const ordered = buildPostCompactMessages({
      boundaryMarker: boundary,
      summaryMessages: [summary],
      messagesToKeep: [kept],
      attachments: [],
      hookResults: [],
    })

    expect(ordered.map(message => message.uuid)).toEqual([
      'boundary-order',
      'summary-order',
      'kept-order',
    ])
  })
})

describe('isStaleFullCompactSummary', () => {
  test('matches user compact summaries without direction', () => {
    const summary = createUserMessage({
      content: 'Summary:\n- checkpoint',
      isCompactSummary: true,
    })
    expect(isStaleFullCompactSummary(summary)).toBe(true)
  })

  test('matches user compact summaries with direction up_to', () => {
    const summary = createUserMessage({
      content: 'Summary:\n- prefix checkpoint',
      isCompactSummary: true,
      summarizeMetadata: { direction: 'up_to' },
    })
    expect(isStaleFullCompactSummary(summary)).toBe(true)
  })

  test('does not match direction=from partial summaries', () => {
    const summary = createUserMessage({
      content: 'Summary:\n- recent suffix',
      isCompactSummary: true,
      summarizeMetadata: { direction: 'from' },
    })
    expect(isStaleFullCompactSummary(summary)).toBe(false)
  })

  test('does not match non-summary user messages', () => {
    const userMsg = createUserMessage({ content: 'hello' })
    expect(isStaleFullCompactSummary(userMsg)).toBe(false)
  })

  test('does not match assistant or system messages', () => {
    expect(isStaleFullCompactSummary(makeAssistantMessage('a-1', 'hi'))).toBe(
      false,
    )
  })
})

describe('isCompactionUserAbort', () => {
  test('treats APIUserAbortError and aborted signals as user cancellation', () => {
    const abortController = new AbortController()
    abortController.abort()

    expect(isCompactionUserAbort(new APIUserAbortError())).toBe(true)
    expect(isCompactionUserAbort(new Error('other'), abortController.signal)).toBe(
      true,
    )
    expect(isCompactionUserAbort(new Error('other'))).toBe(false)
  })
})
