import { describe, expect, test } from 'bun:test'
import {
  getNext,
  isNotificationVisible,
  type Notification,
} from '../../context/notifications.js'

/**
 * While the diff panel is open the notification row is held: it sits directly
 * under a surface the user is reading, and a toast landing there pulls the eye
 * off the diff. The exception is anything that is half of an interaction (a
 * "press again to confirm"), which has to stay visible or the gesture becomes
 * unexplainable.
 */

const toast: Notification = {
  key: 'selection-copied',
  text: 'copied',
  priority: 'immediate',
}

const confirm: Notification = {
  key: 'kill-agents-confirm',
  text: 'Press ctrl+x ctrl+k again to stop background agents',
  priority: 'immediate',
  exemptFromDiffPanelHold: true,
}

describe('isNotificationVisible', () => {
  test('shows everything while the panel is closed', () => {
    expect(isNotificationVisible(toast, false)).toBe(true)
    expect(isNotificationVisible(confirm, false)).toBe(true)
  })

  test('hides a plain toast while the panel is open', () => {
    expect(isNotificationVisible(toast, true)).toBe(false)
  })

  test('still shows an exempt notification while the panel is open', () => {
    expect(isNotificationVisible(confirm, true)).toBe(true)
  })

  test('is false with nothing to show', () => {
    expect(isNotificationVisible(null, false)).toBe(false)
    expect(isNotificationVisible(null, true)).toBe(false)
  })
})

describe('queue selection under the hold', () => {
  // Mirrors the filter processQueue applies: while the panel is up, only
  // exempt notifications are eligible to be promoted to `current`.
  const eligible = (queue: Notification[], panelOpen: boolean) =>
    getNext(panelOpen ? queue.filter(n => n.exemptFromDiffPanelHold) : queue)

  test('promotes normally while the panel is closed', () => {
    expect(eligible([toast, confirm], false)).toBeDefined()
  })

  test('skips non-exempt entries while the panel is open', () => {
    expect(eligible([toast], true)).toBeUndefined()
    expect(eligible([toast, confirm], true)?.key).toBe('kill-agents-confirm')
  })

  test('a held queue drains once the panel closes', () => {
    const queue = [toast]
    expect(eligible(queue, true)).toBeUndefined()
    expect(eligible(queue, false)?.key).toBe('selection-copied')
  })
})
