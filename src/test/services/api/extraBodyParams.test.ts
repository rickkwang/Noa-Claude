import { afterEach, describe, expect, test } from 'bun:test'
import { getExtraBodyParams } from '../../../services/api/claude.js'

const originalExtraBody = process.env.CLAUDE_CODE_EXTRA_BODY

describe('getExtraBodyParams', () => {
  afterEach(() => {
    if (originalExtraBody === undefined) {
      delete process.env.CLAUDE_CODE_EXTRA_BODY
    } else {
      process.env.CLAUDE_CODE_EXTRA_BODY = originalExtraBody
    }
  })

  test('strips effort fields when requested', () => {
    process.env.CLAUDE_CODE_EXTRA_BODY = JSON.stringify({
      effort: 'high',
      output_config: {
        effort: 'max',
        format: { type: 'json_object' },
      },
      custom: 'kept',
    })

    expect(getExtraBodyParams(undefined, { stripEffort: true })).toEqual({
      output_config: {
        format: { type: 'json_object' },
      },
      custom: 'kept',
    })
  })

  test('preserves effort fields by default', () => {
    process.env.CLAUDE_CODE_EXTRA_BODY = JSON.stringify({
      output_config: {
        effort: 'high',
      },
    })

    expect(getExtraBodyParams()).toEqual({
      output_config: {
        effort: 'high',
      },
    })
  })
})
describe('store is not sent on the Anthropic transport', () => {
  test('omits store for every provider that speaks the Messages API', () => {
    for (const flag of [
      undefined,
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
    ] as const) {
      const previousBaseUrl = process.env.ANTHROPIC_BASE_URL
      if (flag) process.env[flag] = '1'
      process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
      try {
        // POST /v1/messages defines no `store` parameter; sending one buys no
        // privacy and risks rejection by a strict endpoint.
        expect(getExtraBodyParams()).not.toHaveProperty('store')
      } finally {
        if (flag) delete process.env[flag]
        if (previousBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
        else process.env.ANTHROPIC_BASE_URL = previousBaseUrl
      }
    }
  })
})
