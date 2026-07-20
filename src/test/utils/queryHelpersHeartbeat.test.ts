import { describe, expect, test } from 'bun:test'
import { normalizeMessage } from '../../utils/queryHelpers.js'

// Minimal synthetic internal progress message, matching what
// createProgressMessage produces for a heartbeat tick.
function heartbeatProgress() {
  return {
    type: 'progress' as const,
    data: {
      type: 'tool_heartbeat' as const,
      toolName: 'Bash',
      elapsedTimeSeconds: 42,
    },
    toolUseID: 'toolu_x-heartbeat-3',
    parentToolUseID: 'toolu_x',
    uuid: 'uuid-1',
    timestamp: '2026-07-20T00:00:00.000Z',
  }
}

function bashProgress() {
  return {
    type: 'progress' as const,
    data: {
      type: 'bash_progress' as const,
      output: 'partial',
      fullOutput: 'partial',
      elapsedTimeSeconds: 5,
    },
    toolUseID: 'bash-progress-1',
    parentToolUseID: 'toolu_y',
    uuid: 'uuid-2',
    timestamp: '2026-07-20T00:00:00.000Z',
  }
}

describe('normalizeMessage — tool_heartbeat', () => {
  test('emits a tool_progress SDK frame flagged heartbeat', () => {
    const out = [...normalizeMessage(heartbeatProgress() as never)]
    expect(out.length).toBe(1)
    const frame = out[0] as Record<string, unknown>
    expect(frame.type).toBe('tool_progress')
    expect(frame.tool_name).toBe('Bash')
    expect(frame.tool_use_id).toBe('toolu_x-heartbeat-3')
    expect(frame.parent_tool_use_id).toBe('toolu_x')
    expect(frame.elapsed_time_seconds).toBe(42)
    expect(frame.heartbeat).toBe(true)
    expect(frame.session_id).toBeDefined()
  })

  test('heartbeat frames are never throttled (unlike bash progress)', () => {
    // Two ticks in a row both surface — the emitter already rate-limits to 30s.
    const first = [...normalizeMessage(heartbeatProgress() as never)]
    const second = [...normalizeMessage(heartbeatProgress() as never)]
    expect(first.length).toBe(1)
    expect(second.length).toBe(1)
  })

  test('regression: bash progress stays gated to remote/container mode', () => {
    const prevRemote = process.env.CLAUDE_CODE_REMOTE
    const prevContainer = process.env.CLAUDE_CODE_CONTAINER_ID
    delete process.env.CLAUDE_CODE_REMOTE
    delete process.env.CLAUDE_CODE_CONTAINER_ID
    try {
      const out = [...normalizeMessage(bashProgress() as never)]
      // Not remote and not a container → bash progress is suppressed, proving
      // the heartbeat branch didn't accidentally widen the bash gate.
      expect(out.length).toBe(0)
    } finally {
      if (prevRemote !== undefined) process.env.CLAUDE_CODE_REMOTE = prevRemote
      if (prevContainer !== undefined)
        process.env.CLAUDE_CODE_CONTAINER_ID = prevContainer
    }
  })
})
