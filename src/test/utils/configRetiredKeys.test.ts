import { describe, expect, test } from 'bun:test'
import { _removeRetiredGlobalConfigKeysForTesting as removeRetiredKeys } from '../../utils/config.js'

describe('retired global config keys', () => {
  test('drops retired keys and keeps everything else', () => {
    const config = {
      numStartups: 3,
      opus1mMergeNoticeSeenCount: 5,
      prideFlag: true,
      voiceNoticeSeenCount: 2,
      speculationEnabled: false,
    } as never

    expect(removeRetiredKeys(config) as unknown).toEqual({
      numStartups: 3,
      voiceNoticeSeenCount: 2,
      speculationEnabled: false,
    })
  })

  test('returns the same object when nothing is retired', () => {
    const config = { numStartups: 3 } as never

    expect(removeRetiredKeys(config)).toBe(config)
  })
})
