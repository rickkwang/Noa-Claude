import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import type { Tool, ToolUseContext } from '../../../Tool.js'
import { validateHookUpdatedInput } from '../../../services/tools/hookUpdatedInput.js'

const schema = z.strictObject({
  command: z.string(),
  timeout: z.number().optional(),
})

const context = {} as ToolUseContext

function makeTool(
  validateInput?: Tool['validateInput'],
): Tool {
  return {
    name: 'FakeTool',
    inputSchema: schema,
    validateInput,
  } as unknown as Tool
}

describe('validateHookUpdatedInput', () => {
  test('accepts and schema-parses a valid rewrite', async () => {
    const result = await validateHookUpdatedInput(
      makeTool(),
      { command: 'ls' },
      { command: 'echo' },
      context,
      'PreToolUse',
    )
    expect(result).toEqual({ ok: true, input: { command: 'ls' } })
  })

  test('drops keys the schema does not know', async () => {
    const result = await validateHookUpdatedInput(
      makeTool(),
      { command: 'ls', extra: true },
      { command: 'echo' },
      context,
      'PreToolUse',
    )
    expect(result).toEqual({ ok: true, input: { command: 'ls' } })
  })

  test('denies a rewrite that fails schema validation', async () => {
    const result = await validateHookUpdatedInput(
      makeTool(),
      { command: 42 },
      { command: 'echo' },
      context,
      'PreToolUse',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('failed schema validation')
    }
  })

  test('denies a newly added __artifact key', async () => {
    const result = await validateHookUpdatedInput(
      makeTool(),
      { command: 'ls', __artifactFile: 'x' },
      { command: 'echo' },
      context,
      'PreToolUse',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('__artifact')
    }
  })

  test('allows a __artifact key sent back unchanged', async () => {
    const result = await validateHookUpdatedInput(
      makeTool(),
      { command: 'ls', __artifactFile: 'x' },
      { command: 'echo', __artifactFile: 'x' },
      context,
      'PreToolUse',
    )
    expect(result).toEqual({ ok: true, input: { command: 'ls' } })
  })

  test('denies when the tool refuses the rewrite', async () => {
    const result = await validateHookUpdatedInput(
      makeTool(async () => ({
        result: false as const,
        message: 'not today',
        errorCode: 1,
      })),
      { command: 'rm -rf /' },
      { command: 'echo' },
      context,
      'PreToolUse',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('the tool refused')
      expect(result.message).toContain('not today')
    }
  })

  test('denies when the tool check throws', async () => {
    const result = await validateHookUpdatedInput(
      makeTool(async () => {
        throw new Error('boom')
      }),
      { command: 'ls' },
      { command: 'echo' },
      context,
      'PreToolUse',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('could not check')
      expect(result.message).toContain('boom')
    }
  })

  test('reruns validateInput on the repaired input', async () => {
    let seen: unknown
    const tool = makeTool(async input => {
      seen = input
      return { result: true as const }
    })
    const result = await validateHookUpdatedInput(
      tool,
      { command: 'ls', extra: true },
      { command: 'echo' },
      context,
      'PreToolUse',
    )
    expect(result.ok).toBe(true)
    expect(seen).toEqual({ command: 'ls' })
  })
})
