import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { expect, test } from 'bun:test'
import type { ToolUseContext } from '../../Tool.js'
import { query } from '../../query.js'
import type { QueryDeps } from '../../query/deps.js'
import { FileEditTool } from '../../tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from '../../tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from '../../tools/FileWriteTool/FileWriteTool.js'
import { NotebookEditTool } from '../../tools/NotebookEditTool/NotebookEditTool.js'
import { createFileStateCacheWithSizeLimit } from '../../utils/fileStateCache.js'
import {
  createAssistantMessage,
  createUserMessage,
} from '../../utils/messages.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'

const tools = [FileReadTool, FileWriteTool, FileEditTool, NotebookEditTool]

function createContext(): ToolUseContext {
  const appState = {
    toolPermissionContext: {
      mode: 'default',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
    },
    agentDefinitions: { activeAgents: [], allAgents: [], allowedAgentTypes: [] },
    sessionHooks: new Map(),
    mcp: { tools: [], clients: [] },
    fastMode: false,
  }
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'test-model',
      tools,
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: { activeAgents: [], allAgents: [], allowedAgentTypes: [] },
    },
    abortController: new AbortController(),
    readFileState: createFileStateCacheWithSizeLimit(10),
    getAppState: () => appState as unknown as ReturnType<ToolUseContext['getAppState']>,
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as unknown as ToolUseContext
}

test('a NUL byte in a file tool path fails only that call, not the turn', async () => {
  const bad = '/tmp/a\0b'
  const toolUses = [
    { type: 'tool_use', id: 'toolu_read', name: FileReadTool.name, input: { file_path: bad } },
    { type: 'tool_use', id: 'toolu_write', name: FileWriteTool.name, input: { file_path: bad, content: 'x' } },
    { type: 'tool_use', id: 'toolu_edit', name: FileEditTool.name, input: { file_path: bad, old_string: 'a', new_string: 'b' } },
    { type: 'tool_use', id: 'toolu_nb', name: NotebookEditTool.name, input: { notebook_path: `${bad}.ipynb`, new_source: 'x' } },
  ] as ToolUseBlock[]
  let callCount = 0
  let uuidCounter = 0
  const deps = {
    uuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
    microcompact: async messages => ({ messages }),
    autocompact: async () => ({ wasCompacted: false }),
    callModel: async function* () {
      callCount += 1
      yield createAssistantMessage({
        content: callCount === 1 ? toolUses : 'done',
      })
    },
  } as Partial<QueryDeps>

  const results = new Map<string, { content: unknown; is_error?: boolean }>()
  for await (const message of query({
    messages: [createUserMessage({ content: 'start' })],
    systemPrompt: asSystemPrompt([]),
    userContext: {},
    systemContext: {},
    canUseTool: async (_tool, input) => ({ behavior: 'allow', updatedInput: input }),
    toolUseContext: createContext(),
    querySource: 'repl_main_thread',
    deps,
  })) {
    if (message.type === 'assistant') {
      expect((message as { isApiErrorMessage?: boolean }).isApiErrorMessage).not.toBe(true)
    }
    if (message.type === 'user' && Array.isArray(message.message?.content)) {
      for (const block of message.message!.content) {
        if (block.type === 'tool_result') results.set(block.tool_use_id, block)
      }
    }
  }

  expect(callCount).toBe(2)
  for (const { id } of toolUses) {
    const result = results.get(id)
    expect(result?.is_error).toBe(true)
    expect(JSON.stringify(result?.content)).toMatch(/null byte/i)
  }
}, 10000)
