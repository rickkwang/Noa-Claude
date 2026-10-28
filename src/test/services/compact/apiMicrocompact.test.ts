import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getIdleToolClearingStrategy,
  getAPIContextManagement,
} from '../../../services/compact/apiMicrocompact.js'

const originalEnv = {
  API_MAX_INPUT_TOKENS: process.env.API_MAX_INPUT_TOKENS,
  API_TARGET_INPUT_TOKENS: process.env.API_TARGET_INPUT_TOKENS,
  USER_TYPE: process.env.USER_TYPE,
  USE_API_CLEAR_TOOL_RESULTS: process.env.USE_API_CLEAR_TOOL_RESULTS,
  USE_API_CLEAR_TOOL_USES: process.env.USE_API_CLEAR_TOOL_USES,
  NOA_CLAUDE_IDLE_COMPACTION: process.env.NOA_CLAUDE_IDLE_COMPACTION,
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

describe('getAPIContextManagement', () => {
  afterEach(() => {
    restoreEnv()
  })

  test('falls back to defaults for invalid API token env values', () => {
    process.env.USER_TYPE = 'ant'
    process.env.USE_API_CLEAR_TOOL_RESULTS = '1'
    process.env.API_MAX_INPUT_TOKENS = 'not-a-number'
    process.env.API_TARGET_INPUT_TOKENS = 'also-not-a-number'

    expect(getAPIContextManagement()).toEqual({
      edits: [
        expect.objectContaining({
          trigger: { type: 'input_tokens', value: 180_000 },
          clear_at_least: { type: 'input_tokens', value: 140_000 },
        }),
      ],
    })
  })

  test('keeps clear_at_least positive when target is greater than trigger', () => {
    process.env.USER_TYPE = 'ant'
    process.env.USE_API_CLEAR_TOOL_USES = '1'
    process.env.API_MAX_INPUT_TOKENS = '1000'
    process.env.API_TARGET_INPUT_TOKENS = '2000'

    expect(getAPIContextManagement()).toEqual({
      edits: [
        expect.objectContaining({
          trigger: { type: 'input_tokens', value: 1000 },
          clear_at_least: { type: 'input_tokens', value: 1 },
        }),
      ],
    })
  })
})

describe('idle tool clearing', () => {
  beforeEach(() => {
    process.env.NOA_CLAUDE_IDLE_COMPACTION = '1'
  })
  afterEach(() => {
    restoreEnv()
  })

  const NOW = Date.parse('2026-01-01T12:00:00.000Z')

  function conversation(
    toolUses: number,
    ageMs: number,
    toolName = 'Read',
    body = 'file body '.repeat(100),
  ) {
    const stamp = new Date(NOW - ageMs).toISOString()
    const messages: unknown[] = []
    for (let i = 0; i < toolUses; i++) {
      messages.push({
        type: 'assistant',
        uuid: `a${i}`,
        timestamp: stamp,
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: `t${i}`, name: toolName, input: {} },
          ],
        },
      })
      messages.push({
        type: 'user',
        uuid: `u${i}`,
        timestamp: stamp,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: `t${i}`,
              content: body,
            },
          ],
        },
      })
    }
    return messages as never
  }

  test('clears after the idle gap once enough tool uses have accumulated', () => {
    const strategy = getIdleToolClearingStrategy(
      conversation(40, 66 * 60_000),
      NOW,
    )
    expect(strategy).toEqual(
      expect.objectContaining({
        type: 'clear_tool_uses_20250919',
        trigger: { type: 'tool_uses', value: 37 },
        keep: { type: 'tool_uses', value: 12 },
        clear_at_least: { type: 'input_tokens', value: 20_000 },
      }),
    )
  })

  test('does not clear before the idle gap', () => {
    expect(
      getIdleToolClearingStrategy(conversation(40, 60 * 60_000), NOW),
    ).toBeUndefined()
  })

  test('does not clear without enough tool uses', () => {
    expect(
      getIdleToolClearingStrategy(conversation(20, 66 * 60_000), NOW),
    ).toBeUndefined()
  })

  test('excluding a tool keeps it out of the clear', () => {
    const strategy = getIdleToolClearingStrategy(
      conversation(40, 66 * 60_000, 'Task'),
      NOW,
    )
    // Task results are not clearable, so nothing counts toward the trigger.
    expect(strategy).toBeUndefined()
  })

  test('the setting can turn idle clearing off', () => {
    process.env.NOA_CLAUDE_IDLE_COMPACTION = '0'
    expect(
      getIdleToolClearingStrategy(conversation(40, 66 * 60_000), NOW),
    ).toBeUndefined()
  })

  test('a result that merely mentions the cleared marker is still clearable', () => {
    const strategy = getIdleToolClearingStrategy(
      conversation(40, 66 * 60_000, 'Read', 'quote: [Old tool result content cleared] is the marker'),
      NOW,
    )
    expect(strategy).toBeDefined()
  })

  test('a result already replaced by the marker is not cleared again', () => {
    const strategy = getIdleToolClearingStrategy(
      conversation(40, 66 * 60_000, 'Read', '[Old tool result content cleared]'),
      NOW,
    )
    expect(strategy).toBeUndefined()
  })

  test('an explicit ant tool-clearing opt-in suppresses idle clearing', () => {
    process.env.USER_TYPE = 'ant'
    process.env.USE_API_CLEAR_TOOL_RESULTS = '1'

    const edits =
      getAPIContextManagement({
        messages: conversation(40, 66 * 60_000),
        querySource: 'repl_main_thread',
        now: NOW,
      })?.edits ?? []

    expect(
      edits.filter(edit => edit.type === 'clear_tool_uses_20250919'),
    ).toHaveLength(1)
  })

  test('shadow mode decides but does not send the clear', () => {
    process.env.NOA_CLAUDE_IDLE_COMPACTION = 'shadow'
    const messages = conversation(40, 66 * 60_000)

    expect(
      getIdleToolClearingStrategy(messages, NOW),
    ).toBeDefined()
    const edits =
      getAPIContextManagement({
        messages,
        querySource: 'repl_main_thread',
        now: NOW,
      })?.edits ?? []
    expect(
      edits.some(edit => edit.type === 'clear_tool_uses_20250919'),
    ).toBe(false)
  })

  test('unknown mode continues only after an earlier server clear', () => {
    process.env.NOA_CLAUDE_IDLE_COMPACTION = 'unrecognized'
    const messages = conversation(40, 66 * 60_000)
    expect(
      getIdleToolClearingStrategy(messages, NOW),
    ).toBeUndefined()

    const withApplied = messages as unknown as Array<{
      message: { context_management?: unknown }
    }>
    withApplied[0]!.message.context_management = {
      applied_edits: [
        { type: 'clear_tool_uses_20250919', cleared_tool_uses: 3 },
      ],
    }
    expect(
      getIdleToolClearingStrategy(messages, NOW),
    ).toBeDefined()
  })

  test('an idle gap inside the transcript triggers without a long pause now', () => {
    const messages = conversation(40, 2 * 60 * 60_000) as unknown as Array<{
      type: string
      uuid: string
      timestamp: string
      message: unknown
    }>
    messages.push({
      type: 'assistant',
      uuid: 'fresh',
      timestamp: new Date(NOW - 60_000).toISOString(),
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'fresh reply' }],
      },
    })

    expect(getIdleToolClearingStrategy(messages as never, NOW)).toBeDefined()
  })

  test('is wired into context management for the main thread only', () => {
    const main = getAPIContextManagement({
      messages: conversation(40, 66 * 60_000),
      querySource: 'repl_main_thread',
      now: NOW,
    })
    expect(main?.edits.map(edit => edit.type)).toContain(
      'clear_tool_uses_20250919',
    )

    const subagent = getAPIContextManagement({
      messages: conversation(40, 66 * 60_000),
      querySource: 'repl_main_thread',
      isSubagent: true,
      now: NOW,
    })
    expect(subagent?.edits ?? []).toEqual([])
  })
})
