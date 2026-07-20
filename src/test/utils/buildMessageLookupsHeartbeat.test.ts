import { describe, expect, test } from 'bun:test'
import { buildMessageLookups } from '../../utils/messages.js'

// A heartbeat progress and a bash progress sharing one parent tool use id.
function progress(dataType: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'progress' as const,
    data: { type: dataType, ...extra },
    toolUseID: `${dataType}-tick`,
    parentToolUseID: 'toolu_parent',
    uuid: `uuid-${dataType}`,
    timestamp: '2026-07-20T00:00:00.000Z',
  }
}

describe('buildMessageLookups — tool_heartbeat exclusion', () => {
  test('heartbeat progress is excluded from the per-tool progress lookup', () => {
    const heartbeat = progress('tool_heartbeat', {
      toolName: 'Bash',
      elapsedTimeSeconds: 30,
    })
    const bash = progress('bash_progress', {
      output: 'x',
      fullOutput: 'x',
      elapsedTimeSeconds: 1,
    })

    const lookups = buildMessageLookups(
      [heartbeat, bash] as never,
      [] as never,
    )
    const forTool =
      lookups.progressMessagesByToolUseID.get('toolu_parent') ?? []

    // Only the real bash progress is tracked; the heartbeat is dropped.
    const dataType = (m: unknown) =>
      (m as { data?: { type?: string } })?.data?.type
    expect(forTool.length).toBe(1)
    expect(dataType(forTool[0])).toBe('bash_progress')
    expect(forTool.some(m => dataType(m) === 'tool_heartbeat')).toBe(false)
  })

  test('a lone heartbeat leaves the tool with no progress entries', () => {
    const heartbeat = progress('tool_heartbeat', {
      toolName: 'Read',
      elapsedTimeSeconds: 30,
    })
    const lookups = buildMessageLookups([heartbeat] as never, [] as never)
    expect(lookups.progressMessagesByToolUseID.has('toolu_parent')).toBe(false)
  })
})
