import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { _classifyYoloActionXmlForTesting } from '../../utils/permissions/yoloClassifier.js'

const originalUserType = process.env.USER_TYPE
const originalApiKey = process.env.ANTHROPIC_API_KEY

beforeEach(() => {
  process.env.USER_TYPE = 'external'
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

afterEach(() => {
  if (originalUserType === undefined) delete process.env.USER_TYPE
  else process.env.USER_TYPE = originalUserType
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalApiKey
})

/** getClassifierMaxRetries()'s in-code default, so 1 + 4 = 5 samples per stage. */
const MAX_RETRIES = 4

type Reply = { text: string; stopReason?: string }

type RunSideQuery = Parameters<typeof _classifyYoloActionXmlForTesting>[9]

function replier(
  replies: Reply[],
  captured: Record<string, unknown>[],
): RunSideQuery {
  let call = 0
  return (async (opts: Record<string, unknown>) => {
    captured.push(opts)
    const reply = replies[Math.min(call, replies.length - 1)]!
    call += 1
    return {
      id: `msg_${call}`,
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      content: reply.text === '' ? [] : [{ type: 'text', text: reply.text }],
      stop_reason: reply.stopReason ?? 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 2 },
    } as never
  }) as RunSideQuery
}

async function runXml(
  mode: 'both' | 'fast' | 'thinking',
  replies: Reply[],
  captured: Record<string, unknown>[] = [],
) {
  return _classifyYoloActionXmlForTesting(
    [],
    'system prompt',
    'user prompt',
    [{ type: 'text', text: 'action' }],
    'test-model',
    { systemPrompt: 10, toolCalls: 5, userPrompts: 5 },
    new AbortController().signal,
    {
      mainLoopTokens: 10,
      classifierChars: 20,
      classifierTokensEst: 5,
      transcriptEntries: 1,
      messages: 1,
      action: 'action',
    },
    mode,
    replier(replies, captured),
  )
}

describe('unparseable re-sampling', () => {
  test('re-samples up to maxRetries, then fails closed', async () => {
    const captured: Record<string, unknown>[] = []
    const result = await runXml('fast', [{ text: 'no verdict here' }], captured)
    expect(captured).toHaveLength(1 + MAX_RETRIES)
    expect(result).toMatchObject({
      shouldBlock: true,
      parseFailure: true,
      failureMode: 'unparseable',
    })
    expect(result.refusedBySafeguard).toBeUndefined()
  })

  test('stops as soon as a re-sample parses, and returns that verdict', async () => {
    const captured: Record<string, unknown>[] = []
    const result = await runXml(
      'fast',
      [{ text: 'preamble, no tags' }, { text: '<block>no</block>' }],
      captured,
    )
    expect(captured).toHaveLength(2)
    expect(result.shouldBlock).toBe(false)
    expect(result.parseFailure).toBeUndefined()
  })

  test('sums usage across the attempts it actually spent', async () => {
    const result = await runXml('fast', [
      { text: 'nope' },
      { text: '<block>yes</block><reason>r</reason>' },
    ])
    // 2 samples x 10 input tokens.
    expect(result.usage?.inputTokens).toBe(20)
    expect(result.usage?.outputTokens).toBe(4)
  })

  test('a truncated empty response is a re-samplable failure, not a refusal', async () => {
    const captured: Record<string, unknown>[] = []
    const result = await runXml(
      'fast',
      [
        { text: '', stopReason: 'max_tokens' },
        { text: '<block>no</block>' },
      ],
      captured,
    )
    expect(captured).toHaveLength(2)
    expect(result.shouldBlock).toBe(false)
  })

  test('does not re-sample a clean verdict', async () => {
    const captured: Record<string, unknown>[] = []
    await runXml('fast', [{ text: '<block>no</block>' }], captured)
    expect(captured).toHaveLength(1)
  })
})

describe('safeguard refusals', () => {
  test('are not re-sampled — retrying the same transcript refuses again', async () => {
    const captured: Record<string, unknown>[] = []
    const result = await runXml(
      'fast',
      [{ text: '', stopReason: 'refusal' }],
      captured,
    )
    expect(captured).toHaveLength(1)
    expect(result).toMatchObject({
      shouldBlock: true,
      failureMode: 'policy_refusal',
      refusedBySafeguard: true,
    })
  })

  test('do not demote the probe model — a refusal is not a contract failure', async () => {
    const result = await runXml('fast', [{ text: '', stopReason: 'refusal' }])
    expect(result.parseFailure).toBeUndefined()
  })

  test('say the block came from a check other than auto mode', async () => {
    const result = await runXml('fast', [{ text: '', stopReason: 'refusal' }])
    expect(result.reason).toContain('separate from auto mode')
  })

  test('an empty response with no stop reason counts as a refusal', async () => {
    const captured: Record<string, unknown>[] = []
    const result = await runXml('fast', [{ text: '' }], captured)
    expect(captured).toHaveLength(1)
    expect(result.refusedBySafeguard).toBe(true)
  })
})

describe('two-stage interaction', () => {
  test("keeps stage 1's block when stage 2 is refused", async () => {
    const result = await runXml('both', [
      { text: '<block>yes</block><reason>rm -rf /</reason>' },
      { text: '', stopReason: 'refusal' },
    ])
    expect(result).toMatchObject({ shouldBlock: true, reason: 'rm -rf /' })
    // A real verdict, so it is an ordinary denial rather than a no-verdict block.
    expect(result.refusedBySafeguard).toBeUndefined()
    expect(result.parseFailure).toBeUndefined()
  })

  test('attributes the refusal to stage 1 when stage 2 merely fails to parse', async () => {
    const result = await runXml('both', [
      { text: '', stopReason: 'refusal' },
      { text: 'still nothing' },
    ])
    expect(result).toMatchObject({
      shouldBlock: true,
      failureMode: 'policy_refusal',
      refusedBySafeguard: true,
    })
  })

  test('re-samples each stage independently', async () => {
    const captured: Record<string, unknown>[] = []
    const result = await runXml(
      'both',
      [{ text: 'garbage' }],
      captured,
    )
    // Stage 1 exhausts its samples, falls through, stage 2 exhausts its own.
    expect(captured).toHaveLength(2 * (1 + MAX_RETRIES))
    expect(result).toMatchObject({ shouldBlock: true, stage: 'thinking' })
  })
})

describe('request deadlines', () => {
  test('every classifier request carries a per-request timeout', async () => {
    const captured: Record<string, unknown>[] = []
    await runXml('both', [{ text: '<block>yes</block>' }, { text: '<block>no</block>' }], captured)
    expect(captured).toHaveLength(2)
    for (const opts of captured) expect(opts.timeoutMs).toBe(60_000)
  })

  test('the signal handed to the API is a derived one that can time out', async () => {
    const outer = new AbortController()
    const captured: Record<string, unknown>[] = []
    await _classifyYoloActionXmlForTesting(
      [],
      'system prompt',
      'user prompt',
      [{ type: 'text', text: 'action' }],
      'test-model',
      { systemPrompt: 10, toolCalls: 5, userPrompts: 5 },
      outer.signal,
      {
        mainLoopTokens: 10,
        classifierChars: 20,
        classifierTokensEst: 5,
        transcriptEntries: 1,
        messages: 1,
        action: 'action',
      },
      'fast',
      replier([{ text: '<block>no</block>' }], captured),
    )
    expect(captured[0]!.signal).toBeDefined()
    expect(captured[0]!.signal).not.toBe(outer.signal)
  })

  test('an already-aborted outer signal aborts the derived one', async () => {
    const outer = new AbortController()
    outer.abort()
    const captured: Record<string, unknown>[] = []
    await runXmlWithSignal(outer.signal, captured)
    expect((captured[0]!.signal as AbortSignal).aborted).toBe(true)
  })
})

async function runXmlWithSignal(
  signal: AbortSignal,
  captured: Record<string, unknown>[],
) {
  return _classifyYoloActionXmlForTesting(
    [],
    'system prompt',
    'user prompt',
    [{ type: 'text', text: 'action' }],
    'test-model',
    { systemPrompt: 10, toolCalls: 5, userPrompts: 5 },
    signal,
    {
      mainLoopTokens: 10,
      classifierChars: 20,
      classifierTokensEst: 5,
      transcriptEntries: 1,
      messages: 1,
      action: 'action',
    },
    'fast',
    replier([{ text: '<block>no</block>' }], captured),
  )
}
