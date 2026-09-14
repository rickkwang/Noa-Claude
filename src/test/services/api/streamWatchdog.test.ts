import { describe, expect, test } from 'bun:test'
import {
  getStreamIdleTimeoutMs,
  isStreamWatchdogEnabled,
  STREAM_IDLE_TIMEOUT_FLOOR_MS,
} from '../../../services/api/streamWatchdog.js'

describe('isStreamWatchdogEnabled', () => {
  test('is on when the variable is unset', () => {
    expect(isStreamWatchdogEnabled(undefined)).toBe(true)
  })

  test('turns off only for an explicit falsy value', () => {
    for (const value of ['0', 'false', 'no', 'off', ' OFF ']) {
      expect(isStreamWatchdogEnabled(value)).toBe(false)
    }
  })

  test('stays on for truthy, empty, or unrecognized values', () => {
    for (const value of ['1', 'true', '', 'maybe']) {
      expect(isStreamWatchdogEnabled(value)).toBe(true)
    }
  })
})

describe('getStreamIdleTimeoutMs', () => {
  test('defaults to the floor', () => {
    expect(STREAM_IDLE_TIMEOUT_FLOOR_MS).toBe(300_000)
    expect(getStreamIdleTimeoutMs(undefined)).toBe(300_000)
    expect(getStreamIdleTimeoutMs('not-a-number')).toBe(300_000)
  })

  test('ignores a value below the floor', () => {
    expect(getStreamIdleTimeoutMs('90000')).toBe(300_000)
    expect(getStreamIdleTimeoutMs('0')).toBe(300_000)
  })

  test('honors a value above the floor', () => {
    expect(getStreamIdleTimeoutMs('600000')).toBe(600_000)
  })
})
