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
