import { afterEach, describe, expect, test } from 'bun:test'
import { nextSubagentDepth } from '../../../utils/agentContext.js'
import {
  getMaxConcurrentAgents,
  getMaxSubagentSpawnDepth,
  getMaxSubagentsPerSession,
  getMaxWebSearchesPerSession,
  getTotalAgentSpawns,
  getWebSearchCalls,
  incrementTotalAgentSpawns,
  incrementWebSearchCalls,
  resetSessionBudgets,
} from '../../../utils/task/sessionBudget.js'
import * as sessionBudget from '../../../utils/task/sessionBudget.js'

const ENV_KEYS = [
  'NOA_CLAUDE_MAX_SUBAGENTS_PER_SESSION',
  'CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION',
  'NOA_CLAUDE_MAX_WEB_SEARCHES_PER_SESSION',
  'CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION',
  'NOA_CLAUDE_MAX_CONCURRENT_AGENTS',
  'CLAUDE_CODE_MAX_CONCURRENT_AGENTS',
  'NOA_CLAUDE_MAX_SUBAGENT_SPAWN_DEPTH',
  'CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH',
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

// Failure modes covered: wrong default, env precedence inverted, invalid value
// accepted, and nesting computed from the wrong parent (teammate/background
// session treated as a subagent, or a resumed agent allowed to nest).
describe('subagent spawn depth', () => {
  test('defaults to 2 and honors both env spellings with NOA_ precedence', () => {
    expect(getMaxSubagentSpawnDepth()).toBe(2)
    process.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = '4'
    expect(getMaxSubagentSpawnDepth()).toBe(4)
    process.env.NOA_CLAUDE_MAX_SUBAGENT_SPAWN_DEPTH = '3'
    expect(getMaxSubagentSpawnDepth()).toBe(3)
  })

  test('invalid values fall back to the default', () => {
    process.env.NOA_CLAUDE_MAX_SUBAGENT_SPAWN_DEPTH = 'deep'
    expect(getMaxSubagentSpawnDepth()).toBe(2)
  })

  test('main thread and teammates spawn depth 1', () => {
    expect(nextSubagentDepth(undefined)).toBe(1)
    expect(
      nextSubagentDepth({
        agentId: 'lead@team',
        agentName: 'lead',
        teamName: 'team',
        planModeRequired: false,
        parentSessionId: 's',
        isTeamLead: true,
        agentType: 'teammate',
      }),
    ).toBe(1)
  })

  test('background main session (depth 0) spawns depth 1', () => {
    expect(nextSubagentDepth({ agentId: 't', agentType: 'subagent', depth: 0 })).toBe(1)
  })

  test('a subagent spawns one level deeper', () => {
    expect(nextSubagentDepth({ agentId: 'a', agentType: 'subagent', depth: 1 })).toBe(2)
  })

  test('a subagent with unknown depth (resumed) fails closed', () => {
    expect(nextSubagentDepth({ agentId: 'r', agentType: 'subagent' })).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('getMaxConcurrentAgents', () => {
  test('defaults to 20', () => {
    expect(getMaxConcurrentAgents()).toBe(20)
  })

  test('env override with NOA_CLAUDE_* precedence and invalid fallback', () => {
    process.env.CLAUDE_CODE_MAX_CONCURRENT_AGENTS = '8'
    expect(getMaxConcurrentAgents()).toBe(8)

    process.env.NOA_CLAUDE_MAX_CONCURRENT_AGENTS = '4'
    expect(getMaxConcurrentAgents()).toBe(4)

    process.env.NOA_CLAUDE_MAX_CONCURRENT_AGENTS = 'bogus'
    expect(getMaxConcurrentAgents()).toBe(8)
  })

  test('zero disables the cap (caller skips the check)', () => {
    process.env.NOA_CLAUDE_MAX_CONCURRENT_AGENTS = '0'
    expect(getMaxConcurrentAgents()).toBe(0)
  })
})

describe('sessionBudget counters', () => {
  test('can roll back a rejected agent spawn reservation', () => {
    const decrement = (
      sessionBudget as typeof sessionBudget & {
        decrementTotalAgentSpawns: () => void
      }
    ).decrementTotalAgentSpawns
    expect(typeof decrement).toBe('function')
    incrementTotalAgentSpawns()
    decrement?.()
    expect(getTotalAgentSpawns()).toBe(0)
  })

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
