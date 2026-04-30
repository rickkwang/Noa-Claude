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
