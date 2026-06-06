import { describe, expect, test } from 'bun:test'
import { APIUserAbortError } from '@anthropic-ai/sdk'
import {
  buildCompactSummaryMessages,
  buildPostCompactMessages,
  createPostCompactContextAttachments,
  estimatePayloadTokensSaved,
  isCompactionUserAbort,
  isStaleFullCompactSummary,
  snapshotCompactContextState,
} from '../../../services/compact/compact.js'
import {
  createCompactBoundaryMessage,
  createUserMessage,
} from '../../../utils/messages.js'
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages'
import type { Message } from '../../../types/message.js'
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

  test('places preserved messages before the compact summary when requested', () => {
    const boundary = createCompactBoundaryMessage('manual', 1000, OLD_TURN_ID)
    boundary.uuid = 'boundary-from-order'

    const summary = createUserMessage({
      content: 'Summary:\n- compacted suffix',
      isCompactSummary: true,
    })
    summary.uuid = 'summary-from-order'

    const kept = makeAssistantMessage('kept-from-order', 'kept prefix')

    const ordered = buildPostCompactMessages({
      boundaryMarker: boundary,
      summaryMessages: [summary],
      messagesToKeep: [kept],
      messagesToKeepPlacement: 'before_summary',
      attachments: [],
      hookResults: [],
    })

    expect(ordered.map(message => message.uuid)).toEqual([
      'boundary-from-order',
      'kept-from-order',
      'summary-from-order',
    ])
  })
})

describe('estimatePayloadTokensSaved', () => {
  test('subtracts a precomputed post compact token count', () => {
    const before = [
      makeAssistantMessage('before-1', 'large tool context '.repeat(200)),
      createUserMessage({ content: 'follow-up question '.repeat(50) }),
    ]

    expect(estimatePayloadTokensSaved(before, 1)).toBeGreaterThan(0)
  })

  test('never reports negative savings', () => {
    const before = [createUserMessage({ content: 'short' })]

    expect(estimatePayloadTokensSaved(before, 10_000)).toBe(0)
  })
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
      callSite: 'compact_session_memory',
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
