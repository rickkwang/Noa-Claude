import { afterEach, describe, expect, test } from 'bun:test'
import { getAPIContextManagement } from '../../../services/compact/apiMicrocompact.js'

const originalEnv = {
  API_MAX_INPUT_TOKENS: process.env.API_MAX_INPUT_TOKENS,
  API_TARGET_INPUT_TOKENS: process.env.API_TARGET_INPUT_TOKENS,
  USER_TYPE: process.env.USER_TYPE,
  USE_API_CLEAR_TOOL_RESULTS: process.env.USE_API_CLEAR_TOOL_RESULTS,
  USE_API_CLEAR_TOOL_USES: process.env.USE_API_CLEAR_TOOL_USES,
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

describe('getAPIContextManagement', () => {
  afterEach(() => {
    restoreEnv()
  })

  test('falls back to defaults for invalid API token env values', () => {
    process.env.USER_TYPE = 'ant'
    process.env.USE_API_CLEAR_TOOL_RESULTS = '1'
    process.env.API_MAX_INPUT_TOKENS = 'not-a-number'
    process.env.API_TARGET_INPUT_TOKENS = 'also-not-a-number'

    expect(getAPIContextManagement()).toEqual({
      edits: [
        expect.objectContaining({
          trigger: { type: 'input_tokens', value: 180_000 },
          clear_at_least: { type: 'input_tokens', value: 140_000 },
        }),
      ],
    })
  })

  test('keeps clear_at_least positive when target is greater than trigger', () => {
    process.env.USER_TYPE = 'ant'
    process.env.USE_API_CLEAR_TOOL_USES = '1'
    process.env.API_MAX_INPUT_TOKENS = '1000'
    process.env.API_TARGET_INPUT_TOKENS = '2000'

    expect(getAPIContextManagement()).toEqual({
      edits: [
        expect.objectContaining({
          trigger: { type: 'input_tokens', value: 1000 },
          clear_at_least: { type: 'input_tokens', value: 1 },
        }),
      ],
    })
  })
})
