import { afterEach, describe, expect, test } from 'bun:test'
import {
  _getFailsafeTimerForTesting,
  _getOrphanCheckIntervalForTesting,
  _setFailsafeTimerForTesting,
  _setOrphanCheckIntervalForTesting,
  resetShutdownState,
} from './gracefulShutdown.js'

describe('gracefulShutdown reset state', () => {
  afterEach(() => {
    resetShutdownState()
  })

  test('resetShutdownState clears failsafe timeout and orphan interval', () => {
    const originalClearTimeout = globalThis.clearTimeout
    const originalClearInterval = globalThis.clearInterval
    let clearTimeoutCalled = false
    let clearIntervalCalled = false
    let clearTimeoutArg: ReturnType<typeof setTimeout> | undefined
    let clearIntervalArg: ReturnType<typeof setInterval> | undefined

    const orphanInterval = setInterval(() => {}, 60_000)
    const failsafeTimer = setTimeout(() => {}, 60_000)
    _setOrphanCheckIntervalForTesting(orphanInterval)
    _setFailsafeTimerForTesting(failsafeTimer)

    ;(globalThis as any).clearTimeout = (
      timer: ReturnType<typeof setTimeout>,
    ) => {
      clearTimeoutCalled = true
      clearTimeoutArg = timer
      return originalClearTimeout(timer)
    }
    ;(globalThis as any).clearInterval = (
      timer: ReturnType<typeof setInterval>,
    ) => {
      clearIntervalCalled = true
      clearIntervalArg = timer
      return originalClearInterval(timer)
    }

    try {
      resetShutdownState()
      expect(clearTimeoutCalled).toBe(true)
      expect(clearIntervalCalled).toBe(true)
      expect(clearTimeoutArg).toBe(failsafeTimer)
      expect(clearIntervalArg).toBe(orphanInterval)
      expect(_getFailsafeTimerForTesting()).toBeUndefined()
      expect(_getOrphanCheckIntervalForTesting()).toBeUndefined()

      // Idempotency: second call should not throw and remains cleared.
      resetShutdownState()
      expect(_getFailsafeTimerForTesting()).toBeUndefined()
      expect(_getOrphanCheckIntervalForTesting()).toBeUndefined()
    } finally {
      ;(globalThis as any).clearTimeout = originalClearTimeout
      ;(globalThis as any).clearInterval = originalClearInterval
    }
  })
})
