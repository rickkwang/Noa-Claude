import { describe, expect, test } from 'bun:test'
import * as LocalAgentTask from '../../tasks/LocalAgentTask/LocalAgentTask.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mirrors PROGRESS_THROTTLE_MS in LocalAgentTask (not exported).
const THROTTLE_MS = 100

function makeStore(taskId: string, isBackgrounded = false) {
  let state: any = {
    tasks: {
      [taskId]: {
        id: taskId,
        type: 'local_agent',
        status: 'running',
        agentId: taskId,
        agentType: 'general-purpose',
        isBackgrounded,
        retain: false,
      },
    },
  }
  let writes = 0
  return {
    getState: () => state,
    setState: (update: (prev: any) => any) => {
      const next = update(state)
      if (next !== state) writes++
      state = next
    },
    get writes() {
      return writes
    },
  }
}

type Store = ReturnType<typeof makeStore>

const progress = (tokenCount: number) => ({ toolUseCount: 1, tokenCount })
const afterFlush = () => new Promise(resolve => setTimeout(resolve, THROTTLE_MS * 2))

describe('updateAgentProgress throttling', () => {
  test('collapses a burst of progress ticks into a single store write', () => {
    const store = makeStore('a')
    for (let i = 0; i < 20; i++) {
      LocalAgentTask.updateAgentProgress('a', progress(i) as any, store.setState)
    }
    expect(store.writes).toBe(1)
    expect(store.getState().tasks.a.progress.tokenCount).toBe(0)
  })

  test('the trailing flush delivers the last value of a burst', async () => {
    const store = makeStore('a2')
    for (let i = 0; i < 20; i++) {
      LocalAgentTask.updateAgentProgress('a2', progress(i) as any, store.setState)
    }
    expect(store.getState().tasks.a2.progress.tokenCount).toBe(0)

    // Ticks only arrive per streamed message. Without the trailing flush the
    // panel would hold the leading value for the whole of the next tool call.
    await afterFlush()
    expect(store.getState().tasks.a2.progress.tokenCount).toBe(19)
    expect(store.writes).toBe(2)
  })

  test.each([
    ['kill', 'e1', (s: Store, id: string) => LocalAgentTask.killAsyncAgent(id, s.setState)],
    ['complete', 'e2', (s: Store, id: string) => LocalAgentTask.completeAgentTask({ agentId: id } as any, s.setState)],
    ['fail', 'e3', (s: Store, id: string) => LocalAgentTask.failAgentTask(id, 'boom', s.setState)],
    ['unregister foreground', 'e4', (s: Store, id: string) => LocalAgentTask.unregisterAgentForeground(id, s.setState)],
  ])('%s resets the throttle window so the next run of that id is not swallowed', (_name, id, terminate) => {
    const store = makeStore(id)
    LocalAgentTask.updateAgentProgress(id, progress(1) as any, store.setState)
    expect(store.writes).toBe(1)
    // Second tick within the window is dropped.
    LocalAgentTask.updateAgentProgress(id, progress(2) as any, store.setState)
    expect(store.writes).toBe(1)

    terminate(store, id)

    // A fresh store for the same id stands in for that agent's next run. Without
    // clearProgressThrottle on this path the tick is still inside the previous
    // window and gets dropped.
    const reused = makeStore(id)
    LocalAgentTask.updateAgentProgress(id, progress(3) as any, reused.setState)
    expect(reused.getState().tasks[id].progress.tokenCount).toBe(3)
  })

  test('a terminal transition cancels the pending trailing flush', async () => {
    // unregisterAgentForeground clears the throttle but leaves a backgrounded
    // task in place — the one terminal path that keeps the task 'running', so a
    // surviving flush timer would actually land instead of being swallowed by
    // the status guard in the updater.
    const store = makeStore('f', true)
    LocalAgentTask.updateAgentProgress('f', progress(1) as any, store.setState)
    LocalAgentTask.updateAgentProgress('f', progress(2) as any, store.setState)
    LocalAgentTask.unregisterAgentForeground('f', store.setState)

    await afterFlush()
    expect(store.getState().tasks.f.progress.tokenCount).toBe(1)
  })

  test('throttle is per task, so parallel agents do not starve each other', () => {
    const first = makeStore('c')
    const second = makeStore('d')
    LocalAgentTask.updateAgentProgress('c', progress(7) as any, first.setState)
    LocalAgentTask.updateAgentProgress('d', progress(9) as any, second.setState)
    expect(first.getState().tasks.c.progress.tokenCount).toBe(7)
    expect(second.getState().tasks.d.progress.tokenCount).toBe(9)
  })
})
