import { describe, expect, test } from 'bun:test'
import {
  assignAgentPersonalityName,
  AGENT_PERSONALITY_NAMES,
  getAgentPersonalityName,
  releaseAgentPersonalityName,
  shouldUseAgentPersonalityName,
} from '../../tools/AgentTool/constants.js'

describe('shouldUseAgentPersonalityName', () => {
  test('applies to generic and built-in fan-out agents', () => {
    expect(shouldUseAgentPersonalityName('worker')).toBe(true)
    expect(shouldUseAgentPersonalityName('general-purpose')).toBe(true)
    expect(shouldUseAgentPersonalityName(undefined)).toBe(true)
    expect(shouldUseAgentPersonalityName('Explore')).toBe(true)
    expect(shouldUseAgentPersonalityName('Plan')).toBe(true)
  })

  test('does not apply to custom agent types', () => {
    expect(shouldUseAgentPersonalityName('code-reviewer')).toBe(false)
    expect(shouldUseAgentPersonalityName('verification')).toBe(false)
  })
})

describe('assignAgentPersonalityName', () => {
  test('assigns a stable name from the pool and releases it', () => {
    const id = 'agent-explore-1'
    try {
      const name = assignAgentPersonalityName(id)
      expect(AGENT_PERSONALITY_NAMES).toContain(name)
      // Stable for the same agent id.
      expect(assignAgentPersonalityName(id)).toBe(name)
      expect(getAgentPersonalityName(id)).toBe(name)
    } finally {
      releaseAgentPersonalityName(id)
    }
    expect(getAgentPersonalityName(id)).toBeUndefined()
  })

  test('dedupes with a numeric suffix once the pool is exhausted', () => {
    const ids = AGENT_PERSONALITY_NAMES.map((_, i) => `pool-${i}`)
    const overflowId = 'pool-overflow'
    try {
      const used = new Set(ids.map(id => assignAgentPersonalityName(id)))
      // Pool is fully consumed; every assigned name is unique.
      expect(used.size).toBe(AGENT_PERSONALITY_NAMES.length)
      const overflow = assignAgentPersonalityName(overflowId)
      expect(overflow).toMatch(/-\d+$/)
      expect(used.has(overflow)).toBe(false)
    } finally {
      ids.forEach(releaseAgentPersonalityName)
      releaseAgentPersonalityName(overflowId)
    }
  })
})
