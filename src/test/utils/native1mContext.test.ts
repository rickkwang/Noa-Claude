import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { setLongContext1mCreditsBlocked } from '../../bootstrap/state.js'
import { getContextWindowForModel } from '../../utils/context.js'

const SAVED = { ...process.env }

function resetEnv() {
  for (const k of [
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_USE_OPENAI',
    'CLAUDE_CODE_DISABLE_1M_CONTEXT',
    'ANTHROPIC_BASE_URL',
  ]) {
    delete process.env[k]
  }
}

describe('native 1M context', () => {
  beforeEach(() => {
    resetEnv()
    setLongContext1mCreditsBlocked(false)
  })

  afterEach(() => {
    process.env = { ...SAVED }
    setLongContext1mCreditsBlocked(false)
  })

  test('native-1M models get 1M on first-party with no beta or suffix', () => {
    for (const m of [
      'claude-sonnet-5',
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-fable-5',
    ]) {
      expect(getContextWindowForModel(m)).toBe(1_000_000)
    }
  })

  test('non-native models stay at the 200k default', () => {
    expect(getContextWindowForModel('claude-sonnet-4-6')).toBe(200_000)
    expect(getContextWindowForModel('claude-haiku-4-5-20251001')).toBe(200_000)
  })

  test('a non-Anthropic base URL does not get native 1M', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.example.com'
    expect(getContextWindowForModel('claude-opus-4-8')).toBe(200_000)
  })

  test('Opus 4.8 has no native 1M on Bedrock; Sonnet 5 does', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(getContextWindowForModel('claude-opus-4-8')).toBe(200_000)
    expect(getContextWindowForModel('claude-sonnet-5')).toBe(1_000_000)
  })

  test('CLAUDE_CODE_DISABLE_1M_CONTEXT forces 200k', () => {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
    expect(getContextWindowForModel('claude-opus-4-8')).toBe(200_000)
  })

  test('credits clamp drops a native 1M window back to 200k', () => {
    expect(getContextWindowForModel('claude-opus-4-8')).toBe(1_000_000)
    setLongContext1mCreditsBlocked(true)
    expect(getContextWindowForModel('claude-opus-4-8')).toBe(200_000)
  })

  test('the clamp leaves already-200k models untouched', () => {
    setLongContext1mCreditsBlocked(true)
    expect(getContextWindowForModel('claude-sonnet-4-6')).toBe(200_000)
  })
})
