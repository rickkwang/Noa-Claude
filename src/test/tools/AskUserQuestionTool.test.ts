import { describe, expect, test } from 'bun:test'
import {
  ASK_USER_QUESTION_TOOL_PROMPT,
  RESERVE_FOR_BLOCKING_DECISIONS_NOTE,
  getAskUserQuestionPrompt,
} from '../../tools/AskUserQuestionTool/prompt.js'

const LEAN_MODEL = 'claude-opus-5'
const FULL_MODEL = 'claude-sonnet-5'

describe('AskUserQuestionTool prompt', () => {
  test('verbose models get the base prompt only', () => {
    expect(getAskUserQuestionPrompt(FULL_MODEL)).toBe(ASK_USER_QUESTION_TOOL_PROMPT)
  })

  test('no model falls back to the base prompt', () => {
    expect(getAskUserQuestionPrompt(undefined)).toBe(ASK_USER_QUESTION_TOOL_PROMPT)
  })

  test('lean models get an extra guardrail paragraph appended, not a shorter prompt', () => {
    const lean = getAskUserQuestionPrompt(LEAN_MODEL)
    expect(lean).toBe(ASK_USER_QUESTION_TOOL_PROMPT + RESERVE_FOR_BLOCKING_DECISIONS_NOTE)
    expect(lean.length).toBeGreaterThan(ASK_USER_QUESTION_TOOL_PROMPT.length)
  })
})
