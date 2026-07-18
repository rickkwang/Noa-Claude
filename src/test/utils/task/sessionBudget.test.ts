import { afterEach, describe, expect, test } from 'bun:test'
import {
  getMaxSubagentsPerSession,
  getMaxWebSearchesPerSession,
  getTotalAgentSpawns,
  getWebSearchCalls,
  incrementTotalAgentSpawns,
  incrementWebSearchCalls,
  resetSessionBudgets,
} from '../../../utils/task/sessionBudget.js'

const ENV_KEYS = [
  'NOA_CLAUDE_MAX_SUBAGENTS_PER_SESSION',
  'CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION',
  'NOA_CLAUDE_MAX_WEB_SEARCHES_PER_SESSION',
  'CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION',
] as const

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
  resetSessionBudgets()
})

describe('sessionBudget limits', () => {
  test('defaults to 200 for both budgets', () => {
    expect(getMaxSubagentsPerSession()).toBe(200)
    expect(getMaxWebSearchesPerSession()).toBe(200)
  })

  test('legacy CLAUDE_CODE_* env vars override the default', () => {
    process.env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION = '5'
    process.env.CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION = '7'
    expect(getMaxSubagentsPerSession()).toBe(5)
    expect(getMaxWebSearchesPerSession()).toBe(7)
  })

  test('NOA_CLAUDE_* takes precedence over CLAUDE_CODE_*', () => {
    process.env.NOA_CLAUDE_MAX_SUBAGENTS_PER_SESSION = '3'
    process.env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION = '5'
    expect(getMaxSubagentsPerSession()).toBe(3)
  })

  test('invalid values fall through to the next source', () => {
    process.env.NOA_CLAUDE_MAX_WEB_SEARCHES_PER_SESSION = 'not-a-number'
    process.env.CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION = '9'
    expect(getMaxWebSearchesPerSession()).toBe(9)

    process.env.CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION = '-1'
    expect(getMaxWebSearchesPerSession()).toBe(200)
  })

  test('zero disables the budget entirely (0 >= 0 blocks immediately)', () => {
    process.env.NOA_CLAUDE_MAX_SUBAGENTS_PER_SESSION = '0'
    expect(getMaxSubagentsPerSession()).toBe(0)
  })
})

describe('sessionBudget counters', () => {
  test('counters start at zero, increment independently, and reset together', () => {
    expect(getTotalAgentSpawns()).toBe(0)
    expect(getWebSearchCalls()).toBe(0)

    incrementTotalAgentSpawns()
    incrementTotalAgentSpawns()
    incrementWebSearchCalls()
    expect(getTotalAgentSpawns()).toBe(2)
    expect(getWebSearchCalls()).toBe(1)

    resetSessionBudgets()
    expect(getTotalAgentSpawns()).toBe(0)
    expect(getWebSearchCalls()).toBe(0)
  })
})
