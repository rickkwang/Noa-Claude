import { describe, expect, test } from 'bun:test'
import { AgentTool } from '../../tools/AgentTool/AgentTool.js'

describe('AgentTool.isConcurrencySafe', () => {
  const base = { description: 'test agent', prompt: 'do a thing' }
  const isSafe = (extra: Record<string, unknown>) =>
    AgentTool.isConcurrencySafe({ ...base, ...extra } as never)

  test('read-only built-in agents run concurrently', () => {
    expect(isSafe({ subagent_type: 'Explore' })).toBe(true)
    expect(isSafe({ subagent_type: 'Plan' })).toBe(true)
  })

  test('write-capable agents serialize (default general-purpose, custom, unknown)', () => {
    expect(isSafe({})).toBe(false)
    expect(isSafe({ subagent_type: 'general-purpose' })).toBe(false)
    expect(isSafe({ subagent_type: 'my-custom-agent' })).toBe(false)
  })

  test('worktree isolation and background spawns stay concurrent', () => {
    expect(isSafe({ isolation: 'worktree' })).toBe(true)
    expect(isSafe({ run_in_background: true })).toBe(true)
  })
})
