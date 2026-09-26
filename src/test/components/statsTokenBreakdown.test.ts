import { describe, expect, test } from 'bun:test'
import { getModelEntriesWithTotal, getUsageTotalTokens } from '../../components/Stats.js'

const CACHE_HEAVY = {
  inputTokens: 1_000,
  outputTokens: 2_000,
  cacheReadInputTokens: 500_000,
  cacheCreationInputTokens: 30_000,
}

describe('Stats token accounting', () => {
  test('includes both cache token classes in the total', () => {
    expect(getUsageTotalTokens(CACHE_HEAVY)).toBe(533_000)
  })

  test('sorts models by cache-inclusive usage', () => {
    const chatty = {
      inputTokens: 10_000,
      outputTokens: 10_000,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    }
    const cached = {
      inputTokens: 100,
      outputTokens: 100,
      cacheReadInputTokens: 900_000,
      cacheCreationInputTokens: 0,
    }
    const { modelEntries } = getModelEntriesWithTotal({ chatty, cached })
    expect(modelEntries[0]![0]).toBe('cached')
  })
})
