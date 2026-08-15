// @ts-nocheck
import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { RemoteTriggerTool } from '../../tools/RemoteTriggerTool/RemoteTriggerTool.js'

// feature('AUTO_MODE') is a bundler macro (see build.ts) and resolves false
// under `bun test` — same constraint documented in autoModeSystemPrompt.test.ts.
// So the mode==='auto' branch below can't be driven true through the public
// checkPermissions() entrypoint here; only the non-auto path is exercisable.
// The auto-mode branch was verified by direct code read against upstream
// Claude Code 2.1.233 (RemoteTrigger's checkPermissions), not by this test.
function makeContext(mode) {
  return {
    getAppState: () => ({
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        mode,
      },
    }),
  }
}

describe('RemoteTriggerTool.checkPermissions', () => {
  test('non-auto modes allow unconditionally (unchanged prior behavior)', async () => {
    for (const mode of ['default', 'plan', 'bypassPermissions', 'acceptEdits']) {
      const input = { action: 'create', body: { name: 'x' } }
      const result = await RemoteTriggerTool.checkPermissions(
        input,
        makeContext(mode),
      )
      expect(result).toEqual({ behavior: 'allow', updatedInput: input })
    }
  })

  test('does not throw when appState/getAppState is well-formed for a read action', async () => {
    const input = { action: 'list' }
    const result = await RemoteTriggerTool.checkPermissions(
      input,
      makeContext('default'),
    )
    expect(result.behavior).toBe('allow')
  })
})
