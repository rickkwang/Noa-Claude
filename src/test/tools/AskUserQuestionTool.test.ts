import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  ASK_USER_QUESTION_TOOL_PROMPT,
  RESERVE_FOR_BLOCKING_DECISIONS_NOTE,
  getAskUserQuestionPrompt,
} from '../../tools/AskUserQuestionTool/prompt.js'

// The lean/verbose gate judges provider identity from env
// (isUntrustedModelIdentity): an ambient ANTHROPIC_BASE_URL or
// CLAUDE_CODE_USE_* from the dev shell flips every assertion here to the
// verbose branch. Scrub before each test, restore after.
const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'NOA_CLAUDE_SIMPLE_SYSTEM_PROMPT',
  'CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT',
  'NOA_CLAUDE_THIRD_PARTY_PROMPT_POLICY',
] as const
const originalProviderEnv = Object.fromEntries(
  PROVIDER_ENV_KEYS.map(k => [k, process.env[k]]),
)
beforeEach(() => {
  for (const k of PROVIDER_ENV_KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of PROVIDER_ENV_KEYS) {
    const value = originalProviderEnv[k]
    if (value === undefined) delete process.env[k]
    else process.env[k] = value
  }
})

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
