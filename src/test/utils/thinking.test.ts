import { afterEach, describe, expect, test } from 'bun:test'
import { modelSupportsAdaptiveThinking } from '../../utils/thinking.js'

const originalUseBedrock = process.env.CLAUDE_CODE_USE_BEDROCK

afterEach(() => {
  if (originalUseBedrock === undefined) {
    delete process.env.CLAUDE_CODE_USE_BEDROCK
  } else {
    process.env.CLAUDE_CODE_USE_BEDROCK = originalUseBedrock
  }
})

describe('modelSupportsAdaptiveThinking', () => {
  test('supports adaptive thinking for Bedrock Opus 4.7', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'

    expect(modelSupportsAdaptiveThinking('anthropic.claude-opus-4-7')).toBe(
      true,
    )
  })
})
