import { afterEach, describe, expect, test } from 'bun:test'
import {
  calculateTokenWarningState,
  ERROR_THRESHOLD_BUFFER_TOKENS,
  getEffectiveContextWindowSize,
  WARNING_THRESHOLD_BUFFER_TOKENS,
} from '../../../services/compact/autoCompact.js'

const originalEnv = {
  DISABLE_AUTO_COMPACT: process.env.DISABLE_AUTO_COMPACT,
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

describe('calculateTokenWarningState', () => {
  afterEach(() => {
    restoreEnv()
  })

  test('keeps warning and error thresholds distinct', () => {
    expect(ERROR_THRESHOLD_BUFFER_TOKENS).toBeLessThan(
      WARNING_THRESHOLD_BUFFER_TOKENS,
    )

    process.env.DISABLE_AUTO_COMPACT = '1'

    const model = 'test-model'
    const effectiveWindow = getEffectiveContextWindowSize(model)
    const tokenUsageBetweenThresholds =
      effectiveWindow -
      Math.floor((WARNING_THRESHOLD_BUFFER_TOKENS + ERROR_THRESHOLD_BUFFER_TOKENS) / 2)

    const state = calculateTokenWarningState(
      tokenUsageBetweenThresholds,
      model,
    )

    expect(state.isAboveWarningThreshold).toBe(true)
    expect(state.isAboveErrorThreshold).toBe(false)
  })
})
