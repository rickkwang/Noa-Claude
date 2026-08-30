import { afterEach, describe, expect, test } from 'bun:test'
import { AgentTool } from '../../tools/AgentTool/AgentTool.js'
import {
  getActiveAgentsFromList,
} from '../../tools/AgentTool/loadAgentsDir.js'
import { getBuiltInAgents } from '../../tools/AgentTool/builtInAgents.js'

describe('AgentTool.isConcurrencySafe', () => {
  // The shadowing test mutates the module-level active-agent cache; restore
  // it so later tests in the same process see the default list.
  afterEach(() => {
    getActiveAgentsFromList(getBuiltInAgents())
  })
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

  // Background agents detach and keep running after the tool call returns, so
  // two background write agents can still share cwd and conflict. That gap is
  // deliberate (serializing detached tasks at the scheduler is meaningless);
  // this test pins the scheduling behavior, not end-to-end write safety.
  test('worktree isolation and background spawns stay concurrent', () => {
    expect(isSafe({ isolation: 'worktree' })).toBe(true)
    expect(isSafe({ run_in_background: true })).toBe(true)
  })

  test('a custom agent shadowing a built-in name is not concurrency-safe', () => {
    // Minimal agent fixtures: getActiveAgentsFromList only reads source/agentType.
    const builtInExplore = { agentType: 'Explore', source: 'built-in' }
    const customExplore = { agentType: 'Explore', source: 'projectSettings' }

    getActiveAgentsFromList([builtInExplore as never, customExplore as never])
    expect(isSafe({ subagent_type: 'Explore' })).toBe(false)

    getActiveAgentsFromList([builtInExplore as never])
    expect(isSafe({ subagent_type: 'Explore' })).toBe(true)
  })
})
