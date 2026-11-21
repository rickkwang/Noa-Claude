import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  addCacheBreakpoints,
  assistantMessageToMessageParam,
} from '../../../services/api/claude.js'
import type { AssistantMessage, UserMessage } from '../../../types/message.js'

const SAVED_ENV = { ...process.env }

beforeEach(() => {
  process.env.NOA_CLAUDE_PROMPT_CACHE_1H = '0'
  delete process.env.ANTHROPIC_BASE_URL
})

afterEach(() => {
  process.env = { ...SAVED_ENV }
})

function makeAssistantMessage(content: unknown): AssistantMessage {
  return {
    type: 'assistant',
    uuid: 'a-1',
    message: {
      id: 'msg-1',
      role: 'assistant',
      content,
    },
  } as unknown as AssistantMessage
}

function makeUserMessage(content: string): UserMessage {
  return {
    type: 'user',
    uuid: 'u-1',
    message: {
      role: 'user',
      content,
    },
  } as unknown as UserMessage
}

describe('assistantMessageToMessageParam cache breakpoint placement', () => {
  test('marks the last block when it is cacheable', () => {
    const msg = makeAssistantMessage([
      { type: 'thinking', thinking: 'hmm', signature: 'sig' },
      { type: 'text', text: 'hello' },
    ])
    const param = assistantMessageToMessageParam(msg, true, true, 'compact')
    expect(Array.isArray(param.content)).toBe(true)
    const blocks = param.content as unknown as Array<Record<string, unknown>>
    expect(blocks[0]?.cache_control).toBeUndefined()
    expect(blocks[1]?.cache_control).toEqual({ type: 'ephemeral' })
  })

  test('falls back to the last cacheable block when trailing blocks are thinking', () => {
    const msg = makeAssistantMessage([
      { type: 'text', text: 'partial answer' },
      { type: 'thinking', thinking: 'trailing thought', signature: 'sig' },
      { type: 'redacted_thinking', data: 'opaque' },
    ])
    const param = assistantMessageToMessageParam(msg, true, true, 'side_question')
    const blocks = param.content as unknown as Array<Record<string, unknown>>
    expect(blocks[0]?.cache_control).toEqual({ type: 'ephemeral' })
    expect(blocks[1]?.cache_control).toBeUndefined()
    expect(blocks[2]?.cache_control).toBeUndefined()
  })

  test('omits cache_control when all blocks are thinking', () => {
    const msg = makeAssistantMessage([
      { type: 'thinking', thinking: 'only thought', signature: 'sig' },
    ])
    const param = assistantMessageToMessageParam(msg, true, true, 'compact')
    const blocks = param.content as unknown as Array<Record<string, unknown>>
    expect(blocks[0]?.cache_control).toBeUndefined()
  })

  test('skipCacheWrite marks the preceding assistant message even with a trailing thinking block', () => {
    const messages = [
      makeAssistantMessage([
        { type: 'text', text: 'shared prefix' },
        { type: 'thinking', thinking: 'tail', signature: 'sig' },
      ]),
      makeUserMessage('side question'),
    ]
    const result = addCacheBreakpoints(messages, true, 'side_question', true)
    const assistantBlocks = result[0]?.content as unknown as Array<Record<string, unknown>>
    expect(assistantBlocks[0]?.cache_control).toEqual({ type: 'ephemeral' })
    expect(assistantBlocks[1]?.cache_control).toBeUndefined()
    expect(result[1]?.content).toBe('side question')
  })
})
