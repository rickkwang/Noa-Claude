import { afterAll, expect, test } from 'bun:test'
import type { ToolUseContext } from '../../../Tool.js'
import { getIsInteractive, setIsInteractive } from '../../../bootstrap/state.js'
import { runPostToolUseHooks } from '../../../services/tools/toolHooks.js'
import { getDefaultAppState } from '../../../state/AppStateStore.js'
import { createStore } from '../../../state/store.js'
import { FileReadTool } from '../../../tools/FileReadTool/FileReadTool.js'
import { addSessionHook } from '../../../utils/hooks/sessionHooks.js'
import { runTools } from '../../../services/tools/toolOrchestration.js'
import { createAssistantMessage } from '../../../utils/messages.js'
import { createFileStateCacheWithSizeLimit } from '../../../utils/fileStateCache.js'

const wasInteractive = getIsInteractive()
afterAll(() => setIsInteractive(wasInteractive))

for (const field of ['updatedToolOutput', 'updatedMCPToolOutput']) {
  test.each(['', false, 0, null, 'redacted', undefined])(
    `PostToolUse propagates ${field} replacement %j through the command hook chain`,
    async replacement => {
      setIsInteractive(false)
      const store = createStore(getDefaultAppState())
      const payload = JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          ...(replacement !== undefined && { [field]: replacement }),
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
        if ('updatedToolOutput' in result) updates.push(result.updatedToolOutput)
      }
      expect(updates).toEqual(replacement === undefined ? [] : [replacement])
    },
  )
}

test('canonical output wins over legacy output and serializes a scalar MCP result', async () => {
  const store = createStore(getDefaultAppState())
  addSessionHook(store.setState, 'output-probe', 'PostToolUse', 'mcp__fixture__read', {
    type: 'command',
    command: `echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","updatedToolOutput":false,"updatedMCPToolOutput":"legacy"}}'`,
  })
  const tool = {
    ...FileReadTool, name: 'mcp__fixture__read', isMcp: true,
    validateInput: async () => ({ result: true }),
    call: async () => ({ data: 'original' }),
    mapToolResultToToolResultBlockParam: (content: unknown, id: string) => ({ type: 'tool_result', tool_use_id: id, content }),
  } as unknown as typeof FileReadTool
  const context = {
    agentId: 'output-probe', getAppState: store.getState, setAppState: store.setState,
    options: { tools: [tool], commands: [], mainLoopModel: 'claude-sonnet-4-6', mcpClients: [], mcpResources: {} },
    messages: [], abortController: new AbortController(), readFileState: createFileStateCacheWithSizeLimit(10),
    setInProgressToolUseIDs: () => {}, setResponseLength: () => {},
  } as unknown as ToolUseContext
  const block = { type: 'tool_use' as const, id: 'mcp-read', caller: { type: 'direct' as const }, name: tool.name, input: { file_path: '/tmp/fixture' } }
  const assistant = createAssistantMessage({ content: [block] })
  const results = []
  for await (const update of runTools([block], [assistant], async (_tool, input) => ({ behavior: 'allow', updatedInput: input }), context)) {
    if (update.message?.type === 'user') results.push(update.message)
  }
  expect(JSON.stringify(results)).toContain('"content":"false"')
  expect(JSON.stringify(results)).not.toContain('legacy')
})
