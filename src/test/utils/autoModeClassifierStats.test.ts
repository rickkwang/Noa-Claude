import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getAutoModeClassifierStats,
  recordAutoModeClassifierCall as recordCall,
  resetAutoModeClassifierStats,
} from '../../bootstrap/state.js'
import { formatAutoModeClassifierUsage } from '../../cost-tracker.js'
import type { Tools } from '../../Tool.js'
import { classifyYoloAction } from '../../utils/permissions/yoloClassifier.js'

const originalUserType = process.env.USER_TYPE
const originalApiKey = process.env.ANTHROPIC_API_KEY

beforeEach(() => {
  process.env.USER_TYPE = 'external'
  process.env.ANTHROPIC_API_KEY = 'test-key'
  resetAutoModeClassifierStats()
})

afterEach(() => {
  if (originalUserType === undefined) delete process.env.USER_TYPE
  else process.env.USER_TYPE = originalUserType
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalApiKey
  resetAutoModeClassifierStats()
})

const BASH: Tools = [
  {
    name: 'Bash',
    toAutoClassifierInput: (input: { command: string }) => input.command,
  },
] as unknown as Tools

/** A tool that opts out of classification entirely. */
const SILENT: Tools = [
  { name: 'Silent', toAutoClassifierInput: () => '' },
] as unknown as Tools

function action(name: string, input: unknown) {
  return {
    role: 'assistant' as const,
    content: [{ type: 'tool_use' as const, name, input, id: 'toolu_1' }],
  }
}

const CONTEXT = { mode: 'auto', alwaysDenyRules: {} } as never

describe('session classifier stats', () => {
  test('start empty and render nothing', () => {
    expect(getAutoModeClassifierStats().calls).toBe(0)
    expect(formatAutoModeClassifierUsage()).toBe('')
  })

  test('a tool with no classifier-relevant input is not counted as a call', async () => {
    const result = await classifyYoloAction(
      [],
      action('Silent', {}),
      SILENT,
      CONTEXT,
      new AbortController().signal,
    )
    expect(result.shouldBlock).toBe(false)
    expect(getAutoModeClassifierStats().calls).toBe(0)
  })
})

describe('formatAutoModeClassifierUsage', () => {
  test('reports outcomes, escalation share, re-samples and tokens', () => {
    // Two calls: one allowed at stage 1, one escalated and blocked.
    recordCall({
      calls: 1,
      resolvedAtStage1: 1,
      allowed: 1,
      inputTokens: 1000,
      outputTokens: 5,
      durationMs: 400,
    })
    recordCall({
      calls: 1,
      escalatedToStage2: 1,
      blocked: 1,
      resamples: 2,
      inputTokens: 3000,
      outputTokens: 120,
      durationMs: 2600,
    })

    const out = formatAutoModeClassifierUsage()
    expect(out).toContain('2 calls')
    expect(out).toContain('1 allowed, 1 blocked')
    expect(out).toContain('stage 2 escalation:  1/2 (50%)')
    expect(out).toContain('re-samples:          2')
    expect(out).toContain('4000 in, 125 out')
  })

  test('omits outcome categories that never happened', () => {
    recordCall({ calls: 1, resolvedAtStage1: 1, allowed: 1 })
    const out = formatAutoModeClassifierUsage()
    expect(out).not.toContain('refused')
    expect(out).not.toContain('unavailable')
    expect(out).not.toContain('unparseable')
    expect(out).not.toContain('transcript too long')
  })

  test('names the failure categories when they do happen', () => {
    recordCall({ calls: 1, unavailable: 1 })
    recordCall({ calls: 1, refused: 1 })
    recordCall({ calls: 1, transcriptTooLong: 1 })
    recordCall({ calls: 1, parseFailures: 1, blocked: 1 })
    const out = formatAutoModeClassifierUsage()
    expect(out).toContain('1 refused')
    expect(out).toContain('1 unavailable')
    expect(out).toContain('1 transcript too long')
    expect(out).toContain('1 unparseable')
  })

  test('does not divide by zero when no call reached a stage', () => {
    recordCall({ calls: 1, unavailable: 1 })
    expect(formatAutoModeClassifierUsage()).toContain(
      'stage 2 escalation:  0/0 (0%)',
    )
  })

  test('uses the singular for a single call', () => {
    recordCall({ calls: 1, resolvedAtStage1: 1, allowed: 1 })
    expect(formatAutoModeClassifierUsage()).toContain('1 call,')
  })
})
