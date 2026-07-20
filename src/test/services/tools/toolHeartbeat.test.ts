import { describe, expect, test } from 'bun:test'
import {
  startToolHeartbeat,
  TOOL_HEARTBEAT_INTERVAL_MS,
} from '../../../services/tools/toolHeartbeat.js'
import { AGENT_TOOL_NAME } from '../../../tools/AgentTool/constants.js'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Small interval so tests run in real time without a 30s wait.
const TICK = 15

describe('startToolHeartbeat', () => {
  test('default interval mirrors upstream (30s)', () => {
    expect(TOOL_HEARTBEAT_INTERVAL_MS).toBe(30_000)
  })

  test('emits ticks with the expected shape and incrementing ids', async () => {
    const ticks: Array<{ toolUseID: string; data: unknown }> = []
    const stop = startToolHeartbeat({
      toolName: 'Bash',
      toolUseID: 'toolu_abc',
      abortSignal: new AbortController().signal,
      onProgress: p => ticks.push(p),
      intervalMs: TICK,
    })
    await sleep(TICK * 3 + 10)
    stop()

    expect(ticks.length).toBeGreaterThanOrEqual(2)
    const [first, second] = ticks
    // Ids are `<toolUseID>-heartbeat-<n>` with n incrementing from 0.
    expect(first?.toolUseID).toBe('toolu_abc-heartbeat-0')
    expect(second?.toolUseID).toBe('toolu_abc-heartbeat-1')
    // Data carries the heartbeat discriminator, tool name, and elapsed seconds.
    const data = first?.data as Record<string, unknown>
    expect(data.type).toBe('tool_heartbeat')
    expect(data.toolName).toBe('Bash')
    expect(typeof data.elapsedTimeSeconds).toBe('number')
    expect(data.elapsedTimeSeconds).toBeGreaterThanOrEqual(0)
    // No tool output leaks into a heartbeat frame.
    expect('output' in data).toBe(false)
  })

  test('is a no-op for the Agent tool', async () => {
    const ticks: unknown[] = []
    const stop = startToolHeartbeat({
      toolName: AGENT_TOOL_NAME,
      toolUseID: 'toolu_agent',
      abortSignal: new AbortController().signal,
      onProgress: p => ticks.push(p),
      intervalMs: TICK,
    })
    await sleep(TICK * 3 + 10)
    stop()
    expect(ticks.length).toBe(0)
  })

  test('only the canonical Agent name is skipped (mirrors upstream)', async () => {
    // Upstream gates solely on the canonical Agent name. No live tool is named
    // "Task" (it is only a legacy permission alias of the Agent tool), so a
    // "Task"-named call is not special-cased and does emit heartbeats.
    const ticks: unknown[] = []
    const stop = startToolHeartbeat({
      toolName: 'Task',
      toolUseID: 'toolu_task',
      abortSignal: new AbortController().signal,
      onProgress: p => ticks.push(p),
      intervalMs: TICK,
    })
    await sleep(TICK * 2 + 10)
    stop()
    expect(ticks.length).toBeGreaterThanOrEqual(1)
  })

  test('stop() halts further ticks and is idempotent', async () => {
    const ticks: unknown[] = []
    const stop = startToolHeartbeat({
      toolName: 'Read',
      toolUseID: 'toolu_read',
      abortSignal: new AbortController().signal,
      onProgress: p => ticks.push(p),
      intervalMs: TICK,
    })
    await sleep(TICK + 5)
    stop()
    stop() // idempotent — must not throw
    const countAfterStop = ticks.length
    await sleep(TICK * 3)
    expect(ticks.length).toBe(countAfterStop)
  })

  test('stops emitting once the abort signal fires', async () => {
    const controller = new AbortController()
    const ticks: unknown[] = []
    startToolHeartbeat({
      toolName: 'Grep',
      toolUseID: 'toolu_grep',
      abortSignal: controller.signal,
      onProgress: p => ticks.push(p),
      intervalMs: TICK,
    })
    await sleep(TICK + 5)
    controller.abort()
    const countAtAbort = ticks.length
    await sleep(TICK * 3)
    expect(ticks.length).toBe(countAtAbort)
  })

  test('a throwing consumer stops the timer instead of looping', async () => {
    let calls = 0
    startToolHeartbeat({
      toolName: 'Bash',
      toolUseID: 'toolu_throw',
      abortSignal: new AbortController().signal,
      onProgress: () => {
        calls++
        throw new Error('consumer blew up')
      },
      intervalMs: TICK,
    })
    await sleep(TICK * 4 + 10)
    // The first tick throws and the timer self-cancels — no runaway retries.
    expect(calls).toBe(1)
  })
})
