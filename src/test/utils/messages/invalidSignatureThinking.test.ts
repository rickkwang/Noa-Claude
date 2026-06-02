import { describe, expect, test } from 'bun:test'
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages'
import {
  createAssistantMessage,
  createUserMessage,
  filterInvalidSignatureThinkingBlocks,
  normalizeMessagesForAPI,
} from '../../../utils/messages.js'
import type { AssistantMessage, UserMessage } from '../../../types/message.js'

function assistantWith(content: BetaContentBlock[]) {
  return createAssistantMessage({ content })
}

function thinking(signature: string): BetaContentBlock {
  return { type: 'thinking', thinking: 'reasoning', signature } as BetaContentBlock
}

const text = (t: string): BetaContentBlock =>
  ({ type: 'text', text: t, citations: [] }) as BetaContentBlock

// Pull the surviving content array off the single assistant message a filter
// returns, narrowing past the UserMessage | AssistantMessage union for tsc.
function contentOf(
  messages: (UserMessage | AssistantMessage)[],
): BetaContentBlock[] {
  const msg = messages[0]
  if (
    !msg ||
    msg.type !== 'assistant' ||
    !msg.message ||
    !Array.isArray(msg.message.content)
  ) {
    throw new Error('expected a single assistant message')
  }
  return msg.message.content as BetaContentBlock[]
}

describe('filterInvalidSignatureThinkingBlocks', () => {
  test('strips a thinking block with an empty signature, keeps siblings', () => {
    const out = filterInvalidSignatureThinkingBlocks([
      assistantWith([thinking(''), text('hello')]),
    ])
    const content = contentOf(out)
    expect(content).toHaveLength(1)
    expect(content[0]!.type).toBe('text')
  })

  test('strips a whitespace-only signature', () => {
    const out = filterInvalidSignatureThinkingBlocks([
      assistantWith([thinking('   '), text('hi')]),
    ])
    expect(contentOf(out)).toHaveLength(1)
  })

  test('preserves a thinking block with a valid signature', () => {
    const out = filterInvalidSignatureThinkingBlocks([
      assistantWith([thinking('sig-abc'), text('hi')]),
    ])
    const content = contentOf(out)
    expect(content).toHaveLength(2)
    expect(content[0]!.type).toBe('thinking')
  })

  test('preserves redacted_thinking (no signature field)', () => {
    const redacted = {
      type: 'redacted_thinking',
      data: 'opaque',
    } as BetaContentBlock
    const out = filterInvalidSignatureThinkingBlocks([
      assistantWith([redacted, text('hi')]),
    ])
    expect(contentOf(out)).toHaveLength(2)
  })

  test('leaves user messages untouched and returns same ref when nothing changes', () => {
    const messages = [
      createUserMessage({ content: 'q' }),
      assistantWith([thinking('sig'), text('a')]),
    ]
    const out = filterInvalidSignatureThinkingBlocks(messages)
    expect(out).toBe(messages)
  })
})

describe('normalizeMessagesForAPI — mid-conversation empty-signature thinking', () => {
  test('drops the empty-signature thinking block at messages[n].content[0]', () => {
    const messages = [
      createUserMessage({ content: 'first' }),
      // mid-conversation assistant turn that streamed without signature_delta
      assistantWith([thinking(''), text('answer one')]),
      createUserMessage({ content: 'second' }),
      assistantWith([text('answer two')]),
    ]

    const normalized = normalizeMessagesForAPI(messages)

    // No surviving thinking block may carry an empty signature.
    for (const m of normalized) {
      if (m.type !== 'assistant' || !m.message) continue
      const content = m.message.content
      if (!Array.isArray(content)) continue
      for (const block of content as BetaContentBlock[]) {
        if (block.type === 'thinking') {
          expect((block.signature ?? '').trim().length).toBeGreaterThan(0)
        }
      }
    }
  })
})
