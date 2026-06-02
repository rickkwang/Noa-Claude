import { afterEach, describe, expect, test } from 'bun:test'
import {
  createCompactionResultFromSessionMemory,
  trySessionMemoryCompaction,
} from '../../../services/compact/sessionMemoryCompact.js'
import { createUserMessage } from '../../../utils/messages.js'

const originalEnableSmCompact = process.env.ENABLE_CLAUDE_CODE_SM_COMPACT

afterEach(() => {
  if (originalEnableSmCompact === undefined) {
    delete process.env.ENABLE_CLAUDE_CODE_SM_COMPACT
  } else {
    process.env.ENABLE_CLAUDE_CODE_SM_COMPACT = originalEnableSmCompact
  }
})

describe('session memory compaction', () => {
  test('preserves the caller trigger in compact boundary metadata', async () => {
    const first = createUserMessage({ content: 'before compact' })
    const kept = createUserMessage({ content: 'kept after compact' })

    const result = await createCompactionResultFromSessionMemory(
      [first, kept],
      'Summary:\n- Session memory checkpoint',
      [kept],
      [],
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
      [],
      '/tmp/transcript.jsonl',
      'auto',
    )

    expect(result.boundaryMarker.compactMetadata?.trigger).toBe('auto')
  })

  test('keeps post-compact attachments supplied by the caller', async () => {
    const first = createUserMessage({ content: 'before compact' })
    const kept = createUserMessage({ content: 'kept after compact' })
    const attachment = {
      type: 'attachment' as const,
      id: 'sm-test-attachment-id',
      uuid: 'sm-plan-mode-attachment',
      attachment: {
        type: 'test_attachment',
      },
      attachments: [],
    }

    const result = await createCompactionResultFromSessionMemory(
      [first, kept],
      'Summary:\n- Session memory checkpoint',
      [kept],
      [attachment],
      [],
      '/tmp/transcript.jsonl',
      'auto',
    )

    expect(result.attachments.map(m => m.uuid)).toEqual([
      'sm-plan-mode-attachment',
    ])
  })

  test('returns null instead of throwing when called with a partial context', async () => {
    process.env.ENABLE_CLAUDE_CODE_SM_COMPACT = '1'

    const message = createUserMessage({ content: 'before compact' })

    await expect(
      trySessionMemoryCompaction([message], {
        context: {
          abortController: new AbortController(),
          onCompactProgress: () => {},
        } as never,
      }),
    ).resolves.toBeNull()
  })
})
