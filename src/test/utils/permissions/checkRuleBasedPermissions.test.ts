import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import type { Tool, ToolUseContext } from '../../../Tool.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { checkRuleBasedPermissions } from '../../../utils/permissions/permissions.js'

// A throwing checkPermissions must not leave a hook 'allow' standing. The
// sandboxOverride hook path is covered by scripts/e2e-sandbox-override.ts.
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
})
