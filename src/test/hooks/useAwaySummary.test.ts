import { describe, expect, test } from 'bun:test'
import {
  hasSummarySinceLastUserTurn,
  isAwaySummaryEnabled,
} from '../../hooks/useAwaySummary.js'
import type { Message } from '../../types/message.js'

function userMessage(id: string): Message {
  const timestamp = new Date().toISOString()
  return {
    id,
    type: 'user',
    message: {
      role: 'user',
      content: [],
    },
    isMeta: false,
    isCompactSummary: false,
    cwd: null,
    version: '1.0.0',
    uuid: id,
    timestamp,
  }
}

function awaySummaryMessage(id: string): Message {
  const timestamp = new Date().toISOString()
  return {
    id,
    type: 'system',
    subtype: 'away_summary',
    content: 'summary',
    uuid: id,
    timestamp,
    level: 'info',
  }
}

describe('useAwaySummary helpers', () => {
  test('treats away summary as enabled by default', () => {
    expect(isAwaySummaryEnabled({ awaySummaryEnabled: undefined })).toBe(true)
    expect(isAwaySummaryEnabled({ awaySummaryEnabled: true })).toBe(true)
  })

  test('allows users to disable away summary explicitly', () => {
    expect(isAwaySummaryEnabled({ awaySummaryEnabled: false })).toBe(false)
  })

  test('detects an existing away summary after the last user turn', () => {
    expect(
      hasSummarySinceLastUserTurn([userMessage('u1'), awaySummaryMessage('s1')]),
    ).toBe(true)
  })

  test('ignores away summaries that belong to an older user turn', () => {
    expect(
      hasSummarySinceLastUserTurn([
        userMessage('u1'),
        awaySummaryMessage('s1'),
        userMessage('u2'),
      ]),
    ).toBe(false)
  })
})
