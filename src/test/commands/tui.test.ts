import { afterEach, describe, expect, test } from 'bun:test'
import {
  call,
  getFullscreenNoticeTrigger,
  subscribeToFullscreenNoticeTrigger,
} from '../../commands/tui/tui.js'

afterEach(() => {
  call('default')
})

describe('/tui command', () => {
  test('emits a fullscreen notice trigger when switching from default to fullscreen', () => {
    call('default')

    const seen: number[] = []
    const unsubscribe = subscribeToFullscreenNoticeTrigger(() => {
      seen.push(getFullscreenNoticeTrigger())
    })

    const before = getFullscreenNoticeTrigger()
    expect(call('fullscreen')).toEqual({
      value: 'Terminal UI mode set to: fullscreen (applied to current session)',
    })

    expect(getFullscreenNoticeTrigger()).toBe(before + 1)
    expect(seen.at(-1)).toBe(getFullscreenNoticeTrigger())

    unsubscribe()
  })
})
