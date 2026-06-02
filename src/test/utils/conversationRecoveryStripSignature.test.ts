import { describe, expect, test } from 'bun:test'
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages'
import { deserializeMessages } from '../../utils/conversationRecovery.js'
import {
  createAssistantMessage,
  createUserMessage,
} from '../../utils/messages.js'

function thinking(signature: string): BetaContentBlock {
  return { type: 'thinking', thinking: 'reasoning', signature } as BetaContentBlock
}

const text = (t: string): BetaContentBlock =>
  ({ type: 'text', text: t, citations: [] }) as BetaContentBlock

function thinkingBlocksIn(
  messages: ReturnType<typeof deserializeMessages>,
): BetaContentBlock[] {
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

describe('deserializeMessages — strips thinking signatures on resume', () => {
  test('drops a valid-signature thinking block (stale after a provider switch)', () => {
    // A signature generated under one API key/provider fails validation after a
    // mid-session switch; the append-only transcript still carries it, so resume
    // would replay it and 400. It must not survive deserialization.
    const out = deserializeMessages([
      createUserMessage({ content: 'q1' }),
      createAssistantMessage({ content: [thinking('valid-sig-abc'), text('a1')] }),
    ])

    expect(thinkingBlocksIn(out)).toHaveLength(0)
    // The accompanying text must be preserved.
    const texts = out
      .filter(m => m.type === 'assistant' && Array.isArray(m.message?.content))
      .flatMap(m => (m.message!.content as BetaContentBlock[]))
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
    expect(texts).toContain('a1')
  })

  test('also drops empty-signature thinking blocks', () => {
    const out = deserializeMessages([
      createUserMessage({ content: 'q1' }),
      createAssistantMessage({ content: [thinking(''), text('a1')] }),
      createUserMessage({ content: 'q2' }),
      createAssistantMessage({ content: [thinking('sig'), text('a2')] }),
    ])
    expect(thinkingBlocksIn(out)).toHaveLength(0)
  })

  test('leaves a thinking-free history unchanged in shape', () => {
    const out = deserializeMessages([
      createUserMessage({ content: 'q1' }),
      createAssistantMessage({ content: [text('a1')] }),
    ])
    expect(thinkingBlocksIn(out)).toHaveLength(0)
    expect(out.some(m => m.type === 'assistant')).toBe(true)
  })
})
