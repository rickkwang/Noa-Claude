import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { ToolUseContext } from '../../../Tool.js'
import { StreamingToolExecutor } from '../../../services/tools/StreamingToolExecutor.js'
import {
  buildSameTurnToolUses,
  type PrecedingToolUse,
  resolvePrecedingToolUses,
  runTools,
} from '../../../services/tools/toolOrchestration.js'
import type { AssistantMessage } from '../../../types/message.js'
import { createAssistantMessage } from '../../../utils/messages.js'

function block(id: string, name = 'Read'): ToolUseBlock {
  return {
    type: 'tool_use',
    id,
    name,
    input: { file_path: `/${id}.ts` },
    caller: { type: 'direct' },
  }
}

function assistantMessage(
  id: string,
  blocks: ToolUseBlock[],
): AssistantMessage {
  return {
    type: 'assistant',
    uuid: `uuid-${id}`,
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      content: blocks,
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  } as unknown as AssistantMessage
}

/** Pair each block with the message it came from, as the callers do. */
function pairs(
  message: AssistantMessage,
  ...blocks: ToolUseBlock[]
): PrecedingToolUse[] {
  return blocks.map(block => ({ block, assistantMessage: message }))
}

describe('buildSameTurnToolUses', () => {
  test('returns undefined when nothing precedes the current call', () => {
    expect(buildSameTurnToolUses([])).toBeUndefined()
  })

  test('rebuilds preceding blocks as an assistant message', () => {
    const a = block('toolu_1')
    const b = block('toolu_2')
    const c = block('toolu_3')
    const msg = assistantMessage('msg_1', [a, b, c])

    // Simulates the third call in a parallel batch: the two before it.
    const result = buildSameTurnToolUses(pairs(msg, a, b))

    expect(result).toHaveLength(1)
    expect(result?.[0]?.message?.content).toEqual([a, b])
    // The source message is copied, not mutated — the real conversation
    // still holds all three blocks.
    expect(msg.message?.content).toEqual([a, b, c])
  })

  test('preserves the model emission order so prefixes nest', () => {
    const a = block('toolu_1')
    const b = block('toolu_2')
    const msg = assistantMessage('msg_1', [a, b])

    const forSecond = buildSameTurnToolUses(pairs(msg, a))
    const forThird = buildSameTurnToolUses(pairs(msg, a, b))

    // Each call's context must extend the previous one's, or the shared
    // prefix stops matching and the cache misses.
    expect(forSecond?.[0]?.message?.content).toEqual([a])
    expect(forThird?.[0]?.message?.content).toEqual([a, b])
  })

  test('groups blocks by their source message, keeping message order', () => {
    const a = block('toolu_1')
    const b = block('toolu_2')
    const c = block('toolu_3')
    const first = assistantMessage('msg_1', [a, b])
    const second = assistantMessage('msg_2', [c])

    const result = buildSameTurnToolUses([
      ...pairs(first, a, b),
      ...pairs(second, c),
    ])

    expect(result).toHaveLength(2)
    expect(result?.[0]?.message?.id).toBe('msg_1')
    expect(result?.[0]?.message?.content).toEqual([a, b])
    expect(result?.[1]?.message?.id).toBe('msg_2')
    expect(result?.[1]?.message?.content).toEqual([c])
  })

})

// runTools tracks blocks and messages separately, so it has to resolve the
// pairing that StreamingToolExecutor already carries per tracked tool.
describe('resolvePrecedingToolUses', () => {
  test('pairs each block with the message that emitted it', () => {
    const a = block('toolu_1')
    const b = block('toolu_2')
    const first = assistantMessage('msg_1', [a])
    const second = assistantMessage('msg_2', [b])

    expect(resolvePrecedingToolUses([a, b], [first, second])).toEqual([
      { block: a, assistantMessage: first },
      { block: b, assistantMessage: second },
    ])
  })

  test('drops blocks with no matching source message', () => {
    const known = block('toolu_1')
    const orphan = block('toolu_orphan')
    const msg = assistantMessage('msg_1', [known])

    const result = buildSameTurnToolUses(
      resolvePrecedingToolUses([known, orphan], [msg]),
    )

    expect(result).toHaveLength(1)
    expect(result?.[0]?.message?.content).toEqual([known])
  })

  test('yields nothing when no block resolves to a message', () => {
    const orphan = block('toolu_orphan')
    expect(resolvePrecedingToolUses([orphan], [])).toEqual([])
    expect(
      buildSameTurnToolUses(resolvePrecedingToolUses([orphan], [])),
    ).toBeUndefined()
  })
})

// runTools is the default path in this fork (the streamingToolExecution gate
// resolves to false without NOA_CLAUDE_STREAMING_TOOL_EXECUTION=1), but
// upstream implements sibling context on the executor — so both need coverage.
describe('StreamingToolExecutor.buildSameTurnToolUses', () => {
  function executorWithTools(
    tracked: Array<{ block: ToolUseBlock; assistantMessage: AssistantMessage }>,
  ) {
    const executor = new StreamingToolExecutor(
      [],
      (() => {}) as never,
      {
        abortController: new AbortController(),
      } as never,
    )
    ;(executor as never as { tools: unknown[] }).tools = tracked.map(t => ({
      id: t.block.id,
      block: t.block,
      assistantMessage: t.assistantMessage,
      status: 'queued',
      isConcurrencySafe: true,
      pendingProgress: [],
    }))
    return executor as never as {
      tools: Array<{ block: ToolUseBlock; assistantMessage: AssistantMessage }>
      buildSameTurnToolUses: (tool: unknown) => AssistantMessage[] | undefined
    }
  }

  test('returns undefined for the first tool of the turn', () => {
    const a = block('toolu_1')
    const msg = assistantMessage('msg_1', [a])
    const executor = executorWithTools([{ block: a, assistantMessage: msg }])

    expect(
      executor.buildSameTurnToolUses(executor.tools[0]),
    ).toBeUndefined()
  })

  test('collects every tool received before the current one', () => {
    const a = block('toolu_1')
    const b = block('toolu_2')
    const c = block('toolu_3')
    const msg = assistantMessage('msg_1', [a, b, c])
    const executor = executorWithTools([
      { block: a, assistantMessage: msg },
      { block: b, assistantMessage: msg },
      { block: c, assistantMessage: msg },
    ])

    const forThird = executor.buildSameTurnToolUses(executor.tools[2])

    expect(forThird).toHaveLength(1)
    expect(forThird?.[0]?.message?.content).toEqual([a, b])
  })

  test('stops at the current tool rather than including later ones', () => {
    const a = block('toolu_1')
    const b = block('toolu_2')
    const c = block('toolu_3')
    const msg = assistantMessage('msg_1', [a, b, c])
    const executor = executorWithTools([
      { block: a, assistantMessage: msg },
      { block: b, assistantMessage: msg },
      { block: c, assistantMessage: msg },
    ])

    const forSecond = executor.buildSameTurnToolUses(executor.tools[1])

    expect(forSecond?.[0]?.message?.content).toEqual([a])
  })

  test('groups across assistant messages in arrival order', () => {
    const a = block('toolu_1')
    const b = block('toolu_2')
    const c = block('toolu_3')
    const first = assistantMessage('msg_1', [a, b])
    const second = assistantMessage('msg_2', [c])
    const executor = executorWithTools([
      { block: a, assistantMessage: first },
      { block: b, assistantMessage: first },
      { block: c, assistantMessage: second },
    ])

    // A fourth tool would see all three, grouped by source message.
    const extra = block('toolu_4')
    executor.tools.push({
      block: extra,
      assistantMessage: second,
    } as never)
    const result = executor.buildSameTurnToolUses(executor.tools[3])

    expect(result).toHaveLength(2)
    expect(result?.[0]?.message?.id).toBe('msg_1')
    expect(result?.[0]?.message?.content).toEqual([a, b])
    expect(result?.[1]?.message?.id).toBe('msg_2')
    expect(result?.[1]?.message?.content).toEqual([c])
  })
})

// Regression coverage for runToolsSerially: non-concurrency-safe tools (e.g.
// two writing Bash calls in one turn) go through the serial path, which is
// the one code path that must call resolvePrecedingToolUses before
// buildSameTurnToolUses instead of passing raw blocks straight through.
describe('runTools (serial path) wires sameTurnToolUses end to end', () => {
  const writeInputSchema = z.object({ command: z.string() })

  function createContext(tools: unknown[]): ToolUseContext {
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
      readFileState: {} as ToolUseContext['readFileState'],
      getAppState: () =>
        ({
          toolPermissionContext: { mode: 'default' },
          agentDefinitions: { activeAgents: [], allAgents: [], allowedAgentTypes: [] },
          sessionHooks: new Map(),
        }) as unknown as ReturnType<ToolUseContext['getAppState']>,
      setAppState: () => {},
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
      messages: [],
    } as unknown as ToolUseContext
  }

  function createWriteTool() {
    return {
      name: 'Bash',
      inputSchema: writeInputSchema,
      async call() {
        return { data: { output: 'ok' } }
      },
      async description() {
        return 'fake write tool'
      },
      isConcurrencySafe() {
        return false
      },
      isReadOnly() {
        return false
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
        return 'Bash'
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
  }

  test('the second serial call sees the first as sameTurnToolUses, without falling back to undefined', async () => {
    const first = { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo a' } } as ToolUseBlock
    const second = { type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'echo b' } } as ToolUseBlock
    const assistant = createAssistantMessage({ content: [first, second] }) as AssistantMessage

    const tool = createWriteTool()
    const context = createContext([tool])
    const seenSameTurnToolUses: Array<AssistantMessage[] | undefined> = []

    for await (const _update of runTools(
      [first, second],
      [assistant],
      async (_tool, _input, toolUseContext) => {
        seenSameTurnToolUses.push(toolUseContext.sameTurnToolUses)
        return { behavior: 'allow', updatedInput: {} }
      },
      context,
    )) {
      // draining is enough — this test asserts on what canUseTool observed
    }

    expect(seenSameTurnToolUses).toHaveLength(2)
    expect(seenSameTurnToolUses[0]).toBeUndefined()
    // If resolvePrecedingToolUses is skipped, buildSameTurnToolUses throws on
    // a raw ToolUseBlock (no .assistantMessage), the error is swallowed, and
    // this comes back undefined instead of the real sibling call.
    expect(seenSameTurnToolUses[1]).toHaveLength(1)
    expect(seenSameTurnToolUses[1]?.[0]?.message?.content).toEqual([first])
  })
})
