import { describe, expect, test } from 'bun:test'
import { hasTeammateMessageTag } from '../../components/messages/UserTeammateMessage.js'

describe('hasTeammateMessageTag', () => {
  test('matches producer-formatted teammate messages', () => {
    expect(
      hasTeammateMessageTag('<teammate-message teammate_id="alice" summary="hi">\nbody\n</teammate-message>'),
    ).toBe(true)
  })

  test('ignores prompts that only quote the tag', () => {
    expect(hasTeammateMessageTag('why does <teammate-message teammate_id="a"> render?')).toBe(false)
    expect(hasTeammateMessageTag('<teammate-messages>')).toBe(false)
  })
})
