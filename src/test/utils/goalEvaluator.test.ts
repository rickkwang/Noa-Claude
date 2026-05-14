import { describe, expect, test } from 'bun:test'
import { buildGoalEvaluatorContext } from '../../utils/goalEvaluator.js'
import { createUserMessage } from '../../utils/messages.js'

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
})
