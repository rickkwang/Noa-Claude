import { describe, expect, test } from 'bun:test'
import {
  buildGoalEvaluatorContext,
  enforceGoalVerifyResult,
  formatVerifyResultForEvaluator,
  runGoalVerifyCommand,
} from '../../utils/goalEvaluator.js'
import { createThreadGoal } from '../../utils/goalState.js'
import {
  createAssistantMessage,
  createUserMessage,
} from '../../utils/messages.js'

describe('goal evaluator context', () => {
  test('keeps MCP failure status and text as completion evidence', () => {
    const context = buildGoalEvaluatorContext([createUserMessage({
      content: [{ type: 'tool_result', tool_use_id: 'mcp_failure', is_error: true,
        content: [{ type: 'text', text: 'Deployment failed: HTTP 500' }] }] as never,
      toolUseResult: { content: [{ type: 'text', text: 'Deployment failed: HTTP 500' }], isError: true },
    })])
    expect(context).toContain('mcp_failure')
    expect(context).toContain('is_error=true')
    expect(context).toContain('Deployment failed: HTTP 500')
  })

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

  test('formats a passing verify result with exit code and output tail', () => {
    const text = formatVerifyResultForEvaluator('bun run typecheck', {
      code: 0,
      stdout: 'all good',
      stderr: '',
    })
    expect(text).toContain('bun run typecheck')
    expect(text).toContain('exit code: 0')
    expect(text).toContain('all good')
  })

  test('formats a failing verify result and keeps the output tail bounded', () => {
    const text = formatVerifyResultForEvaluator('bun test', {
      code: 1,
      stdout: `${'x'.repeat(5000)}\n\u001b[31m3 fail\u001b[0m`,
      stderr: 'boom\u0000detail',
    })
    expect(text).toContain('exit code: 1')
    expect(text).toContain('3 fail')
    expect(text).toContain('boom detail')
    expect(text).not.toContain('boomdetail')
    expect(text).not.toContain('\u001b')
    expect(text).not.toContain('\u0000')
    expect(text.length).toBeLessThanOrEqual(2500)
  })

  test('forces a failing verify result to keep the goal incomplete', () => {
    expect(
      enforceGoalVerifyResult(
        { achieved: false, reason: 'Typecheck still fails in goalState.ts.' },
        { code: 1, stdout: '', stderr: 'tests failed' },
      ),
    ).toEqual({
      achieved: false,
      reason:
        'Verify command failed with exit code 1. Typecheck still fails in goalState.ts.',
    })
  })

  test('does not forward raw verify output when overriding an incorrect pass', () => {
    const result = enforceGoalVerifyResult(
      { achieved: true, reason: 'Conversation appears complete.' },
      {
        code: 2,
        stdout: 'raw diagnostic',
        stderr: 'secret detail',
      },
    )

    expect(result).toEqual({
      achieved: false,
      reason: 'Verify command failed with exit code 2.',
    })
  })

  test('preserves evaluator decisions after a passing verify result', () => {
    expect(
      enforceGoalVerifyResult(
        { achieved: true, reason: 'All requirements are complete.' },
        { code: 0, stdout: 'ok', stderr: '' },
      ),
    ).toEqual({
      achieved: true,
      reason: 'All requirements are complete.',
    })
  })

  test('runs a verify command with an abort signal', async () => {
    const executable = JSON.stringify(process.execPath)
    const goal = createThreadGoal({
      objective: 'Run verification',
      tokenBudget: null,
      verifyCommand: `${executable} -e "process.stdout.write('verify-ok')"`,
      now: 1,
    })

    const result = await runGoalVerifyCommand({
      goal,
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({ code: 0, stdout: 'verify-ok' })
  })

  test('preserves the execution error when a verify command fails silently', async () => {
    const goal = createThreadGoal({
      objective: 'Run verification',
      tokenBudget: null,
      verifyCommand: 'exit 9',
      now: 1,
    })

    const result = await runGoalVerifyCommand({
      goal,
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({ code: 9, stdout: '' })
    expect(result?.stderr).toContain('exit code 9')
  })

  test('keeps the newest API rounds and marks the omitted prefix', () => {
    const big = 'x'.repeat(1500)
    const context = buildGoalEvaluatorContext([
      createUserMessage({ content: `oldest ${big}` }),
      createAssistantMessage({ content: `middle ${big}` }),
      createUserMessage({ content: `newer ${big}` }),
      createAssistantMessage({ content: `newest ${big}` }),
    ], 4000)
    expect(context.startsWith('[Earlier conversation truncated')).toBe(true)
    expect(context).toContain('newest')
    expect(context).not.toContain('middle')
    expect(context).not.toContain('oldest')
  })

  test('keeps failure status, head and tail when the newest round overflows', () => {
    const context = buildGoalEvaluatorContext([
      createAssistantMessage({ content: 'older context' }),
      createAssistantMessage({ content: 'Running the build' }),
      createUserMessage({
        content: [{ type: 'tool_result', tool_use_id: 'build_failure', is_error: true, content: 'error' }] as never,
        toolUseResult: 'Error: build failed with exit code 1\n' + 'x'.repeat(5000) + '\nDone processing',
      }),
    ], 2000)
    expect(context).toContain('is_error=true id=build_failure')
    expect(context).toContain('build failed with exit code 1')
    expect(context).toContain('Done processing')
    expect(context).not.toContain('older context')
  })
})
