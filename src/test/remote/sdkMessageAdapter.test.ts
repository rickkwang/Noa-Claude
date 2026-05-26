import { describe, expect, test } from 'bun:test'
import { convertSDKMessage } from '../../remote/sdkMessageAdapter.js'

describe('convertSDKMessage', () => {
  test('always converts compact summary user messages even without user-text opts', () => {
    const converted = convertSDKMessage({
      type: 'user',
      message: {
        role: 'user',
        content:
          'This session is being continued from a previous conversation.\n\nSummary:\n- Checkpoint',
      },
      parent_tool_use_id: null,
      session_id: 'session-1',
      uuid: 'summary-uuid',
      timestamp: new Date().toISOString(),
      isSynthetic: true,
      is_compact_summary: true,
      summarize_metadata: {
        messages_summarized: 3,
        direction: 'from',
        raw_compact_summary: 'Summary:\n- Structured checkpoint',
      },
    } as never)

    expect(converted.type).toBe('message')
    if (converted.type !== 'message') {
      return
    }
    expect(converted.message.type).toBe('user')
    expect(converted.message.isCompactSummary).toBe(true)
    expect(converted.message.isVisibleInTranscriptOnly).toBe(true)
    expect(converted.message.summarizeMetadata?.direction).toBe('from')
    expect(converted.message.summarizeMetadata?.rawCompactSummary).toBe(
      'Summary:\n- Structured checkpoint',
    )
  })
})
