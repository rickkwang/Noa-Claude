import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import type { Tool, ToolUseContext } from '../../../Tool.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { checkRuleBasedPermissions } from '../../../utils/permissions/permissions.js'

// Failure modes covered: a throwing checkPermissions must not leave a hook
// 'allow' standing; a sandboxOverride ask must survive a hook 'allow'; a plain
// allow is no objection (null).
function fakeTool(checkPermissions: () => Promise<unknown>): Tool {
  return {
    name: 'FakeTool',
    inputSchema: z.object({}),
    checkPermissions,
  } as unknown as Tool
}

function fakeContext(): ToolUseContext {
  return {
    getAppState: () => ({ toolPermissionContext: getEmptyToolPermissionContext() }),
  } as unknown as ToolUseContext
}

describe('checkRuleBasedPermissions', () => {
  test('denies when the tool permission check throws', async () => {
    const tool = fakeTool(async () => {
      throw new Error('boom')
    })
    const decision = await checkRuleBasedPermissions(tool, {}, fakeContext())
    expect(decision).toEqual({
      behavior: 'deny',
      decisionReason: { type: 'other', reason: 'permission check failed' },
      message: 'FakeTool was not run: its permission check failed.',
    })
  })

  test('keeps a sandboxOverride ask so a hook allow cannot skip it', async () => {
    const ask = {
      behavior: 'ask',
      message: 'Run outside of the sandbox',
      decisionReason: { type: 'sandboxOverride', reason: 'dangerouslyDisableSandbox' },
    }
    const decision = await checkRuleBasedPermissions(fakeTool(async () => ask), {}, fakeContext())
    expect(decision).toBe(ask as never)
  })

  test('reports no objection for a plain allow', async () => {
    const tool = fakeTool(async () => ({ behavior: 'allow', updatedInput: {} }))
    expect(await checkRuleBasedPermissions(tool, {}, fakeContext())).toBeNull()
  })
})
