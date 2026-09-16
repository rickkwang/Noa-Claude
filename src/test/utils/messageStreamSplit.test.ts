import { describe, expect, test } from 'bun:test'
import {
  buildMessageLookups,
  buildProgressLookups,
  buildTranscriptLookups,
  isNotEmptyMessage,
  MessageStreamSplit,
  mergeMessageLookups,
  normalizeMessages,
} from '../../utils/messages.js'

// Progress ticks (hook progress, subagent activity) are appended one per
// update. The split keeps the transcript half identity-stable across them so
// the render memos that derive from it can skip; these tests pin both halves of
// that contract — the identity reuse and the lookups staying unchanged.

function progress(parentToolUseID: string, data: Record<string, unknown>, n: number) {
  return {
    type: 'progress' as const,
    data,
    toolUseID: `${parentToolUseID}-tick-${n}`,
    parentToolUseID,
    uuid: `uuid-progress-${parentToolUseID}-${n}`,
    timestamp: '2026-07-20T00:00:00.000Z',
  }
}

function toolUse(messageID: string, ids: string[]) {
  return {
    type: 'assistant' as const,
    uuid: `uuid-${messageID}`,
    timestamp: '2026-07-20T00:00:00.000Z',
    message: {
      id: messageID,
      content: ids.map(id => ({ type: 'tool_use', id, name: 'Bash', input: {} })),
    },
  }
}

function toolResult(toolUseID: string, isError = false) {
  return {
    type: 'user' as const,
    uuid: `uuid-result-${toolUseID}`,
    timestamp: '2026-07-20T00:00:00.000Z',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: toolUseID, content: 'ok', is_error: isError },
      ],
    },
  }
}

function hookAttachment(toolUseID: string, hookName: string, type = 'hook_success') {
  return {
    type: 'attachment' as const,
    uuid: `uuid-hook-${toolUseID}-${hookName}-${type}`,
    timestamp: '2026-07-20T00:00:00.000Z',
    attachment: { type, toolUseID, hookEvent: 'PreToolUse', hookName },
  }
}

describe('MessageStreamSplit', () => {
  test('partitions in order and keeps both halves complete', () => {
    const a = toolUse('msg_1', ['toolu_1'])
    const p1 = progress('toolu_1', { type: 'agent_progress' }, 1)
    const r = toolResult('toolu_1')
    const p2 = progress('toolu_1', { type: 'agent_progress' }, 2)

    const { transcript, progress: prog } = new MessageStreamSplit().split([
      a, p1, r, p2,
    ] as never)
    expect(transcript).toEqual([a, r] as never)
    expect(prog).toEqual([p1, p2] as never)
  })

  test('a progress tick leaves the transcript array identical', () => {
    const split = new MessageStreamSplit()
    const base = [toolUse('msg_1', ['toolu_1']), toolResult('toolu_1')]
    const first = split.split(base as never)
    const second = split.split([...base, progress('toolu_1', { type: 'hook_progress', hookEvent: 'PreToolUse' }, 1)] as never)

    expect(second.transcript).toBe(first.transcript)
    expect(second.progress).not.toBe(first.progress)
    expect(second.progress.length).toBe(1)
  })

  test('a transcript append leaves the progress array identical', () => {
    const split = new MessageStreamSplit()
    const p = progress('toolu_1', { type: 'agent_progress' }, 1)
    const base = [toolUse('msg_1', ['toolu_1']), p]
    const first = split.split(base as never)
    const second = split.split([...base, toolResult('toolu_1')] as never)

    expect(second.progress).toBe(first.progress)
    expect(second.transcript).not.toBe(first.transcript)
    expect(second.transcript.length).toBe(2)
  })

  test('replacing the last progress tick does not disturb the transcript', () => {
    const split = new MessageStreamSplit()
    const a = toolUse('msg_1', ['toolu_1'])
    const p1 = progress('toolu_1', { type: 'bash_progress' }, 1)
    const p2 = progress('toolu_1', { type: 'bash_progress' }, 2)
    const first = split.split([a, p1] as never)
    const second = split.split([a, p2] as never)

    expect(second.transcript).toBe(first.transcript)
    expect(second.progress).toEqual([p2] as never)
  })

  test('a rewind truncates both halves instead of keeping a stale tail', () => {
    const split = new MessageStreamSplit()
    const a = toolUse('msg_1', ['toolu_1'])
    const p = progress('toolu_1', { type: 'agent_progress' }, 1)
    const r = toolResult('toolu_1')
    split.split([a, p, r] as never)
    const after = split.split([a] as never)

    expect(after.transcript).toEqual([a] as never)
    expect(after.progress).toEqual([] as never)
  })

  test('a compaction that replaces the whole list rebuilds both halves', () => {
    const split = new MessageStreamSplit()
    split.split([
      toolUse('msg_1', ['toolu_1']),
      progress('toolu_1', { type: 'agent_progress' }, 1),
    ] as never)
    const summary = toolUse('msg_new', ['toolu_new'])
    const after = split.split([summary] as never)

    expect(after.transcript).toEqual([summary] as never)
    expect(after.progress).toEqual([] as never)
  })

  test('split is a pure partition — replaying an older list is not corrupted', () => {
    const split = new MessageStreamSplit()
    const a = toolUse('msg_1', ['toolu_1'])
    const p = progress('toolu_1', { type: 'agent_progress' }, 1)
    split.split([a, p] as never)
    // React may discard and re-run a memo; calling with the same or an earlier
    // list must still return the correct partition of that list.
    expect(split.split([a] as never).transcript).toEqual([a] as never)
    expect(split.split([a, p] as never).progress).toEqual([p] as never)
  })
})

describe('lookups halves', () => {
  const messages = [
    toolUse('msg_1', ['toolu_1', 'toolu_2']),
    progress('toolu_1', { type: 'agent_progress', step: 1 }, 1),
    progress('toolu_1', { type: 'tool_heartbeat', toolName: 'Bash' }, 2),
    progress('toolu_1', { type: 'hook_progress', hookEvent: 'PreToolUse' }, 3),
    hookAttachment('toolu_1', 'fmt'),
    hookAttachment('toolu_1', 'fmt', 'hook_additional_context'),
    toolResult('toolu_1'),
    toolResult('toolu_2', true),
  ]

  test('the wrapper equals the two halves merged', () => {
    const transcript = messages.filter(m => m.type !== 'progress')
    const prog = messages.filter(m => m.type === 'progress')
    const merged = mergeMessageLookups(
      buildTranscriptLookups(transcript as never, [messages[0]] as never),
      buildProgressLookups(prog as never),
    )
    const combined = buildMessageLookups(messages as never, [messages[0]] as never)

    expect(merged).toEqual(combined)
  })

  test('progress half tracks the trail and in-progress hooks, skipping heartbeats', () => {
    const prog = messages.filter(m => m.type === 'progress')
    const lookups = buildProgressLookups(prog as never)
    const trail = lookups.progressMessagesByToolUseID.get('toolu_1') ?? []

    expect(trail.length).toBe(2)
    expect(trail.some(m => (m as never as { data: { type: string } }).data.type === 'tool_heartbeat')).toBe(false)
    expect(lookups.inProgressHookCounts.get('toolu_1')?.get('PreToolUse' as never)).toBe(1)
  })

  test('transcript half dedupes hook names, resolves siblings and flags errors', () => {
    const transcript = messages.filter(m => m.type !== 'progress')
    const lookups = buildTranscriptLookups(transcript as never, [messages[0]] as never)

    // Two attachments, one hook: counted once, so the hook reads as resolved.
    expect(lookups.resolvedHookCounts.get('toolu_1')?.get('PreToolUse' as never)).toBe(1)
    expect(lookups.siblingToolUseIDs.get('toolu_1')).toEqual(
      new Set(['toolu_1', 'toolu_2']),
    )
    expect(lookups.resolvedToolUseIDs.has('toolu_1')).toBe(true)
    expect(lookups.erroredToolUseIDs.has('toolu_2')).toBe(true)
    expect(lookups.erroredToolUseIDs.has('toolu_1')).toBe(false)
  })

  test('progress messages never reach the transcript half', () => {
    const transcript = messages.filter(m => m.type !== 'progress')
    const withProgress = buildTranscriptLookups(messages as never, [messages[0]] as never)
    const withoutProgress = buildTranscriptLookups(transcript as never, [messages[0]] as never)

    expect(withProgress).toEqual(withoutProgress)
  })
})

// The renderer normalizes only the transcript half. That is only equivalent to
// normalizing everything because progress messages pass through untouched and
// never set the split-chain flag that reassigns UUIDs — if normalizeMessages
// ever starts treating them as content, this catches it.
describe('normalizing the transcript half alone', () => {
  test('matches the non-progress part of normalizing everything', () => {
    const messages = [
      { type: 'user' as const, uuid: 'uuid-u1', timestamp: 'T', message: { content: 'hello' } },
      progress('toolu_1', { type: 'agent_progress' }, 1),
      // Multi-block: sets the chain flag, so every later uuid is derived.
      toolUse('msg_1', ['toolu_1', 'toolu_2']),
      progress('toolu_1', { type: 'agent_progress' }, 2),
      toolResult('toolu_1'),
      hookAttachment('toolu_1', 'fmt'),
      progress('toolu_2', { type: 'hook_progress', hookEvent: 'PreToolUse' }, 3),
      toolResult('toolu_2'),
    ]
    const { transcript } = new MessageStreamSplit().split(messages as never)

    const viaSplit = normalizeMessages(transcript as never).filter(isNotEmptyMessage)
    const viaWhole = normalizeMessages(messages as never)
      .filter(isNotEmptyMessage)
      .filter(m => m.type !== 'progress')

    expect(viaSplit).toEqual(viaWhole as never)
  })

  test('the two halves still account for every normalized message', () => {
    const messages = [
      toolUse('msg_1', ['toolu_1']),
      progress('toolu_1', { type: 'agent_progress' }, 1),
      toolResult('toolu_1'),
    ]
    const { transcript, progress: prog } = new MessageStreamSplit().split(messages as never)
    const whole = normalizeMessages(messages as never).filter(isNotEmptyMessage)

    expect(
      normalizeMessages(transcript as never).filter(isNotEmptyMessage).length + prog.length,
    ).toBe(whole.length)
  })
})
