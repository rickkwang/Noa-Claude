import { afterEach, describe, expect, test } from 'bun:test'
import {
  calculateTokenWarningState,
  computeAutoCompactPivot,
  ERROR_THRESHOLD_BUFFER_TOKENS,
  getEffectiveContextWindowSize,
  resolveAutoCompactPivot,
  selectTailPivot,
  WARNING_THRESHOLD_BUFFER_TOKENS,
} from '../../../services/compact/autoCompact.js'
import { estimateMessageTokens } from '../../../services/compact/microCompact.js'
import type { Message } from '../../../types/message.js'

const originalEnv = {
  DISABLE_AUTO_COMPACT: process.env.DISABLE_AUTO_COMPACT,
  CLAUDE_CODE_AUTOCOMPACT_KEEP_TAIL:
    process.env.CLAUDE_CODE_AUTOCOMPACT_KEEP_TAIL,
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW,
  CLAUDE_AUTOCOMPACT_PCT_OVERRIDE:
    process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE,
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

describe('calculateTokenWarningState', () => {
  afterEach(() => {
    restoreEnv()
  })

  test('keeps warning and error thresholds distinct', () => {
    expect(ERROR_THRESHOLD_BUFFER_TOKENS).toBeLessThan(
      WARNING_THRESHOLD_BUFFER_TOKENS,
    )

    process.env.DISABLE_AUTO_COMPACT = '1'

    const model = 'test-model'
    const effectiveWindow = getEffectiveContextWindowSize(model)
    const tokenUsageBetweenThresholds =
      effectiveWindow -
      Math.floor((WARNING_THRESHOLD_BUFFER_TOKENS + ERROR_THRESHOLD_BUFFER_TOKENS) / 2)

    const state = calculateTokenWarningState(
      tokenUsageBetweenThresholds,
      model,
    )

    expect(state.isAboveWarningThreshold).toBe(true)
    expect(state.isAboveErrorThreshold).toBe(false)
  })
})

let fixtureCounter = 0
function nextUuid(): string {
  fixtureCounter += 1
  return `m-${fixtureCounter}`
}
function asstText(chars: number): Message {
  const uuid = nextUuid()
  return {
    type: 'assistant',
    id: uuid,
    uuid,
    message: {
      id: uuid,
      role: 'assistant',
      content: [{ type: 'text', text: 'x'.repeat(chars) }],
    },
  } as unknown as Message
}
function asstToolUse(id: string): Message {
  const uuid = nextUuid()
  return {
    type: 'assistant',
    id: uuid,
    uuid,
    message: {
      id: uuid,
      role: 'assistant',
      content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } }],
    },
  } as unknown as Message
}
function userToolResult(id: string, chars: number): Message {
  const uuid = nextUuid()
  return {
    type: 'user',
    uuid,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content: 'x'.repeat(chars) }],
    },
  } as unknown as Message
}

// The kept tail must never hold a tool_result whose tool_use was summarized away.
function keptToolPairInvariantHolds(messages: Message[], pivot: number): boolean {
  const kept = messages.slice(pivot)
  const toolUseIds = new Set<string>()
  const toolResultIds: string[] = []
  for (const m of kept) {
    const content = (m as { message?: { content?: unknown } }).message?.content
    if (!Array.isArray(content)) continue
    for (const b of content) {
      if (b.type === 'tool_use') toolUseIds.add(b.id)
      if (b.type === 'tool_result') toolResultIds.push(b.tool_use_id)
    }
  }
  return toolResultIds.every(id => toolUseIds.has(id))
}

describe('selectTailPivot', () => {
  test('keeps a verbatim tail meeting the budget and a prefix to summarize', () => {
    const messages = Array.from({ length: 20 }, () => asstText(2000))
    const pivot = selectTailPivot(messages, 4000)
    expect(pivot).not.toBeNull()
    expect(pivot!).toBeGreaterThan(0)
    expect(pivot!).toBeLessThan(messages.length)
    expect(estimateMessageTokens(messages.slice(pivot!))).toBeGreaterThanOrEqual(
      4000,
    )
  })

  test('returns null when the whole conversation fits within the tail budget', () => {
    const messages = Array.from({ length: 3 }, () => asstText(50))
    expect(selectTailPivot(messages, 100_000)).toBeNull()
  })

  test('snaps the pivot back so a kept tool_result keeps its tool_use', () => {
    const messages: Message[] = [
      asstText(2000),
      asstText(2000),
      asstText(2000),
      asstText(2000),
      asstToolUse('T1'),
      userToolResult('T1', 8000),
      asstText(40),
      asstText(40),
    ]
    const naivePivot = 5 // tool_result index; the tool_use lives at index 4
    const pivot = selectTailPivot(messages, 2000)
    expect(pivot).not.toBeNull()
    expect(pivot!).toBeLessThan(naivePivot)
    expect(keptToolPairInvariantHolds(messages, pivot!)).toBe(true)
  })
})

describe('computeAutoCompactPivot', () => {
  afterEach(() => {
    restoreEnv()
  })

  test('returns a pivot for a large conversation on a normal window (flag default on)', () => {
    delete process.env.CLAUDE_CODE_AUTOCOMPACT_KEEP_TAIL
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    const messages = Array.from({ length: 80 }, () => asstText(3000))
    const pivot = computeAutoCompactPivot(messages, 'test-model')
    expect(pivot).not.toBeNull()
    expect(pivot!).toBeGreaterThan(0)
    expect(pivot!).toBeLessThan(messages.length)
  })

  test('returns null when the keep-tail flag is disabled', () => {
    process.env.CLAUDE_CODE_AUTOCOMPACT_KEEP_TAIL = '0'
    const messages = Array.from({ length: 80 }, () => asstText(3000))
    expect(computeAutoCompactPivot(messages, 'test-model')).toBeNull()
  })

  test('returns null on a tiny window where no useful tail fits', () => {
    delete process.env.CLAUDE_CODE_AUTOCOMPACT_KEEP_TAIL
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '30000'
    const messages = Array.from({ length: 80 }, () => asstText(3000))
    expect(computeAutoCompactPivot(messages, 'test-model')).toBeNull()
  })

  test('returns null when the threshold has no room for tail + post-compact overhead', () => {
    delete process.env.CLAUDE_CODE_AUTOCOMPACT_KEEP_TAIL
    // 200K window, trigger at 25% ≈ 45K threshold. keepTail ≈ 13.5K, which
    // alone passes the old rough-vs-real guard — but 13.5K + ~40K of
    // non-compactable overhead (system/tools/userContext/summary) exceeds the
    // 45K threshold, so partial can't relieve pressure → must fall back to full.
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '200000'
    process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = '25'
    const messages = Array.from({ length: 80 }, () => asstText(3000))
    expect(computeAutoCompactPivot(messages, 'test-model')).toBeNull()
  })
})

describe('resolveAutoCompactPivot', () => {
  afterEach(() => {
    restoreEnv()
  })

  test('falls back to full compaction when already re-compacting in a chain', () => {
    delete process.env.CLAUDE_CODE_AUTOCOMPACT_KEEP_TAIL
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    const messages = Array.from({ length: 80 }, () => asstText(3000))
    const pivot = resolveAutoCompactPivot(messages, 'test-model', {
      isRecompactionInChain: true,
    } as never)
    expect(pivot).toBeNull()
  })

  test('keeps a tail when not in a re-compaction chain', () => {
    delete process.env.CLAUDE_CODE_AUTOCOMPACT_KEEP_TAIL
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    const messages = Array.from({ length: 80 }, () => asstText(3000))
    const pivot = resolveAutoCompactPivot(messages, 'test-model', {
      isRecompactionInChain: false,
    } as never)
    expect(pivot).not.toBeNull()
  })
})
