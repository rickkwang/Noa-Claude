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
