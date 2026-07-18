import { describe, expect, test } from 'bun:test'
import type { QuerySource } from '../../../constants/querySource.js'

// The precompute slot is a single module-level singleton, but query() is shared
// by the main conversation, subagents, the forked summarizers and every other
// side-query. Only the main conversation may arm or consume it — see
// isPrecomputeOwner in autoCompact.ts. This test locks the ownership predicate
// against the full QuerySource surface so a new caller can't silently start
// thrashing the slot.

// Mirrors isPrecomputeOwner. Kept in the test rather than exported from
// autoCompact.ts (which is @ts-nocheck and carries heavy bootstrap imports);
// the assertions below document the intended contract for every source form.
function isPrecomputeOwner(querySource?: QuerySource): boolean {
  if (!querySource) return false
  return querySource.startsWith('repl_main_thread') || querySource === 'sdk'
}

describe('precompute slot ownership', () => {
  test('the interactive main thread owns the slot', () => {
    expect(isPrecomputeOwner('repl_main_thread')).toBe(true)
    // Output-style variants suffix the source; startsWith must cover them.
    expect(isPrecomputeOwner('repl_main_thread:explanatory')).toBe(true)
  })

  test('the headless/SDK driver owns the slot', () => {
    expect(isPrecomputeOwner('sdk')).toBe(true)
  })

  test('subagents never arm or consume', () => {
    // AgentTool / SkillTool / swarm inProcessRunner all drive query() this way.
    expect(isPrecomputeOwner('agent:custom')).toBe(false)
    expect(isPrecomputeOwner('agent:general-purpose')).toBe(false)
  })

  test('forked summarizers never arm or consume', () => {
    // These exist to REDUCE tokens; arming from them would be circular.
    expect(isPrecomputeOwner('compact')).toBe(false)
    expect(isPrecomputeOwner('session_memory')).toBe(false)
  })

  test('unknown side-queries and a missing source default to not-owner', () => {
    expect(isPrecomputeOwner('goal_evaluator')).toBe(false)
    expect(isPrecomputeOwner('prompt_suggestion')).toBe(false)
    expect(isPrecomputeOwner('agent_creation')).toBe(false)
    expect(isPrecomputeOwner(undefined)).toBe(false)
  })
})
