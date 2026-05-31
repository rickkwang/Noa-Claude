import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createOpenAIShimClient } from '../../../services/api/openaiShim.js'

type CapturedRequest = {
  url: string
  body: Record<string, unknown>
}

function captureClient() {
  const captured: CapturedRequest[] = []
  const fetchOverride = (async (url: string, init: RequestInit) => {
    captured.push({
      url: typeof url === 'string' ? url : String(url),
      body: JSON.parse(String(init.body ?? '{}')),
    })
    // Minimal non-streaming OpenAI response shape.
    return new Response(
      JSON.stringify({
        id: 'cmpl_test',
        model: 'test-model',
        choices: [
          {
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch

  const client = createOpenAIShimClient({
    apiKey: 'test-key',
    baseURL: 'https://api.example.test/v1',
    defaultHeaders: {},
    timeoutMs: 1000,
    fetchOverride,
  })
  return { client, captured }
}

const PREV_ENV = process.env.CLAUDE_CODE_OPENAI_REASONING_EFFORT

describe('openaiShim reasoning_effort translation', () => {
  beforeEach(() => {
    delete process.env.CLAUDE_CODE_OPENAI_REASONING_EFFORT
  })

  afterEach(() => {
    if (PREV_ENV === undefined) {
      delete process.env.CLAUDE_CODE_OPENAI_REASONING_EFFORT
    } else {
      process.env.CLAUDE_CODE_OPENAI_REASONING_EFFORT = PREV_ENV
    }
  })

  test('env unset: output_config.effort is dropped, body has no reasoning_effort', async () => {
    const { client, captured } = captureClient()
    await client.messages.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
      output_config: { effort: 'high' },
    })
    expect(captured).toHaveLength(1)
    expect(captured[0]!.body.reasoning_effort).toBeUndefined()
  })

  test('env set: maps low/medium/high/xhigh verbatim', async () => {
    process.env.CLAUDE_CODE_OPENAI_REASONING_EFFORT = '1'
    for (const effort of ['low', 'medium', 'high', 'xhigh']) {
      const { client, captured } = captureClient()
      await client.messages.create({
        model: 'gpt-5',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 16,
        output_config: { effort },
      })
      expect(captured[0]!.body.reasoning_effort).toBe(effort)
    }
  })

  test('env set via isEnvTruthy aliases (true/yes/on): still translates', async () => {
    // The capability gate in effort.ts uses isEnvTruthy, so the shim must
    // accept the same set of truthy values — otherwise effort is surfaced and
    // applied but silently never sent.
    for (const truthy of ['true', 'yes', 'on']) {
      process.env.CLAUDE_CODE_OPENAI_REASONING_EFFORT = truthy
      const { client, captured } = captureClient()
      await client.messages.create({
        model: 'gpt-5',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 16,
        output_config: { effort: 'high' },
      })
      expect(captured[0]!.body.reasoning_effort).toBe('high')
    }
  })

  test('env set: max maps to xhigh (highest portable level, matches clamp)', async () => {
    // `max` normally never reaches the shim (resolveAppliedEffort clamps it to
    // xhigh for openaiCompatible providers). If injected directly via
    // CLAUDE_CODE_EXTRA_BODY, the shim maps it to the same xhigh.
    process.env.CLAUDE_CODE_OPENAI_REASONING_EFFORT = '1'
    const { client, captured } = captureClient()
    await client.messages.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
      output_config: { effort: 'max' },
    })
    expect(captured[0]!.body.reasoning_effort).toBe('xhigh')
  })

  test('env set but no effort: body has no reasoning_effort', async () => {
    process.env.CLAUDE_CODE_OPENAI_REASONING_EFFORT = '1'
    const { client, captured } = captureClient()
    await client.messages.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
      output_config: { format: { type: 'json_schema', schema: {} } },
    })
    expect(captured[0]!.body.reasoning_effort).toBeUndefined()
  })

  test('response_format is never emitted from output_config', async () => {
    process.env.CLAUDE_CODE_OPENAI_REASONING_EFFORT = '1'
    const { client, captured } = captureClient()
    await client.messages.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: {} },
      },
    })
    // Anthropic output_config has different shape than OpenAI response_format,
    // so we never pass it through.
    expect(captured[0]!.body.response_format).toBeUndefined()
    expect(captured[0]!.body.reasoning_effort).toBe('high')
  })
})
