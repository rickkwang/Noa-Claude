import { afterAll, expect, test } from 'bun:test'
import type { ToolUseContext } from '../../../Tool.js'
import { getIsInteractive, setIsInteractive } from '../../../bootstrap/state.js'
import { runPostToolUseHooks } from '../../../services/tools/toolHooks.js'
import { getDefaultAppState } from '../../../state/AppStateStore.js'
import { createStore } from '../../../state/store.js'
import { FileReadTool } from '../../../tools/FileReadTool/FileReadTool.js'
import { addSessionHook } from '../../../utils/hooks/sessionHooks.js'

const wasInteractive = getIsInteractive()
afterAll(() => setIsInteractive(wasInteractive))

test.each(['', false, 0, null, 'redacted', undefined])(
  'PostToolUse propagates replacement %j through the command hook chain',
  async replacement => {
    setIsInteractive(false)
    const store = createStore(getDefaultAppState())
    const payload = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        ...(replacement !== undefined && { updatedMCPToolOutput: replacement }),
      },
    })
    addSessionHook(store.setState, 'output-probe', 'PostToolUse', 'Read', {
      type: 'command',
      command: `printf '%s' '${payload}'`,
    })
    const context = {
      agentId: 'output-probe',
      getAppState: store.getState,
      setAppState: store.setState,
      options: { tools: [] },
      messages: [],
      abortController: new AbortController(),
    } as unknown as ToolUseContext
    const updates: unknown[] = []
    for await (const result of runPostToolUseHooks(
      context, FileReadTool, 'read-probe', 'message-probe', {},
      'original' as never, undefined, undefined, undefined,
    )) {
      if ('updatedMCPToolOutput' in result) updates.push(result.updatedMCPToolOutput)
    }
    expect(updates).toEqual(replacement === undefined ? [] : [replacement])
  },
)
