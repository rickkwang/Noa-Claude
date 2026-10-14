import { afterEach, describe, expect, test } from 'bun:test'
import * as LocalAgentTask from '../../tasks/LocalAgentTask/LocalAgentTask.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

function agentTask(
  id: string,
  { backgrounded = true }: { backgrounded?: boolean } = {},
): Record<string, any> {
  return {
    id,
    type: 'local_agent',
    status: 'running',
    agentId: id,
    agentType: 'general-purpose',
    isBackgrounded: backgrounded,
  }
}

function makeStore(...tasks: Record<string, any>[]) {
  let state: any = {
    tasks: Object.fromEntries(tasks.map(task => [task.id, task])),
  }
  return {
    getState: () => state,
    setState: (update: (prev: any) => any) => {
      state = update(state)
    },
  }
}

afterEach(() => {
  delete process.env.NOA_CLAUDE_MAX_CONCURRENT_AGENTS
})

describe('foreground to background capacity', () => {
  // Failures: counting the held slot twice, rejecting a handoff at capacity,
  // or allowing a handoff when backgrounding is disabled. The TUI and the
  // two-minute auto-background timer are not exercised by CLI spawn E2E.
  test.each([true, false])('keeps the held slot with backgrounding enabled=%s', enabled => {
    process.env.NOA_CLAUDE_MAX_CONCURRENT_AGENTS = '1'
    const foreground = agentTask('foreground', { backgrounded: false })
    foreground.canBackground = enabled
    const store = makeStore(foreground)

    expect(
      LocalAgentTask.backgroundAgentTask(
        'foreground',
        store.getState,
        store.setState,
      ),
    ).toBe(enabled)
    expect(store.getState().tasks.foreground.isBackgrounded).toBe(enabled)
  })
})
