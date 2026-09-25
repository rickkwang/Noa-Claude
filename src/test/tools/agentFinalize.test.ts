import { describe, expect, test } from 'bun:test'
// AgentTool.tsx must evaluate before agentToolUtils (circular dependency; see
// agentAsyncLifecycle.test.ts).
import '../../tools/AgentTool/AgentTool.js'
import { finalizeAgentTool } from '../../tools/AgentTool/agentToolUtils.js'
import { createAttachmentMessage } from '../../utils/attachments.js'
import {
  createAssistantAPIErrorMessage,
  createAssistantMessage,
} from '../../utils/messages.js'

const metadata = {
  prompt: 'do the thing',
  resolvedAgentModel: 'test-model',
  isBuiltInAgent: false,
  startTime: Date.now(),
  agentType: 'general-purpose',
  isAsync: false,
}

function resultText(result: ReturnType<typeof finalizeAgentTool>): string {
  return result.content.map(b => b.text).join('\n')
}

const maxTurns = () =>
  createAttachmentMessage({ type: 'max_turns_reached', maxTurns: 7, turnCount: 8 })

describe('finalizeAgentTool', () => {
  test('a run that finished normally carries no partial marker', () => {
    const result = finalizeAgentTool(
      [createAssistantMessage({ content: 'all done' })],
      'a1',
      metadata,
    )
    expect(resultText(result)).toBe('all done')
  })

  test('hitting the turn cap marks the report partial and offers continuation', () => {
    const result = finalizeAgentTool(
      [createAssistantMessage({ content: 'halfway there' }), maxTurns()],
      'a1',
      metadata,
    )
    const text = resultText(result)
    expect(text).toContain('stopped at its 7-turn limit')
    expect(text).toContain('PARTIAL output')
    expect(text).toContain('SendMessage')
    expect(text).toContain('halfway there')
  })

  test('turn cap with no text says no report was produced; one-shot agents get no continue hint', () => {
    const result = finalizeAgentTool(
      [
        createAssistantMessage({
          content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }],
        }),
        maxTurns(),
      ],
      'a1',
      { ...metadata, agentType: 'Explore' },
    )
    const text = resultText(result)
    expect(text).toContain('had produced no report')
    expect(text).not.toContain('SendMessage')
  })

  test('a terminal non-transient API error fails the run instead of posing as its report', () => {
    expect(() =>
      finalizeAgentTool(
        [
          createAssistantMessage({ content: 'looked at a few files' }),
          createAssistantAPIErrorMessage({
            content: 'Prompt is too long',
            error: 'invalid_request',
          }),
        ],
        'a1',
        metadata,
      ),
    ).toThrow('Agent terminated early due to an API error: Prompt is too long')
  })

  test('a transient API error keeps earlier text, marked partial', () => {
    const result = finalizeAgentTool(
      [
        createAssistantMessage({ content: 'found the bug in foo.ts' }),
        createAssistantAPIErrorMessage({
          content: 'API Error: Repeated 529 Overloaded errors',
          error: 'server_error',
        }),
      ],
      'a1',
      metadata,
    )
    const text = resultText(result)
    expect(text).toContain('Agent terminated early due to an API error')
    expect(text).toContain('did NOT finish')
    expect(text).toContain('found the bug in foo.ts')
    expect(text).not.toContain('\nAPI Error: Repeated 529 Overloaded errors\n')
  })

  test('a transient API error with nothing to salvage still fails', () => {
    expect(() =>
      finalizeAgentTool(
        [
          createAssistantAPIErrorMessage({
            content: 'API Error: rate limited',
            error: 'rate_limit',
          }),
        ],
        'a1',
        metadata,
      ),
    ).toThrow('Agent terminated early due to an API error')
  })
})
