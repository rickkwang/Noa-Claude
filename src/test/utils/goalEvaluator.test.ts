import { describe, expect, test } from 'bun:test'
import { buildGoalEvaluatorContext } from '../../utils/goalEvaluator.js'
import {
  createAssistantMessage,
  createUserMessage,
} from '../../utils/messages.js'

describe('goal evaluator context', () => {
  test('includes native tool results for completion evidence', () => {
    const message = createUserMessage({
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_test',
          content: '<system-reminder>model-facing wrapper</system-reminder>',
        },
      ] as never,
      toolUseResult: {
        stdout: 'bun test\n\n2 pass\n0 fail',
        stderr: '',
      },
    })

    const context = buildGoalEvaluatorContext([message])

    expect(context).toContain('user:')
    expect(context).toContain('tool result:')
    expect(context).toContain('2 pass')
    expect(context).toContain('0 fail')
    expect(context).not.toContain('model-facing wrapper')
  })

  test('truncates on message boundaries, never mid-segment', () => {
    const big = 'x'.repeat(1500)
    const messages = [
      createUserMessage({ content: `oldest ${big}` }),
      createAssistantMessage({ content: `middle ${big}` }),
      createUserMessage({ content: `newer ${big}` }),
      createAssistantMessage({ content: `newest ${big}` }),
    ]

    const context = buildGoalEvaluatorContext(messages)

    expect(context.length).toBeLessThanOrEqual(4000)
    expect(
      context.startsWith('user: ') || context.startsWith('assistant: '),
    ).toBe(true)
    expect(context).toContain('newest')
    expect(context).not.toContain('middle')
    expect(context).not.toContain('oldest')
  })

  test('keeps tail evidence when the latest segment exceeds the context limit', () => {
    const context = buildGoalEvaluatorContext([
      createUserMessage({
        content: 'older completion context',
      }),
      createUserMessage({
        content: 'tool wrapper',
        toolUseResult: {
          stdout: `${'x'.repeat(5000)}\nTests: 120 pass, 0 fail`,
        },
      }),
    ])

    expect(context.length).toBeLessThanOrEqual(4000)
    expect(context.startsWith('user: tool wrapper')).toBe(true)
    expect(context).toContain('[truncated]')
    expect(context).toContain('Tests: 120 pass, 0 fail')
    expect(context).not.toContain('older completion context')
  })

  test('bounds oversized single-line segments', () => {
    const context = buildGoalEvaluatorContext([
      createUserMessage({ content: `${'x'.repeat(5000)}DONE` }),
    ])

    expect(context.length).toBeLessThanOrEqual(4000)
    expect(context).toContain('[truncated]')
    expect(context).toContain('DONE')
  })

  test('keeps tail evidence from an oversized segment before a short latest message', () => {
    const context = buildGoalEvaluatorContext([
      createUserMessage({
        content: 'tool wrapper',
        toolUseResult: {
          stdout: `${'x'.repeat(5000)}\nTypecheck passed`,
        },
      }),
      createAssistantMessage({ content: 'I ran verification.' }),
    ])

    expect(context.length).toBeLessThanOrEqual(4000)
    expect(context).toContain('Typecheck passed')
    expect(context).toContain('assistant: I ran verification.')
  })
})
