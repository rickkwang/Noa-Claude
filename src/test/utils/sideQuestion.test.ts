import { describe, expect, test } from 'bun:test'
import {
  containsLeakedToolCall,
  findBtwTriggerPositions,
} from '../../utils/sideQuestion.js'

// Built at runtime so this file never contains literal tool-call markup.
const P = 'antml:'

describe('containsLeakedToolCall', () => {
  test.each([
    ['prefixed invoke open tag', `<${P}invoke name="Read">`],
    ['bare invoke open tag', '<invoke name="Bash">'],
    ['prefixed function_calls open tag', `<${P}function_calls>`],
    ['bare function_calls open tag', '<function_calls>'],
    ['prefixed invoke close tag', `</${P}invoke>`],
    ['bare function_calls close tag', '</function_calls>'],
  ])('detects %s', (_name, text) => {
    expect(containsLeakedToolCall(`Sure, here you go:\n${text}`)).toBe(true)
  })

  test.each([
    ['plain prose', 'The config lives in src/utils/config.ts.'],
    ['prose naming the tags', 'Use the invoke and function_calls blocks.'],
    ['unrelated xml', '<invoice number="3">'],
    ['generic angle brackets', 'a < b && c > d'],
  ])('does not flag %s', (_name, text) => {
    expect(containsLeakedToolCall(text)).toBe(false)
  })

  test('is stateless across repeated calls', () => {
    const text = '<invoke name="Read">'
    expect(containsLeakedToolCall(text)).toBe(true)
    expect(containsLeakedToolCall(text)).toBe(true)
  })
})

describe('findBtwTriggerPositions', () => {
  test('matches /btw only at the start of the input', () => {
    expect(findBtwTriggerPositions('/btw what is this?')).toEqual([
      { word: '/btw', start: 0, end: 4 },
    ])
    expect(findBtwTriggerPositions('ask /btw later')).toEqual([])
  })
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstText(message: any): string {
  return message.message.content[0].text
}

describe('btw history', () => {
  test('append keeps the most recent 20 exchanges', async () => {
    const { BtwHistory } = await import('../../utils/btwHistory.js')
    const history = new BtwHistory()
    for (let i = 0; i < 25; i++) history.append(`q${i}`, `a${i}`)
    expect(history.exchanges).toHaveLength(20)
    expect(history.exchanges[0]).toEqual({ question: 'q5', response: 'a5' })
  })

  test('resetBtwHistory starts a fresh history', async () => {
    const { getBtwHistory, resetBtwHistory } = await import(
      '../../utils/btwHistory.js'
    )
    getBtwHistory().append('q', 'a')
    resetBtwHistory()
    expect(getBtwHistory().exchanges).toEqual([])
  })
})

describe('buildBtwHistoryMessages', () => {
  test('replays exchanges as user/assistant pairs', async () => {
    const { buildBtwHistoryMessages } = await import(
      '../../utils/sideQuestion.js'
    )
    const messages = buildBtwHistoryMessages([
      { question: 'what is x?', response: 'x is y' },
    ])
    expect(messages.map(m => m.type)).toEqual(['user', 'assistant'])
    expect(firstText(messages[1])).toBe('x is y')
  })

  test('omits answers that wrote tool calls as text', async () => {
    const { buildBtwHistoryMessages } = await import(
      '../../utils/sideQuestion.js'
    )
    const [, assistant] = buildBtwHistoryMessages([
      { question: 'q', response: `<${P}invoke name="Read">` },
    ])
    expect(firstText(assistant)).toContain('omitted')
  })
})

describe('extractSideQuestionResponse', () => {
  test('marks a tool-call attempt as synthetic', async () => {
    const { extractSideQuestionResponse } = await import(
      '../../utils/sideQuestion.js'
    )
    const result = extractSideQuestionResponse([
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', id: 't', input: {} }] },
      },
    ] as never)
    expect(result.synthetic).toBe(true)
    expect(result.response).toContain('Read')
  })

  test('a text answer is not synthetic', async () => {
    const { extractSideQuestionResponse } = await import(
      '../../utils/sideQuestion.js'
    )
    const result = extractSideQuestionResponse([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
    ] as never)
    expect(result).toEqual({ response: 'hi', synthetic: false })
  })
})

describe('answers cut off by an API error', () => {
  const apiError = {
    type: 'assistant',
    isApiErrorMessage: true,
    message: { content: [{ type: 'text', text: 'API Error: overloaded' }] },
  }

  test('keep the partial text, marked as cut off', async () => {
    const { extractSideQuestionResponse } = await import(
      '../../utils/sideQuestion.js'
    )
    const result = extractSideQuestionResponse([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'The build' }] } },
      apiError,
    ] as never)
    expect(result.synthetic).toBe(false)
    expect(result.response).toStartWith('The build\n\n')
    expect(result.response).toContain('cut off')
    expect(result.response).not.toContain('overloaded')
  })

  test('without any text report the error as a notice', async () => {
    const { extractSideQuestionResponse } = await import(
      '../../utils/sideQuestion.js'
    )
    expect(extractSideQuestionResponse([apiError] as never)).toEqual({
      response: '(API error: overloaded)',
      synthetic: true,
    })
  })

  test('are not replayed as complete answers', async () => {
    const { buildBtwHistoryMessages, extractSideQuestionResponse } =
      await import('../../utils/sideQuestion.js')
    const { response } = extractSideQuestionResponse([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'The build' }] } },
      apiError,
    ] as never)
    const [, assistant] = buildBtwHistoryMessages([
      { question: 'q', response: response! },
    ])
    expect(firstText(assistant)).toContain('omitted')
  })
})

describe('buildInProgressToolResults', () => {
  const call = (messageId: string, id: string) => ({
    type: 'assistant',
    message: { id: messageId, content: [{ type: 'tool_use', id, name: 'Bash', input: {} }] },
  })
  const result = (id: string) => ({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
  })

  test('marks calls of the latest response that have no result as still running', async () => {
    const { buildInProgressToolResults } = await import(
      '../../utils/sideQuestion.js'
    )
    const message = buildInProgressToolResults([
      call('m1', 'old'),
      result('old'),
      call('m2', 'done'),
      call('m2', 'running'),
      result('done'),
    ] as never)
    expect(message?.isMeta).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks = (message as any).message.content
    expect(blocks.map((b: { tool_use_id: string }) => b.tool_use_id)).toEqual(['running'])
    expect(blocks[0].content).toContain('still in progress')
  })

  test('adds nothing when every call has a result', async () => {
    const { buildInProgressToolResults } = await import(
      '../../utils/sideQuestion.js'
    )
    expect(buildInProgressToolResults([call('m1', 'a'), result('a')] as never)).toBeUndefined()
  })
})
