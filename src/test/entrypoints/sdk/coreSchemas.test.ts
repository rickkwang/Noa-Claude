import { describe, expect, test } from 'bun:test'
import { SDKUserMessageSchema } from '../../../entrypoints/sdk/coreSchemas.js'

describe('SDK core schemas', () => {
  test('preserves compact summary tokens_saved metadata', () => {
    const parsed = SDKUserMessageSchema().parse({
      type: 'user',
      message: { role: 'user', content: [] },
      parent_tool_use_id: null,
      is_compact_summary: true,
      summarize_metadata: {
        messages_summarized: 12,
        direction: 'up_to',
        raw_compact_summary: 'summary',
        tokens_saved: 34_000,
      },
    })

    expect(parsed.summarize_metadata?.tokens_saved).toBe(34_000)
  })
})
