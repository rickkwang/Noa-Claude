import { describe, expect, test } from 'bun:test'
import { createUserMessage } from '../../../utils/messages.js'
import {
  toInternalMessages,
  toSDKMessages,
} from '../../../utils/messages/mappers.js'

describe('SDK message mappers', () => {
  test('preserves compact summary metadata across SDK round-trips', () => {
    const summaryMessage = createUserMessage({
      content: 'This session is being continued.\n\nSummary:\n- Checkpoint',
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
      summarizeMetadata: {
        messagesSummarized: 4,
        direction: 'from',
        rawCompactSummary: 'Summary:\n- Structured checkpoint',
      },
    })

    const sdkMessages = toSDKMessages([summaryMessage])
    const roundTripped = toInternalMessages(sdkMessages)

    expect(roundTripped).toHaveLength(1)
    expect(roundTripped[0]?.isCompactSummary).toBe(true)
    expect(roundTripped[0]?.isVisibleInTranscriptOnly).toBe(true)
    expect(roundTripped[0]?.summarizeMetadata?.rawCompactSummary).toBe(
      'Summary:\n- Structured checkpoint',
    )
    expect(roundTripped[0]?.summarizeMetadata?.direction).toBe('from')
  })
})
