import { afterEach, describe, expect, test } from 'bun:test'
import type { Message } from '../../../types/message.js'
import {
  clearOldToolResults,
  microcompactMessages,
  TIME_BASED_MC_CLEARED_MESSAGE,
} from '../../../services/compact/microCompact.js'
import {
  getSizeBasedMCConfig,
  shouldSizeTrigger,
} from '../../../services/compact/sizeBasedMCConfig.js'

let counter = 0
function id(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

// assistant message issuing a tool_use of the given tool name
function toolUse(toolName: string, toolId: string): Message {
  const uuid = id('a')
  return {
    type: 'assistant',
    id: uuid,
    uuid,
    message: {
      id: uuid,
      role: 'assistant',
      content: [{ type: 'tool_use', id: toolId, name: toolName, input: {} }],
    },
  } as unknown as Message
}

// user message carrying the tool_result for a prior tool_use
function toolResult(toolId: string, text: string): Message {
  const uuid = id('u')
  return {
    type: 'user',
    uuid,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolId, content: text }],
    },
  } as unknown as Message
}

function resultContent(message: Message, toolId: string): unknown {
  const content = (message as { message: { content: unknown[] } }).message.content
  const block = content.find(
    (b): b is { type: string; tool_use_id: string; content: unknown } =>
      typeof b === 'object' &&
      b !== null &&
      (b as { type?: string }).type === 'tool_result' &&
      (b as { tool_use_id?: string }).tool_use_id === toolId,
  )
  return block?.content
}

const originalEnv = {
  CLAUDE_CODE_SIZE_MICROCOMPACT: process.env.CLAUDE_CODE_SIZE_MICROCOMPACT,
  CLAUDE_CODE_SIZE_MICROCOMPACT_PCT: process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_PCT,
  CLAUDE_CODE_SIZE_MICROCOMPACT_KEEP:
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_KEEP,
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

describe('clearOldToolResults', () => {
  test('keeps the last N compactable tool results, clears older ones', () => {
    const messages: Message[] = []
    for (let i = 0; i < 5; i++) {
      const t = `tool-${i}`
      messages.push(toolUse('Read', t))
      messages.push(toolResult(t, `content of read ${i} ${'x'.repeat(40)}`))
    }

    const out = clearOldToolResults(messages, 2)
    expect(out).not.toBeNull()
    expect(out!.cleared).toBe(3)
    expect(out!.kept).toBe(2)
    expect(out!.tokensSaved).toBeGreaterThan(0)

    // tool-0..tool-2 cleared, tool-3/tool-4 preserved
    expect(resultContent(out!.messages[1]!, 'tool-0')).toBe(
      TIME_BASED_MC_CLEARED_MESSAGE,
    )
    expect(resultContent(out!.messages[5]!, 'tool-2')).toBe(
      TIME_BASED_MC_CLEARED_MESSAGE,
    )
    expect(resultContent(out!.messages[7]!, 'tool-3')).not.toBe(
      TIME_BASED_MC_CLEARED_MESSAGE,
    )
    expect(resultContent(out!.messages[9]!, 'tool-4')).not.toBe(
      TIME_BASED_MC_CLEARED_MESSAGE,
    )
  })

  test('does not clear non-compactable tool results', () => {
    const messages: Message[] = [
      toolUse('AskUserQuestion', 'q-1'),
      toolResult('q-1', 'an answer that should survive clearing entirely'),
      toolUse('Read', 'r-1'),
      toolResult('r-1', 'file contents '.repeat(20)),
      toolUse('Read', 'r-2'),
      toolResult('r-2', 'more file contents '.repeat(20)),
    ]
    // keepRecent 1 → only r-2 kept among compactables; r-1 cleared; q-1 untouched
    const out = clearOldToolResults(messages, 1)
    expect(out).not.toBeNull()
    expect(resultContent(out!.messages[1]!, 'q-1')).not.toBe(
      TIME_BASED_MC_CLEARED_MESSAGE,
    )
    expect(resultContent(out!.messages[3]!, 'r-1')).toBe(
      TIME_BASED_MC_CLEARED_MESSAGE,
    )
    expect(resultContent(out!.messages[5]!, 'r-2')).not.toBe(
      TIME_BASED_MC_CLEARED_MESSAGE,
    )
  })

  test('returns null when nothing is clearable', () => {
    const messages: Message[] = [
      toolUse('Read', 'r-1'),
      toolResult('r-1', 'only one result, kept by keepRecent'),
    ]
    expect(clearOldToolResults(messages, 5)).toBeNull()
  })

  test('floors keepRecent at 1 so it never clears everything', () => {
    const messages: Message[] = [
      toolUse('Read', 'r-1'),
      toolResult('r-1', 'first '.repeat(20)),
      toolUse('Read', 'r-2'),
      toolResult('r-2', 'second '.repeat(20)),
    ]
    const out = clearOldToolResults(messages, 0)
    expect(out).not.toBeNull()
    // last result always survives
    expect(resultContent(out!.messages[3]!, 'r-2')).not.toBe(
      TIME_BASED_MC_CLEARED_MESSAGE,
    )
  })

  test('cleared count reflects only results cleared on this pass', () => {
    const messages: Message[] = [
      toolUse('Read', 'r-1'),
      // r-1 was already cleared on a prior turn
      toolResult('r-1', TIME_BASED_MC_CLEARED_MESSAGE),
      toolUse('Read', 'r-2'),
      toolResult('r-2', 'still has real content '.repeat(20)),
      toolUse('Read', 'r-3'),
      toolResult('r-3', 'also real content '.repeat(20)),
      toolUse('Read', 'r-4'),
      toolResult('r-4', 'most recent, kept '.repeat(20)),
    ]
    // keepRecent 1 → keep r-4; clearSet = {r-1, r-2, r-3} but r-1 is already
    // cleared, so only r-2 and r-3 are newly cleared.
    const out = clearOldToolResults(messages, 1)
    expect(out).not.toBeNull()
    expect(out!.cleared).toBe(2)
  })
})

describe('getSizeBasedMCConfig', () => {
  afterEach(restoreEnv)

  test('enabled by default with conservative fraction', () => {
    delete process.env.CLAUDE_CODE_SIZE_MICROCOMPACT
    delete process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_PCT
    delete process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_KEEP
    const cfg = getSizeBasedMCConfig()
    expect(cfg.enabled).toBe(true)
    expect(cfg.triggerFraction).toBeGreaterThan(0)
    expect(cfg.triggerFraction).toBeLessThanOrEqual(1)
    expect(cfg.keepRecent).toBeGreaterThanOrEqual(1)
  })

  test('disabled via env "0"', () => {
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT = '0'
    expect(getSizeBasedMCConfig().enabled).toBe(false)
  })

  test('percent and keep overrides applied', () => {
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_PCT = '70'
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_KEEP = '12'
    const cfg = getSizeBasedMCConfig()
    expect(cfg.triggerFraction).toBeCloseTo(0.7, 5)
    expect(cfg.keepRecent).toBe(12)
  })

  test('ignores out-of-range percent, falls back to default', () => {
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_PCT = '900'
    const cfg = getSizeBasedMCConfig()
    expect(cfg.triggerFraction).toBeGreaterThan(0)
    expect(cfg.triggerFraction).toBeLessThanOrEqual(1)
  })
})

describe('microcompactMessages — size-based wiring', () => {
  afterEach(restoreEnv)

  const ctx = {
    options: { mainLoopModel: 'claude-sonnet-4-5' },
  } as unknown as Parameters<typeof microcompactMessages>[1]

  function bigConversation(): Message[] {
    const messages: Message[] = []
    for (let i = 0; i < 6; i++) {
      const t = `big-${i}`
      messages.push(toolUse('Read', t))
      messages.push(toolResult(t, 'payload '.repeat(400)))
    }
    return messages
  }

  test('clears old tool results once the size threshold is crossed', async () => {
    // 1% of any window is tiny, so the conversation above always trips it.
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT = '1'
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_PCT = '1'
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_KEEP = '2'

    const out = await microcompactMessages(
      bigConversation(),
      ctx,
      'repl_main_thread',
    )
    const cleared = out.messages.filter(m =>
      ((m as { message: { content: unknown[] } }).message.content ?? []).some(
        (b: unknown) =>
          (b as { content?: unknown })?.content === TIME_BASED_MC_CLEARED_MESSAGE,
      ),
    )
    expect(cleared.length).toBe(4) // 6 results minus the 2 most recent kept
  })

  test('does nothing when disabled', async () => {
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT = '0'
    const input = bigConversation()
    const out = await microcompactMessages(input, ctx, 'repl_main_thread')
    expect(out.messages).toEqual(input)
  })

  test('does not run for non-main-thread sources', async () => {
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT = '1'
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_PCT = '1'
    const input = bigConversation()
    const out = await microcompactMessages(input, ctx, 'session_memory')
    expect(out.messages).toEqual(input)
  })
})

describe('shouldSizeTrigger', () => {
  const cfg = { enabled: true, triggerFraction: 0.85, keepRecent: 8 }

  test('fires once estimated tokens cross the fraction of the window', () => {
    expect(shouldSizeTrigger(86_000, 100_000, cfg)).toBe(true)
    expect(shouldSizeTrigger(84_000, 100_000, cfg)).toBe(false)
  })

  test('never fires when disabled', () => {
    expect(
      shouldSizeTrigger(99_000, 100_000, { ...cfg, enabled: false }),
    ).toBe(false)
  })

  test('never fires for a non-positive window', () => {
    expect(shouldSizeTrigger(99_000, 0, cfg)).toBe(false)
  })
})
