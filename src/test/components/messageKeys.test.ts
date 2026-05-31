import { describe, expect, test } from 'bun:test'
import { buildRenderableMessageKeys } from '../../components/messageKeys.js'

describe('buildRenderableMessageKeys', () => {
  test('preserves stable keys for unique message UUIDs', () => {
    expect(
      buildRenderableMessageKeys(
        [{ uuid: 'message-a' }, { uuid: 'message-b' }],
        'conversation-1',
      ),
    ).toEqual(['message-a-conversation-1', 'message-b-conversation-1'])
  })

  test('suffixes duplicate UUIDs from fullscreen partial compact render state', () => {
    expect(
      buildRenderableMessageKeys(
        [
          { uuid: 'kept-before-boundary' },
          { uuid: 'compact-boundary' },
          { uuid: 'kept-before-boundary' },
        ],
        'conversation-1',
      ),
    ).toEqual([
      'kept-before-boundary-conversation-1',
      'compact-boundary-conversation-1',
      'kept-before-boundary-conversation-1-1',
    ])
  })
})
