import { describe, expect, test } from 'bun:test'
import { APIUserAbortError } from '@anthropic-ai/sdk'
import {
  buildPostCompactMessages,
  buildFullCompactSegments,
  extractPreviousCompactCheckpoint,
  FULL_COMPACT_RECENT_TAIL_TOKEN_BUDGET,
  isCompactionUserAbort,
  resolveFullCompactInputs,
  selectRecentMessagesToKeepForFullCompact,
} from '../../../services/compact/compact.js'
import { adjustIndexToPreserveAPIInvariants } from '../../../services/compact/preservedTail.js'
import {
  createCompactBoundaryMessage,
  createUserMessage,
  projectCompactHistoryForMainDisplay,
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

describe('selectRecentMessagesToKeepForFullCompact', () => {
  test('returns empty when there are no eligible messages', () => {
    expect(selectRecentMessagesToKeepForFullCompact([])).toEqual([])
  })

  test('returns empty when only one eligible message remains', () => {
    const onlyMessage = makeAssistantMessage('assistant-single', 'latest only')

    expect(selectRecentMessagesToKeepForFullCompact([onlyMessage])).toEqual([])
  })

  test('keeps only the newest tail within the token budget', () => {
    const older = makeAssistantMessage('assistant-old', 'old detail')
    const newest = makeAssistantMessage(
      'assistant-new',
      'x'.repeat(FULL_COMPACT_RECENT_TAIL_TOKEN_BUDGET),
    )

    const kept = selectRecentMessagesToKeepForFullCompact([older, newest])

    expect(kept.map(message => message.uuid)).toEqual(['assistant-new'])
  })
})

describe('buildFullCompactSegments', () => {
  test('places compact summary directly after the compact boundary', () => {
    const boundary = createCompactBoundaryMessage('manual', 1000, OLD_TURN_ID)
    boundary.uuid = 'boundary-order'

    const slashCommand = createUserMessage({
      content: '<command-name>/compact</command-name>',
    })
    slashCommand.uuid = 'slash-order'

    const summary = createUserMessage({
      content: 'Summary:\n- compacted context',
      isCompactSummary: true,
    })
    summary.uuid = 'summary-order'

    const kept = makeAssistantMessage('kept-order', 'kept tail')

    const ordered = buildPostCompactMessages({
      boundaryMarker: boundary,
      postBoundaryMessages: [slashCommand],
      summaryMessages: [summary],
      messagesToKeep: [kept],
      attachments: [],
      hookResults: [],
    })

    expect(ordered.map(message => message.uuid)).toEqual([
      'boundary-order',
      'summary-order',
      'slash-order',
      'kept-order',
    ])
  })

  test('hides preserved full-compact tail from main display projection', () => {
    const summaryUuid = '00000000-0000-0000-0000-000000000101'
    const keptUuid1 = '00000000-0000-0000-0000-000000000102'
    const keptUuid2 = '00000000-0000-0000-0000-000000000103'
    const boundary = createCompactBoundaryMessage('manual', 1000, OLD_TURN_ID)
    boundary.uuid = 'boundary-display'
    boundary.compactMetadata.preservedSegment = {
      headUuid: keptUuid1,
      anchorUuid: summaryUuid,
      tailUuid: keptUuid2,
    }

    const summary = createUserMessage({
      content: 'Summary:\n- compacted context',
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
    })
    summary.uuid = summaryUuid

    const slashCommand = createUserMessage({
      content: '<command-name>/compact</command-name>',
      isVisibleInTranscriptOnly: true,
    })
    slashCommand.uuid = 'slash-display'

    const kept1 = makeAssistantMessage(keptUuid1, 'preserved tail 1')
    const kept2 = makeAssistantMessage(keptUuid2, 'preserved tail 2')
    const attachment: Message = {
      type: 'attachment',
      id: 'attachment-display',
      uuid: 'attachment-display',
      attachments: [],
    }

    const projected = projectCompactHistoryForMainDisplay([
      boundary,
      summary,
      slashCommand,
      kept1,
      kept2,
      attachment,
    ])

    expect(projected.map(message => message.uuid)).toEqual([
      'boundary-display',
      summaryUuid,
      'attachment-display',
    ])
  })

  test('keeps partial-compact preserved tail visible in main display', () => {
    const summaryUuid = '00000000-0000-0000-0000-000000000111'
    const keptUuid = '00000000-0000-0000-0000-000000000112'
    const boundary = createCompactBoundaryMessage('manual', 1000, OLD_TURN_ID)
    boundary.uuid = 'boundary-partial-display'
    boundary.compactMetadata.preservedSegment = {
      headUuid: keptUuid,
      anchorUuid: summaryUuid,
      tailUuid: keptUuid,
    }

    const summary = createUserMessage({
      content: 'Summary:\n- partial compacted context',
      isCompactSummary: true,
      summarizeMetadata: {
        messagesSummarized: 3,
        direction: 'up_to',
      },
    })
    summary.uuid = summaryUuid

    const kept = makeAssistantMessage(keptUuid, 'preserved visible context')

    const projected = projectCompactHistoryForMainDisplay([
      boundary,
      summary,
      kept,
    ])

    expect(projected.map(message => message.uuid)).toEqual([
      'boundary-partial-display',
      summaryUuid,
      keptUuid,
    ])
  })

  test('hides pre-boundary tail by timestamp when preserved metadata is absent', () => {
    const boundary = createCompactBoundaryMessage('manual', 1000, OLD_TURN_ID)
    boundary.uuid = 'boundary-display-fallback'
    boundary.timestamp = '2026-06-01T03:00:00.000Z'

    const summary = createUserMessage({
      content: 'Summary:\n- compacted context',
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
      timestamp: '2026-06-01T03:00:00.001Z',
    })
    summary.uuid = 'summary-display-fallback'

    const slashCommand = createUserMessage({
      content: '<command-name>/compact</command-name>',
      isVisibleInTranscriptOnly: true,
      timestamp: '2026-06-01T02:59:59.000Z',
    })
    slashCommand.uuid = 'slash-display-fallback'

    const oldTail = makeAssistantMessage(
      'old-tail-display-fallback',
      'pre-compact tail',
      { timestamp: '2026-06-01T02:59:58.000Z' },
    )
    const oldTailWithoutTimestamp = makeAssistantMessage(
      'old-tail-without-timestamp-fallback',
      'pre-compact tail without timestamp',
    )
    const newMessage = makeAssistantMessage(
      'new-display-fallback',
      'post-compact message',
      { timestamp: '2026-06-01T03:00:01.000Z' },
    )

    const projected = projectCompactHistoryForMainDisplay([
      boundary,
      summary,
      slashCommand,
      oldTail,
      oldTailWithoutTimestamp,
      newMessage,
    ])

    expect(projected.map(message => message.uuid)).toEqual([
      'boundary-display-fallback',
      'summary-display-fallback',
      'new-display-fallback',
    ])
  })

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
