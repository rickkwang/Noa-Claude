import { describe, expect, test } from 'bun:test'
import type {
  AssistantMessage,
  SystemCompactBoundaryMessage,
  SystemMicrocompactBoundaryMessage,
  UserMessage,
} from '../../types/message.js'
import {
  buildContinuationHistory,
  createAssistantMessage,
  createUserMessage,
  snapshotContinuationInitialMessages,
} from '../../utils/messages.js'

function toolUseAssistant(id: string): AssistantMessage {
  return createAssistantMessage({
    content: [{ type: 'tool_use', id, name: 'Bash', input: {} }],
  })
}

function toolResultUser(toolUseId: string): UserMessage {
  return createUserMessage({
    content: [
      { type: 'tool_result', tool_use_id: toolUseId, content: 'done' },
    ],
  })
}

function compactBoundary(): SystemCompactBoundaryMessage {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    content: '',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    compactMetadata: { trigger: 'auto', preTokens: 1000 },
  } as SystemCompactBoundaryMessage
}

function microcompactBoundary(): SystemMicrocompactBoundaryMessage {
  return {
    type: 'system',
    subtype: 'microcompact_boundary',
    content: '',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    microcompactMetadata: {},
  } as unknown as SystemMicrocompactBoundaryMessage
}

describe('buildContinuationHistory', () => {
  test('snapshots initial messages before run cleanup clears the source array', () => {
    const initial = createUserMessage({ content: 'original task' })
    const source = [initial]
    const snapshot = snapshotContinuationInitialMessages(source)

    source.length = 0

    expect(buildContinuationHistory(snapshot, [])).toEqual([initial])
  })

  test('returns empty for no messages', () => {
    expect(buildContinuationHistory([], [])).toEqual([])
  })

  test('prepends the initial prompt when no compact boundary exists', () => {
    const initial = createUserMessage({ content: 'original task' })
    const response = createAssistantMessage({ content: 'working on it' })
    expect(buildContinuationHistory([initial], [response])).toEqual([
      initial,
      response,
    ])
  })

  test('keeps assistant/user messages and drops progress without compact', () => {
    const assistant = createAssistantMessage({ content: 'working on it' })
    const user = createUserMessage({ content: 'thanks' })
    const progress = {
      type: 'progress',
      data: { type: 'bash_progress' },
      toolUseID: 'x',
      uuid: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    }
    const result = buildContinuationHistory([], [
      assistant,
      progress as never,
      user,
    ])
    expect(result).toEqual([assistant, user])
  })

  test('preserves post-compact context attachments', () => {
    const summary = createUserMessage({
      content: 'summary of prior work',
      isCompactSummary: true,
    })
    const attachment = {
      type: 'attachment',
      attachment: {
        type: 'hook_additional_context',
        content: ['restored instructions'],
      },
      uuid: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    }
    expect(
      buildContinuationHistory([], [
        compactBoundary(),
        summary,
        attachment as never,
      ]),
    ).toEqual([summary, attachment as never])
  })

  test('slices at the last compact boundary, dropping pre-compact history', () => {
    const before = createAssistantMessage({ content: 'old work' })
    const summary = createUserMessage({
      content: 'summary of prior work',
      isCompactSummary: true,
    })
    const initial = createUserMessage({ content: 'original task' })
    const after = createAssistantMessage({ content: 'new work' })
    const result = buildContinuationHistory([initial], [
      before,
      compactBoundary(),
      summary,
      after,
    ])
    expect(result).toEqual([summary, after])
  })

  test('only the last of multiple compact boundaries matters', () => {
    const first = createAssistantMessage({ content: 'first era' })
    const second = createAssistantMessage({ content: 'second era' })
    const third = createAssistantMessage({ content: 'third era' })
    const result = buildContinuationHistory([], [
      first,
      compactBoundary(),
      second,
      compactBoundary(),
      third,
    ])
    expect(result).toEqual([third])
  })

  test('microcompact boundary does not slice history', () => {
    const before = createAssistantMessage({ content: 'still relevant' })
    const after = createAssistantMessage({ content: 'continuing' })
    const initial = createUserMessage({ content: 'original task' })
    const result = buildContinuationHistory([initial], [
      before,
      microcompactBoundary(),
      after,
    ])
    expect(result).toEqual([initial, before, after])
  })

  test('drops assistant message whose tool_use has no result (mid-turn background)', () => {
    const resolved = toolUseAssistant('tu_1')
    const resolvedResult = toolResultUser('tu_1')
    const dangling = toolUseAssistant('tu_2')
    const result = buildContinuationHistory([], [
      resolved,
      resolvedResult,
      dangling,
    ])
    expect(result).toEqual([resolved, resolvedResult])
  })

  test('keeps resolved tool_use/tool_result pairs intact', () => {
    const assistant = toolUseAssistant('tu_1')
    const result = toolResultUser('tu_1')
    const tail = createAssistantMessage({ content: 'all done' })
    expect(buildContinuationHistory([], [assistant, result, tail])).toEqual([
      assistant,
      result,
      tail,
    ])
  })
})
