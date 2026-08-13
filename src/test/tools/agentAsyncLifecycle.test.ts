import { describe, expect, test } from 'bun:test'
// Import order matters: AgentTool.tsx must evaluate before agentToolUtils.
// There is a pre-existing circular dependency between them; entering the
// chain via agentToolUtils hits a TDZ on agentToolResultSchema.
import '../../tools/AgentTool/AgentTool.js'
import { runAsyncAgentLifecycle } from '../../tools/AgentTool/agentToolUtils.js'
import { AbortError } from '../../utils/errors.js'
import { dequeue } from '../../utils/messageQueueManager.js'
import { createAssistantMessage } from '../../utils/messages.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

function makeTask(agentId: string): Record<string, any> {
  return {
    type: 'local_agent',
    status: 'running',
    agentId,
    notified: false,
    pendingMessages: [],
    retain: false,
  }
}

function makeStore(task: Record<string, any>) {
  let state: any = {
    tasks: { [task.agentId]: task },
    // enqueueAgentNotification → abortSpeculation reads this
    speculation: { status: 'idle' },
  }
  return {
    getState: () => state,
    setAppState: (f: (prev: any) => any) => {
      state = f(state)
    },
  }
}

const metadata = {
  prompt: 'do the thing',
  resolvedAgentModel: 'test-model',
  isBuiltInAgent: true,
  startTime: Date.now(),
  agentType: 'general-purpose',
  isAsync: true,
  personalityName: undefined,
}

function baseArgs(
  task: Record<string, any>,
  store: ReturnType<typeof makeStore>,
  makeStream: () => AsyncGenerator<any, void>,
) {
  return {
    taskId: task.agentId,
    abortController: new AbortController(),
    makeStream,
    metadata,
    description: 'test task',
    toolUseContext: { options: { tools: [] } } as any,
    rootSetAppState: store.setAppState,
    agentIdForCleanup: task.agentId,
    enableSummarization: false,
    getWorktreeResult: async () => ({}),
  }
}

async function* streamOf(...messages: any[]): AsyncGenerator<any, void> {
  for (const m of messages) yield m
}

describe('runAsyncAgentLifecycle', () => {
  test('completed run transitions status, notifies, and counts seeded messages in the result', async () => {
    const task = makeTask('agent-complete')
    const store = makeStore(task)
    // finalizeAgentTool takes content from the LAST assistant message but
    // counts tool uses across all messages — a tool_use in the seed proves
    // seeding reached finalize.
    const seed = createAssistantMessage({
      content: [{ type: 'tool_use', id: 'tu_seed', name: 'Bash', input: {} }],
    })
    const streamed = createAssistantMessage({ content: 'stream text from background' })

    await runAsyncAgentLifecycle({
      ...baseArgs(task, store, () => streamOf(streamed)),
      seedMessages: [seed],
    })

    const final = store.getState().tasks['agent-complete']
    expect(final.status).toBe('completed')
    expect(final.notified).toBe(true)
    expect(final.result.totalToolUseCount).toBe(1)
    expect(JSON.stringify(final.result.content)).toContain(
      'stream text from background',
    )
  })

  test('abort transitions to killed and still notifies with the seeded partial result', async () => {
    const task = makeTask('agent-killed')
    const store = makeStore(task)
    const seed = createAssistantMessage({ content: 'partial work before kill' })

    await runAsyncAgentLifecycle({
      ...baseArgs(task, store, async function* () {
        throw new AbortError()
      }),
      seedMessages: [seed],
    })

    const final = store.getState().tasks['agent-killed']
    expect(final.status).toBe('killed')
    expect(final.notified).toBe(true)
    // The notification's finalMessage is extractPartialResult(agentMessages),
    // which must include the SEEDED foreground work — otherwise the parent
    // loses everything the agent did before backgrounding.
    let killedNotification: string | undefined
    let cmd
    while ((cmd = dequeue())) {
      if (typeof cmd.value === 'string' && cmd.value.includes('agent-killed')) {
        killedNotification = cmd.value
      }
    }
    expect(killedNotification).toBeDefined()
    expect(killedNotification).toContain('partial work before kill')
  })

  test('retain=true task accumulates streamed messages on the task record', async () => {
    const task = makeTask('agent-retain')
    task.retain = true
    const store = makeStore(task)
    const seed = createAssistantMessage({ content: 'seed line' })
    const streamed = createAssistantMessage({ content: 'streamed line' })

    await runAsyncAgentLifecycle({
      ...baseArgs(task, store, () => streamOf(streamed)),
      seedMessages: [seed],
    })

    const final = store.getState().tasks['agent-retain']
    expect(final.status).toBe('completed')
    // Only streamed messages are appended live — seeds were already written
    // to disk by the foreground run and are merged from disk by the reader.
    const texts = (final.messages ?? []).map((m: any) =>
      JSON.stringify(m.message?.content ?? m),
    )
    expect(texts.some((t: string) => t.includes('streamed line'))).toBe(true)
    expect(texts.some((t: string) => t.includes('seed line'))).toBe(false)
  })

  test('stream error transitions to failed and notifies', async () => {
    const task = makeTask('agent-failed')
    const store = makeStore(task)

    await runAsyncAgentLifecycle({
      ...baseArgs(task, store, async function* () {
        throw new Error('boom')
      }),
    })

    const final = store.getState().tasks['agent-failed']
    expect(final.status).toBe('failed')
    expect(final.error).toBe('boom')
    expect(final.notified).toBe(true)
  })

  test('runs without seedMessages (async-from-start path unchanged)', async () => {
    const task = makeTask('agent-noseed')
    const store = makeStore(task)
    const streamed = createAssistantMessage({ content: 'only stream' })

    await runAsyncAgentLifecycle({
      ...baseArgs(task, store, () => streamOf(streamed)),
    })

    const final = store.getState().tasks['agent-noseed']
    expect(final.status).toBe('completed')
    expect(JSON.stringify(final.result)).toContain('only stream')
  })
})
