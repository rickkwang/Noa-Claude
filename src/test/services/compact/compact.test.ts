import { describe, expect, test } from 'bun:test'
import {
  buildFullCompactSegments,
  extractPreviousCompactCheckpoint,
  FULL_COMPACT_RECENT_TAIL_TOKEN_BUDGET,
  resolveFullCompactInputs,
} from '../../../services/compact/compact.js'
import { adjustIndexToPreserveAPIInvariants } from '../../../services/compact/preservedTail.js'
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

describe('buildFullCompactSegments', () => {
  test('extracts prior compact summary and preserves only fresh recent tail', () => {
    const boundary = createCompactBoundaryMessage('auto', 1000, OLD_TURN_ID)
    boundary.uuid = 'boundary-1'

    const priorSummary = createUserMessage({
      content: 'This session is being continued.\n\nSummary:\n- Old checkpoint',
      isCompactSummary: true,
    })
    priorSummary.uuid = 'summary-1'

    const fresh1 = makeAssistantMessage('assistant-1', 'older fresh detail')
    const fresh2 = makeAssistantMessage(
      'assistant-2',
      'newest fresh detail that should stay verbatim',
    )

    const result = buildFullCompactSegments([
      boundary,
      priorSummary,
      fresh1,
      fresh2,
    ])

    expect(result.previousSummary).toContain('Old checkpoint')
    expect(result.messagesToSummarize.map(message => message.uuid)).toEqual([
      'assistant-1',
    ])
    expect(result.messagesToKeep.map(message => message.uuid)).toEqual([
      'assistant-2',
    ])
  })

  test('does not keep old compact boundary or compact summary in recent tail', () => {
    const boundary = createCompactBoundaryMessage('manual', 500, OLD_TURN_ID)
    boundary.uuid = 'boundary-2'

    const priorSummary = createUserMessage({
      content: 'This session is being continued.\n\nSummary:\n- Prior',
      isCompactSummary: true,
    })
    priorSummary.uuid = 'summary-2'

    const fresh = makeAssistantMessage(
      'assistant-3',
      'x'.repeat(FULL_COMPACT_RECENT_TAIL_TOKEN_BUDGET),
    )

    const result = buildFullCompactSegments([boundary, priorSummary, fresh])

    expect(result.messagesToKeep.some(message => message.uuid === 'boundary-2')).toBe(
      false,
    )
    expect(result.messagesToKeep.some(message => message.uuid === 'summary-2')).toBe(
      false,
    )
  })

  test('prefers structured raw compact summary over transcript wrapper text', () => {
    const boundary = createCompactBoundaryMessage('auto', 1000, OLD_TURN_ID)
    boundary.uuid = 'boundary-3'

    const priorSummary = createUserMessage({
      content:
        'This session is being continued from a previous conversation that ran out of context.\n\nSummary:\n- Wrapped summary',
      isCompactSummary: true,
      summarizeMetadata: {
        messagesSummarized: 3,
        rawCompactSummary:
          '<analysis>scratchpad</analysis><summary>Structured checkpoint</summary>',
      },
    })
    priorSummary.uuid = 'summary-3'

    const checkpoint = extractPreviousCompactCheckpoint([boundary, priorSummary])

    expect(checkpoint.previousSummary).toBe('Summary:\nStructured checkpoint')
    expect(checkpoint.firstFreshMessageIndex).toBe(2)
  })

  test('does not reuse partial-from compact summaries as previous checkpoints', () => {
    const boundary = createCompactBoundaryMessage('manual', 1000, OLD_TURN_ID)
    boundary.uuid = 'boundary-4'

    const partialFromSummary = createUserMessage({
      content: 'Summary:\n- Recent suffix only',
      isCompactSummary: true,
      summarizeMetadata: {
        messagesSummarized: 2,
        direction: 'from',
        rawCompactSummary: 'Summary:\n- Recent suffix only',
      },
    })
    partialFromSummary.uuid = 'summary-4'

    const preservedEarlierMessage = makeAssistantMessage(
      'assistant-4',
      'older preserved context that should remain in the base messages',
    )

    const checkpoint = extractPreviousCompactCheckpoint([
      boundary,
      partialFromSummary,
      preservedEarlierMessage,
    ])
    const segments = buildFullCompactSegments([
      boundary,
      partialFromSummary,
      preservedEarlierMessage,
    ])

    expect(checkpoint.previousSummary).toBeUndefined()
    expect(checkpoint.firstFreshMessageIndex).toBe(1)
    expect(segments.messagesToSummarize.map(message => message.uuid)).toEqual([
      'summary-4',
    ])
    expect(segments.messagesToKeep.map(message => message.uuid)).toEqual([
      'assistant-4',
    ])
  })

  test('merges consecutive prior compact summaries into one checkpoint', () => {
    const boundary = createCompactBoundaryMessage('auto', 1000, OLD_TURN_ID)
    boundary.uuid = 'boundary-5'

    const priorSummary1 = createUserMessage({
      content: 'Summary:\n- First checkpoint',
      isCompactSummary: true,
      summarizeMetadata: {
        rawCompactSummary: 'Summary:\n- First checkpoint',
      },
    })
    priorSummary1.uuid = 'summary-5a'

    const priorSummary2 = createUserMessage({
      content: 'Summary:\n- Second checkpoint',
      isCompactSummary: true,
      summarizeMetadata: {
        rawCompactSummary: 'Summary:\n- Second checkpoint',
      },
    })
    priorSummary2.uuid = 'summary-5b'

    const fresh = makeAssistantMessage('assistant-5', 'fresh detail')

    const checkpoint = extractPreviousCompactCheckpoint([
      boundary,
      priorSummary1,
      priorSummary2,
      fresh,
    ])

    expect(checkpoint.previousSummary).toBe(
      'Summary:\n- First checkpoint\n\nSummary:\n- Second checkpoint',
    )
    expect(checkpoint.firstFreshMessageIndex).toBe(3)
  })

  test('adjusts preserved tail start back to zero for required tool_use', () => {
    const toolUseMessage: Message = {
      type: 'assistant',
      uuid: 'assistant-tool-use',
      id: 'assistant-tool-use',
      message: {
        id: 'assistant-tool-use',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Read',
            input: {},
          } as never,
        ],
      },
    }

    const middleMessage = makeAssistantMessage('assistant-middle', 'middle')
    const toolResultMessage = createUserMessage({
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: 'ok',
        } as never,
      ],
    })
    toolResultMessage.uuid = 'user-tool-result'

    expect(
      adjustIndexToPreserveAPIInvariants(
        [toolUseMessage, middleMessage, toolResultMessage],
        2,
      ),
    ).toBe(0)
  })

  test('clears previousSummary when falling back to a full-history rewrite', () => {
    const historicalMessage = makeAssistantMessage(
      'assistant-6',
      'historical message to rewrite in fallback mode',
    )
    const boundary = createCompactBoundaryMessage('auto', 1000, OLD_TURN_ID)
    boundary.uuid = 'boundary-6'

    const priorSummary = createUserMessage({
      content: 'Summary:\n- Existing checkpoint',
      isCompactSummary: true,
      summarizeMetadata: {
        rawCompactSummary: 'Summary:\n- Existing checkpoint',
      },
    })
    priorSummary.uuid = 'summary-6'

    const result = resolveFullCompactInputs([
      historicalMessage,
      boundary,
      priorSummary,
    ])

    expect(result.previousSummary).toBeUndefined()
    expect(result.messagesToSummarize.map(message => message.uuid)).toEqual([
      'assistant-6',
    ])
    expect(result.messagesToKeep).toEqual([])
  })
})
