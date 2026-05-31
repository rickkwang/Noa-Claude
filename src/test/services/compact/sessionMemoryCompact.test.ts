import { describe, expect, test } from 'bun:test'
import { createCompactionResultFromSessionMemory } from '../../../services/compact/sessionMemoryCompact.js'
import { createUserMessage } from '../../../utils/messages.js'

describe('session memory compaction', () => {
  test('preserves the caller trigger in compact boundary metadata', async () => {
    const first = createUserMessage({ content: 'before compact' })
    const kept = createUserMessage({ content: 'kept after compact' })

    const result = await createCompactionResultFromSessionMemory(
      [first, kept],
      'Summary:\n- Session memory checkpoint',
      [kept],
      [],
      '/tmp/transcript.jsonl',
      'manual',
    )

    expect(result.boundaryMarker.compactMetadata?.trigger).toBe('manual')
  })

  test('records auto trigger when called by autoCompact', async () => {
    const first = createUserMessage({ content: 'before compact' })
    const kept = createUserMessage({ content: 'kept after compact' })

    const result = await createCompactionResultFromSessionMemory(
      [first, kept],
      'Summary:\n- Session memory checkpoint',
      [kept],
      [],
      '/tmp/transcript.jsonl',
      'auto',
    )

    expect(result.boundaryMarker.compactMetadata?.trigger).toBe('auto')
  })
})
