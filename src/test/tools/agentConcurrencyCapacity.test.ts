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

describe('background agent capacity', () => {
  test('rejects a new background agent when the running background cap is full', () => {
    process.env.NOA_CLAUDE_MAX_CONCURRENT_AGENTS = '1'
    const tasks = { existing: agentTask('existing') }
    const assertCapacity = (
      LocalAgentTask as typeof LocalAgentTask & {
        assertCanStartBackgroundAgent(tasks: Record<string, any>): void
      }
    ).assertCanStartBackgroundAgent

    expect(() => assertCapacity(tasks)).toThrow(
      'Concurrent background agent limit reached (1 of 1 running)',
    )
  })

  test('does not count a foreground agent against the background cap', () => {
    process.env.NOA_CLAUDE_MAX_CONCURRENT_AGENTS = '1'
    const tasks = { foreground: agentTask('foreground', { backgrounded: false }) }
    const assertCapacity = (
      LocalAgentTask as typeof LocalAgentTask & {
        assertCanStartBackgroundAgent(tasks: Record<string, any>): void
      }
    ).assertCanStartBackgroundAgent

    expect(() => assertCapacity(tasks)).not.toThrow()
  })

  test('refuses foreground to background transition when the cap is full', () => {
    process.env.NOA_CLAUDE_MAX_CONCURRENT_AGENTS = '1'
    const store = makeStore(
      agentTask('existing'),
      agentTask('foreground', { backgrounded: false }),
    )

    expect(
      LocalAgentTask.backgroundAgentTask(
        'foreground',
        store.getState,
        store.setState,
      ),
    ).toBe(false)
    expect(store.getState().tasks.foreground.isBackgrounded).toBe(false)
  })
})
