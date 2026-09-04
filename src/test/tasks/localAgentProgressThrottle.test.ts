import { describe, expect, test } from 'bun:test'
import * as LocalAgentTask from '../../tasks/LocalAgentTask/LocalAgentTask.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

function makeStore(taskId: string) {
  let state: any = {
    tasks: {
      [taskId]: {
        id: taskId,
        type: 'local_agent',
        status: 'running',
        agentId: taskId,
        agentType: 'general-purpose',
        isBackgrounded: true,
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

const progress = (tokenCount: number) => ({ toolUseCount: 1, tokenCount })

describe('updateAgentProgress throttling', () => {
  test('collapses a burst of progress ticks into a single store write', () => {
    const store = makeStore('a')
    for (let i = 0; i < 20; i++) {
      LocalAgentTask.updateAgentProgress('a', progress(i) as any, store.setState)
    }
    expect(store.writes).toBe(1)
    expect(store.getState().tasks.a.progress.tokenCount).toBe(0)
  })

  test('a terminal transition clears the throttle so the next agent id is not swallowed', () => {
    const store = makeStore('b')
    LocalAgentTask.updateAgentProgress('b', progress(1) as any, store.setState)
    expect(store.writes).toBe(1)

    // Second tick within the window is dropped...
    LocalAgentTask.updateAgentProgress('b', progress(2) as any, store.setState)
    expect(store.writes).toBe(1)

    // ...until the task reaches a terminal state, which resets the window.
    LocalAgentTask.killAsyncAgent('b', store.setState)
    store.getState().tasks.b.status = 'running'
    LocalAgentTask.updateAgentProgress('b', progress(3) as any, store.setState)
    expect(store.getState().tasks.b.progress.tokenCount).toBe(3)
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
