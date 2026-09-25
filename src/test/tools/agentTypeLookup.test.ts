import { describe, expect, test } from 'bun:test'
// AgentTool.tsx must evaluate before agentToolUtils (circular dependency; see
// agentAsyncLifecycle.test.ts).
import { AgentTool } from '../../tools/AgentTool/AgentTool.js'
import { findAgentsByType } from '../../tools/AgentTool/agentToolUtils.js'

const agents = [
  { agentType: 'general-purpose' },
  { agentType: 'Explore' },
  { agentType: 'code-reviewer' },
]

describe('findAgentsByType', () => {
  test('exact name wins', () => {
    expect(findAgentsByType(agents, 'Explore')).toEqual([{ agentType: 'Explore' }])
  })

  test('case and separator variants resolve to the intended agent', () => {
    for (const requested of ['explore', 'general_purpose', 'General Purpose', 'codereviewer']) {
      expect(findAgentsByType(agents, requested)).toHaveLength(1)
    }
    expect(findAgentsByType(agents, 'general_purpose')[0]!.agentType).toBe('general-purpose')
  })

  test('an exact match is not shadowed by a normalized collision', () => {
    const pair = [{ agentType: 'code-reviewer' }, { agentType: 'code_reviewer' }]
    expect(findAgentsByType(pair, 'code_reviewer')).toEqual([{ agentType: 'code_reviewer' }])
    expect(findAgentsByType(pair, 'Code Reviewer')).toHaveLength(2)
  })

  test('an unrelated name matches nothing', () => {
    expect(findAgentsByType(agents, 'planner')).toEqual([])
  })
})

describe('async launch result', () => {
  test('warns against reading the transcript-backed output file', () => {
    const block = AgentTool.mapToolResultToToolResultBlockParam(
      {
        status: 'async_launched',
        agentId: 'a1',
        description: 'd',
        prompt: 'p',
        outputFile: '/tmp/a1.output',
        canReadOutputFile: true,
      },
      'tu1',
    )
    const text = JSON.stringify(block.content)
    expect(text).toContain('Do NOT')
    expect(text).toContain('JSONL transcript')
    expect(text).toContain('do not report, assume, or predict them')
    expect(text).not.toContain('check progress before completion')
  })
})
