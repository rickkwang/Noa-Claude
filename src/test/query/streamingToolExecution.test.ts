import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { ToolUseContext } from '../../Tool.js'
import { query } from '../../query.js'
import type { QueryDeps } from '../../query/deps.js'
import {
  createAssistantMessage,
  createUserMessage,
} from '../../utils/messages.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'

const STREAMING_ENV = 'NOA_CLAUDE_STREAMING_TOOL_EXECUTION'
const originalStreamingEnv = process.env[STREAMING_ENV]

afterEach(() => {
  if (originalStreamingEnv === undefined) {
    delete process.env[STREAMING_ENV]
  } else {
    process.env[STREAMING_ENV] = originalStreamingEnv
  }
})

const inputSchema = z.object({})

function createContext(tools: ToolUseContext['options']['tools']) {
  const appState = {
    toolPermissionContext: { mode: 'default' },
    agentDefinitions: { activeAgents: [], allAgents: [], allowedAgentTypes: [] },
    sessionHooks: new Map(),
    mcp: { tools: [], clients: [] },
    fastMode: false,
    effortValue: undefined,
    advisorModel: undefined,
    goal: undefined,
  }
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'model-before-tool-context',
      tools,
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: { activeAgents: [], allAgents: [], allowedAgentTypes: [] },
    },
    abortController: new AbortController(),
    readFileState: {} as ToolUseContext['readFileState'],
    getAppState: () => appState as unknown as ReturnType<ToolUseContext['getAppState']>,
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as ToolUseContext
}

describe('query streaming tool execution', () => {
  test('preserves context modifiers from tools completed before streaming ends', async () => {
    process.env[STREAMING_ENV] = '1'

    let resolveModifierApplied: () => void
    const modifierApplied = new Promise<void>(resolve => {
      resolveModifierApplied = resolve
    })

    const tool = {
      name: 'StreamingContextTool',
      inputSchema,
      async call() {
        return {
          data: { output: 'ok' },
          contextModifier: (context: ToolUseContext): ToolUseContext => {
            resolveModifierApplied()
            return {
              ...context,
              options: {
                ...context.options,
                mainLoopModel: 'model-after-tool-context',
              },
            }
          },
        }
      },
      async description() {
        return 'streaming context tool'
      },
      isConcurrencySafe() {
        return true
      },
      isReadOnly() {
        return true
      },
      isEnabled() {
        return true
      },
      async checkPermissions() {
        return { behavior: 'allow' }
      },
      async prompt() {
        return ''
      },
      userFacingName() {
        return 'StreamingContextTool'
      },
      toAutoClassifierInput() {
        return ''
      },
      mapToolResultToToolResultBlockParam(
        content: { output: string },
        toolUseID: string,
      ) {
        return {
          type: 'tool_result',
          tool_use_id: toolUseID,
          content: content.output,
        }
      },
      renderToolUseMessage() {
        return null
      },
      maxResultSizeChars: 1000,
    } as never

    const toolUse = {
      type: 'tool_use',
      id: 'toolu_streaming_context',
      name: 'StreamingContextTool',
      input: {},
    } as ToolUseBlock
    const observedModels: string[] = []
    let callCount = 0
    let uuidCounter = 0
    const deps = {
      uuid: () =>
        `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
      microcompact: async messages => ({ messages }),
      autocompact: async () => ({ wasCompacted: false }),
      callModel: async function* ({ options }) {
        observedModels.push(options.model)
        callCount += 1
        if (callCount === 1) {
          yield createAssistantMessage({ content: [toolUse] })
          await modifierApplied
          yield createAssistantMessage({ content: 'stream tail' })
          return
        }
        yield createAssistantMessage({ content: 'done' })
      },
    } as Partial<QueryDeps>

    for await (const _ of query({
      messages: [createUserMessage({ content: 'start' })],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext: createContext([tool]),
      querySource: 'repl_main_thread',
      deps,
    })) {
      // Drain the query generator.
    }

    expect(observedModels).toEqual([
      'model-before-tool-context',
      'model-after-tool-context',
    ])
  }, 5000)
})
