import { describe, expect, test } from 'bun:test'
import {
  fromSDKSummarizeMetadata,
  toSDKSummarizeMetadata,
} from '../../../utils/messages/summarizeMetadata.js'

describe('summarizeMetadata SDK adapter', () => {
  test('round-trips tokensSaved so it survives resume/remote', () => {
    const internal = {
      messagesSummarized: 42,
      userContext: 'keep the auth work',
      direction: 'up_to' as const,
      rawCompactSummary: 'summary text',
      tokensSaved: 87_500,
    }

    const sdk = toSDKSummarizeMetadata(internal)
    expect(sdk?.tokens_saved).toBe(87_500)

    const back = fromSDKSummarizeMetadata(sdk)
    expect(back).toEqual(internal)
  })

  test('tolerates absent tokensSaved (older messages)', () => {
    const sdk = toSDKSummarizeMetadata({
      messagesSummarized: 1,
      direction: 'up_to',
    })
    expect(sdk?.tokens_saved).toBeUndefined()
    expect(fromSDKSummarizeMetadata(sdk)?.tokensSaved).toBeUndefined()
  })

  test('passes undefined through', () => {
    expect(toSDKSummarizeMetadata(undefined)).toBeUndefined()
    expect(fromSDKSummarizeMetadata(undefined)).toBeUndefined()
  })
})
