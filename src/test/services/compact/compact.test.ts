import { describe, expect, test } from 'bun:test'
import {
  buildCompactSummaryMessages,
  buildPostCompactMessages,
  createPostCompactContextAttachments,
  getPartialCompactMessagesToKeep,
  getPartialCompactMessagesToSummarize,
  isStaleFullCompactSummary,
  partialCompactConversation,
  PTL_RETRY_MARKER,
  selectPTLPartialPivot,
  snapshotCompactContextState,
  truncateHeadForPTLRetry,
} from '../../../services/compact/compact.js'
import { PROMPT_TOO_LONG_ERROR_MESSAGE } from '../../../services/api/errors.js'
import {
  createCompactBoundaryMessage,
  createUserMessage,
} from '../../../utils/messages.js'
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages'
import type { AssistantMessage, Message } from '../../../types/message.js'
import { createFileStateCacheWithSizeLimit } from '../../../utils/fileStateCache.js'

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

test('default compaction places the summary before kept messages', () => {
  const boundary = createCompactBoundaryMessage('manual', 1000, OLD_TURN_ID)
  const summary = createUserMessage({ content: 'Summary', isCompactSummary: true })
  const kept = makeAssistantMessage('kept-tail', 'kept tail')

  const ordered = buildPostCompactMessages({
    boundaryMarker: boundary,
    summaryMessages: [summary],
    messagesToKeep: [kept],
    attachments: [],
    hookResults: [],
  })

  expect(ordered.map(message => message.uuid)).toEqual([
    boundary.uuid,
    summary.uuid,
    kept.uuid,
  ])
})

test('prefix-preserving compaction places kept messages before the summary', () => {
  const boundary = createCompactBoundaryMessage('manual', 1000, OLD_TURN_ID)
  const summary = createUserMessage({ content: 'Summary', isCompactSummary: true })
  const kept = makeAssistantMessage('kept-prefix', 'kept prefix')

  const ordered = buildPostCompactMessages({
    boundaryMarker: boundary,
    summaryMessages: [summary],
    messagesToKeep: [kept],
    messagesToKeepPlacement: 'before_summary',
    attachments: [],
    hookResults: [],
  })

  expect(ordered.map(message => message.uuid)).toEqual([
    boundary.uuid,
    kept.uuid,
    summary.uuid,
  ])
})

describe('buildCompactSummaryMessages', () => {
  function thinking(signature: string): BetaContentBlock {
    return {
      type: 'thinking',
      thinking: 'reasoning',
      signature,
    } as BetaContentBlock
  }

  function thinkingBlocksIn(messages: Message[]): BetaContentBlock[] {
    const blocks: BetaContentBlock[] = []
    for (const m of messages) {
      if (m.type !== 'assistant' || !m.message) continue
      const content = m.message.content
      if (!Array.isArray(content)) continue
      for (const block of content as BetaContentBlock[]) {
        if (block.type === 'thinking') blocks.push(block)
      }
    }
    return blocks
  }

  // The /compact 400 ("Invalid signature in thinking block") is the exact
  // failure this guards: a stale/empty signature replayed when compaction
  // re-sends the full history. The strip must survive refactors of the call
  // site, so assert it at the boundary the model request is built from.
  test('strips thinking blocks (stale and empty signatures) from the request', () => {
    const messages: Message[] = [
      createUserMessage({ content: 'q1' }),
      makeAssistantMessage('a-stale', 'answer one', {
        message: {
          id: 'a-stale',
          role: 'assistant',
          content: [thinking('stale-cross-provider-sig'), { type: 'text', text: 'answer one' }],
        },
      } as Partial<Message>),
      createUserMessage({ content: 'q2' }),
      makeAssistantMessage('a-empty', 'answer two', {
        message: {
          id: 'a-empty',
          role: 'assistant',
          content: [thinking(''), { type: 'text', text: 'answer two' }],
        },
      } as Partial<Message>),
    ]
    const summaryRequest = createUserMessage({ content: 'Summarize.' })

    const out = buildCompactSummaryMessages(messages, summaryRequest, [])

    expect(thinkingBlocksIn(out)).toHaveLength(0)
    // The accompanying text content must survive the strip.
    const texts: string[] = []
    for (const m of out) {
      if (m.type !== 'assistant' || !m.message) continue
      const content = m.message.content
      if (!Array.isArray(content)) continue
      for (const block of content as BetaContentBlock[]) {
        if (block.type === 'text') texts.push(block.text)
      }
    }
    expect(texts).toContain('answer one')
    expect(texts).toContain('answer two')
  })
})

describe('createPostCompactContextAttachments', () => {
  test('preserves plan mode instructions for session memory compaction', async () => {
    const attachments = await createPostCompactContextAttachments({
      readFileState: {},
      context: {
        options: {
          tools: [],
          mainLoopModel: 'test-model',
          mcpClients: [],
          agentDefinitions: { activeAgents: [] },
        },
        getAppState: () => ({
          tasks: {},
          toolPermissionContext: {
            mode: 'plan',
          },
        }),
      } as never,
      callSite: 'compact_partial',
    })

    expect(attachments.some(m => m.attachment?.type === 'plan_mode')).toBe(true)
  })
})

describe('snapshotCompactContextState', () => {
  test('restores compact-cleared context state once', () => {
    const readFileState = createFileStateCacheWithSizeLimit(100)
    readFileState.set('/a.txt', {
      content: 'A',
      timestamp: 1,
      offset: undefined,
      limit: undefined,
    })
    const loadedNestedMemoryPaths = new Set(['/CLAUDE.md'])
    const context = {
      readFileState,
      loadedNestedMemoryPaths,
    } as never

    const snapshot = snapshotCompactContextState(context)
    readFileState.clear()
    readFileState.set('/b.txt', {
      content: 'B',
      timestamp: 2,
      offset: undefined,
      limit: undefined,
    })
    loadedNestedMemoryPaths.clear()
    loadedNestedMemoryPaths.add('/OTHER.md')

    snapshot.restore()
    snapshot.restore()

    expect(readFileState.get('/a.txt')?.content).toBe('A')
    expect(readFileState.has('/b.txt')).toBe(false)
    expect([...loadedNestedMemoryPaths]).toEqual(['/CLAUDE.md'])
  })

  test('clears nested memory paths added after an empty snapshot', () => {
    const readFileState = createFileStateCacheWithSizeLimit(100)
    const loadedNestedMemoryPaths = new Set<string>()
    const context = {
      readFileState,
      loadedNestedMemoryPaths,
    } as never

    const snapshot = snapshotCompactContextState(context)
    loadedNestedMemoryPaths.add('/LEAKED.md')

    snapshot.restore()

    expect([...loadedNestedMemoryPaths]).toEqual([])
  })
})

describe('isStaleFullCompactSummary', () => {
  test('does not match direction=from partial summaries', () => {
    const summary = createUserMessage({
      content: 'Summary:\n- recent suffix',
      isCompactSummary: true,
      summarizeMetadata: { direction: 'from' },
    })
    expect(isStaleFullCompactSummary(summary)).toBe(false)
  })

})

describe('getPartialCompactMessagesToSummarize', () => {
  test('keeps prior full compact summaries when summarizing an up_to prefix', () => {
    const oldBoundary = createCompactBoundaryMessage(
      'auto',
      1000,
      OLD_TURN_ID,
    )
    const oldSummary = createUserMessage({
      content: 'Summary:\n- older history that no longer exists verbatim',
      isCompactSummary: true,
      summarizeMetadata: { direction: 'up_to' },
    })
    const middle = makeAssistantMessage('middle', 'continued work')
    const tail = makeAssistantMessage('tail', 'recent tail')
    const messages = [oldBoundary, oldSummary, middle, tail]

    const selected = getPartialCompactMessagesToSummarize(messages, 3, 'up_to')

    expect(selected.map(m => m.uuid)).toEqual([
      oldBoundary.uuid,
      oldSummary.uuid,
      middle.uuid,
    ])
  })

  test('still skips stale full compact summaries when summarizing a from suffix', () => {
    const kept = makeAssistantMessage('kept-prefix', 'kept prefix')
    const oldSummary = createUserMessage({
      content: 'Summary:\n- stale earlier summary',
      isCompactSummary: true,
      summarizeMetadata: { direction: 'up_to' },
    })
    const suffix = makeAssistantMessage('suffix', 'suffix to summarize')

    const selected = getPartialCompactMessagesToSummarize(
      [kept, oldSummary, suffix],
      1,
      'from',
    )

    expect(selected.map(m => m.uuid)).toEqual(['suffix'])
  })
})

describe('partialCompactConversation error handling', () => {
  test('does not surface manual compact notifications for auto partial failures', async () => {
    const notifications: unknown[] = []
    const context = {
      abortController: new AbortController(),
      addNotification: (notification: unknown) => {
        notifications.push(notification)
      },
    } as never

    await expect(
      partialCompactConversation(
        [makeAssistantMessage('tail-only', 'nothing before pivot')],
        0,
        context,
        {} as never,
        undefined,
        'up_to',
        { trigger: 'auto', ownsLifecycle: false },
      ),
    ).rejects.toThrow('Nothing to summarize before the selected message.')

    expect(notifications).toEqual([])
  })
})

// A PTL response as the compaction loop sees it. errorDetails carries the
// numbers getPromptTooLongTokenGap parses; omit it for the unparseable case.
function makePTLResponse(errorDetails?: string): AssistantMessage {
  return {
    type: 'assistant',
    id: 'ptl',
    uuid: 'ptl',
    isApiErrorMessage: true,
    message: {
      id: 'ptl',
      role: 'assistant',
      content: [{ type: 'text', text: PROMPT_TOO_LONG_ERROR_MESSAGE }],
    },
    ...(errorDetails ? { errorDetails } : {}),
  } as unknown as AssistantMessage
}

// ~1 token per 4 chars under the rough estimator, so each turn is ~250 tokens.
function makeTurns(count: number): Message[] {
  const messages: Message[] = []
  for (let i = 0; i < count; i++) {
    messages.push(makeAssistantMessage(`turn-${i}`, 'x'.repeat(1000)))
  }
  return messages
}

describe('selectPTLPartialPivot', () => {
  test('keeps back enough of the tail to cover the reported overflow', () => {
    const messages = makeTurns(20)
    const pivot = selectPTLPartialPivot(
      messages,
      makePTLResponse('prompt is too long: 200500 tokens > 200000'),
    )
    expect(pivot).not.toBeNull()
    expect(pivot).toBeGreaterThan(0)
    expect(pivot).toBeLessThan(messages.length)
    expect(messages.length - pivot!).toBeGreaterThanOrEqual(2)
  })

  test('never splits a tool_use from its tool_result', () => {
    const messages: Message[] = [
      makeAssistantMessage('pad', 'y'.repeat(4000)),
      {
        type: 'assistant',
        id: 'call',
        uuid: 'call',
        message: {
          id: 'call',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu-1', name: 'Read', input: {} },
          ],
        },
      } as unknown as Message,
      {
        type: 'user',
        uuid: 'res',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu-1', content: 'z'.repeat(400) },
          ],
        },
      } as unknown as Message,
    ]
    const pivot = selectPTLPartialPivot(
      messages,
      makePTLResponse('prompt is too long: 200100 tokens > 200000'),
    )
    // The naive backward walk would land on the tool_result (index 2); the
    // invariant snap has to pull it back to the tool_use.
    expect(pivot).toBe(1)
  })

  test('keeps an existing compact summary inside the summarized prefix', () => {
    const boundary = createCompactBoundaryMessage('auto', 10_000, undefined)
    const priorSummary = createUserMessage({
      content: 'prior compacted history '.repeat(200),
      isCompactSummary: true,
      summarizeMetadata: {
        messagesSummarized: 20,
        direction: 'up_to',
      },
    })
    const messages = [
      boundary,
      priorSummary,
      makeAssistantMessage('recent-1', 'x'.repeat(1000)),
      makeAssistantMessage('recent-2', 'y'.repeat(1000)),
    ]

    const pivot = selectPTLPartialPivot(
      messages,
      makePTLResponse('prompt is too long: 200600 tokens > 200000'),
    )

    expect(pivot).toBe(2)
    expect(
      getPartialCompactMessagesToSummarize(messages, pivot!, 'up_to'),
    ).toContain(priorSummary)
    expect(getPartialCompactMessagesToKeep(messages, pivot!, 'up_to')).not.toContain(
      priorSummary,
    )
  })

  test('keeps at least one API-visible message in the summarized prefix', () => {
    const boundary = createCompactBoundaryMessage('auto', 10_000, undefined)
    const messages = [
      boundary,
      makeAssistantMessage('recent-1', 'x'.repeat(1000)),
      makeAssistantMessage('recent-2', 'y'.repeat(1000)),
    ]

    const pivot = selectPTLPartialPivot(
      messages,
      makePTLResponse('prompt is too long: 200300 tokens > 200000'),
    )

    expect(pivot).toBe(2)
  })

  test('returns null when the summarized prefix has no API-visible message', () => {
    const messages = [
      createCompactBoundaryMessage('auto', 10_000, undefined),
      createCompactBoundaryMessage('auto', 9_000, undefined),
      createCompactBoundaryMessage('auto', 8_000, undefined),
    ]

    expect(
      selectPTLPartialPivot(
        messages,
        makePTLResponse('prompt is too long: 200001 tokens > 200000'),
      ),
    ).toBeNull()
  })
})

describe('truncateHeadForPTLRetry', () => {
  function makeUserMessage(uuid: string, text: string): Message {
    return {
      type: 'user',
      uuid,
      message: { role: 'user', content: text },
    } as unknown as Message
  }

  // Groups start at each assistant message, with the preamble as group 0.
  function makeGroupedConversation(): Message[] {
    return [
      makeUserMessage('u-0', 'first ask'),
      makeAssistantMessage('a-0', 'x'.repeat(2000)),
      makeUserMessage('u-1', 'second ask'),
      makeAssistantMessage('a-1', 'y'.repeat(2000)),
      makeUserMessage('u-2', 'third ask'),
      makeAssistantMessage('a-2', 'z'.repeat(2000)),
    ]
  }

  test('drops the oldest rounds and names the transcript in the marker', () => {
    const messages = makeGroupedConversation()
    const out = truncateHeadForPTLRetry(
      messages,
      makePTLResponse('prompt is too long: 200400 tokens > 200000'),
    )
    expect(out).not.toBeNull()
    expect(out!.length).toBeLessThan(messages.length)

    // Dropping group 0 leaves an assistant-first sequence, which the API
    // rejects — so the synthetic marker is always prepended here.
    const head = out![0] as { isMeta?: boolean; message: { content: unknown } }
    expect(head.isMeta).toBe(true)
    const marker = head.message.content as string
    expect(marker.startsWith(PTL_RETRY_MARKER)).toBe(true)
    // The one loss no summary covers, so the model must be told where to read
    // it back from.
    expect(marker).toContain('transcript')
  })

  test('strips a previous marker instead of stalling on retry 2+', () => {
    const first = truncateHeadForPTLRetry(
      makeGroupedConversation(),
      makePTLResponse('prompt is too long: 200400 tokens > 200000'),
    )
    expect(first).not.toBeNull()
    const second = truncateHeadForPTLRetry(
      first!,
      makePTLResponse('prompt is too long: 200400 tokens > 200000'),
    )
    // Progress, not a marker-only no-op.
    expect(second).not.toBeNull()
    expect(second!.length).toBeLessThan(first!.length)
  })

})
