import { afterEach, expect, test } from 'bun:test'
import {
  isSynchronizedOutputSupported,
  reconcileSyncOutputSupported,
  SYNC_OUTPUT_SUPPORTED,
} from '../../ink/terminal.js'

const original = SYNC_OUTPUT_SUPPORTED

afterEach(() => {
  reconcileSyncOutputSupported(original ? 1 : 0)
})

test('default comes from env-based detection', () => {
  expect(SYNC_OUTPUT_SUPPORTED).toBe(isSynchronizedOutputSupported())
})

test('DECRPM status 1/2/3 (set/reset/permanently set) means supported', () => {
  reconcileSyncOutputSupported(0)
  expect(SYNC_OUTPUT_SUPPORTED).toBe(false)
  for (const status of [1, 2, 3]) {
    reconcileSyncOutputSupported(status)
    expect(SYNC_OUTPUT_SUPPORTED).toBe(true)
  }
})

test('DECRPM status 0/4 (not recognized/permanently reset) means unsupported', () => {
  reconcileSyncOutputSupported(1)
  expect(SYNC_OUTPUT_SUPPORTED).toBe(true)
  for (const status of [0, 4]) {
    reconcileSyncOutputSupported(status)
    expect(SYNC_OUTPUT_SUPPORTED).toBe(false)
  }
})
