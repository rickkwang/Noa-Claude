import { describe, expect, test } from 'bun:test'
import { areMessageRowPropsEqual } from '../../components/MessageRow.js'
import { buildMessageLookups } from '../../utils/messages.js'

// Progress messages no longer re-create the normalized message objects on every
// tick, so a row's message reference stays stable while a hook or a subagent is
// running. Anything a row draws from `lookups` rather than from the message now
// depends on this comparator to notice the change.

const toolUse = {
  type: 'assistant' as const,
  uuid: 'uuid-assistant',
  timestamp: '2026-07-20T00:00:00.000Z',
  message: {
    id: 'msg_1',
    content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }],
  },
}
const toolResult = {
  type: 'user' as const,
  uuid: 'uuid-result',
  timestamp: '2026-07-20T00:00:00.000Z',
  message: {
    content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }],
  },
}

function hookTick(hookEvent: string) {
  return {
    type: 'progress' as const,
    data: { type: 'hook_progress', hookEvent },
    toolUseID: `tick-${hookEvent}`,
    parentToolUseID: 'toolu_1',
    uuid: `uuid-tick-${hookEvent}`,
    timestamp: '2026-07-20T00:00:00.000Z',
  }
}

function props(message: unknown, normalized: unknown[]) {
  return {
    message,
    lookups: buildMessageLookups(normalized as never, [toolUse] as never),
    screen: 'prompt',
    verbose: false,
    columns: 100,
    latestBashOutputUUID: null,
    streamingToolUseIDs: new Set<string>(),
    inProgressToolUseIDs: new Set<string>(),
  } as never
}

describe('MessageRow re-renders for lookup-only changes', () => {
  // A PostToolUse hook starts after the tool result, so the tool already reads
  // as resolved while UserToolSuccessMessage counts the hooks down. Skipping
  // the row here would mean the running-hook line never appears.
  test('a PostToolUse hook tick re-renders the tool result row', () => {
    const equal = areMessageRowPropsEqual(
      props(toolResult, [toolUse, toolResult]),
      props(toolResult, [toolUse, toolResult, hookTick('PostToolUse')]),
    )
    expect(equal).toBe(false)
  })

  test('the row settles again once no hook is outstanding', () => {
    const settled = [
      toolUse,
      toolResult,
      hookTick('PostToolUse'),
      {
        type: 'attachment' as const,
        uuid: 'uuid-hook-done',
        timestamp: '2026-07-20T00:00:00.000Z',
        attachment: {
          type: 'hook_success',
          toolUseID: 'toolu_1',
          hookEvent: 'PostToolUse',
          hookName: 'fmt',
        },
      },
    ]
    const equal = areMessageRowPropsEqual(
      props(toolResult, settled),
      props(toolResult, settled),
    )
    expect(equal).toBe(true)
  })

  // The tool is still unresolved during PreToolUse, which the existing
  // in-flight check already covers.
  test('a PreToolUse hook tick re-renders the tool use row', () => {
    const equal = areMessageRowPropsEqual(
      props(toolUse, [toolUse]),
      props(toolUse, [toolUse, hookTick('PreToolUse')]),
    )
    expect(equal).toBe(false)
  })

  test('an unrelated progress tick still lets a finished row settle', () => {
    const other = {
      type: 'progress' as const,
      data: { type: 'agent_progress' },
      toolUseID: 'tick-other',
      parentToolUseID: 'toolu_other',
      uuid: 'uuid-tick-other',
      timestamp: '2026-07-20T00:00:00.000Z',
    }
    const equal = areMessageRowPropsEqual(
      props(toolResult, [toolUse, toolResult]),
      props(toolResult, [toolUse, toolResult, other]),
    )
    expect(equal).toBe(true)
  })
})
