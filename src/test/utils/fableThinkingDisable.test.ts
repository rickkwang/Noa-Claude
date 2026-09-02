import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  modelRequiresExplicitThinkingDisable,
  modelThinkingCannotBeDisabled,
} from '../../utils/thinking.js'

const SAVED = { ...process.env }

beforeEach(() => {
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.USER_TYPE
})

afterEach(() => {
  process.env = { ...SAVED }
})

describe('turning thinking off is three different requests', () => {
  test('Fable / Mythos: thinking cannot be disabled at all', () => {
    for (const m of [
      'claude-fable-5',
      'claude-fable-5-1',
      'claude-mythos-5',
      'claude-mythos-5-1',
    ]) {
      expect(modelThinkingCannotBeDisabled(m)).toBe(true)
      // and they must NOT be sent an explicit {type:'disabled'} — that is the 400
      expect(modelRequiresExplicitThinkingDisable(m)).toBe(false)
    }
  })

  test('Sonnet 5 / Opus 5: omitting still thinks, so disable must be stated', () => {
    for (const m of ['claude-sonnet-5', 'claude-opus-5']) {
      expect(modelRequiresExplicitThinkingDisable(m)).toBe(true)
      expect(modelThinkingCannotBeDisabled(m)).toBe(false)
    }
  })

  test('4.8 and older: omitting is already off — neither predicate fires', () => {
    for (const m of [
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ]) {
      expect(modelRequiresExplicitThinkingDisable(m)).toBe(false)
      expect(modelThinkingCannotBeDisabled(m)).toBe(false)
    }
  })

  test('the two predicates are never both true', () => {
    for (const m of [
      'claude-fable-5-1',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-opus-4-8',
      'claude-mythos-5-1',
    ]) {
      expect(
        modelRequiresExplicitThinkingDisable(m) &&
          modelThinkingCannotBeDisabled(m),
      ).toBe(false)
    }
  })
})
