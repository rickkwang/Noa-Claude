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

// Capture client whose fetch returns an SSE stream built from the given chunks.
function streamingCaptureClient(chunks: Array<Record<string, unknown>>) {
  const captured: CapturedRequest[] = []
  const fetchOverride = (async (url: string, init: RequestInit) => {
    captured.push({
      url: typeof url === 'string' ? url : String(url),
      body: JSON.parse(String(init.body ?? '{}')),
    })
    const body =
      chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') +
      'data: [DONE]\n\n'
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
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

async function collectStream(
  stream: AsyncIterable<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = []
  for await (const event of stream) {
    events.push(event)
  }
  return events
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
describe('openaiShim stream usage', () => {
  test('streaming request asks for usage via stream_options.include_usage', async () => {
    const { client, captured } = streamingCaptureClient([
      { id: 'c', choices: [{ delta: { content: 'hi' } }] },
      { id: 'c', choices: [{ delta: {}, finish_reason: 'stop' }] },
    ])
    const stream = (await client.messages.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
      stream: true,
    })) as AsyncIterable<Record<string, unknown>>
    await collectStream(stream)
    expect(captured).toHaveLength(1)
    expect(captured[0]!.body.stream).toBe(true)
    expect(captured[0]!.body.stream_options).toEqual({ include_usage: true })
  })

  test('non-streaming request does not send stream_options', async () => {
    const { client, captured } = captureClient()
    await client.messages.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
    })
    expect(captured[0]!.body.stream).toBe(false)
    expect(captured[0]!.body.stream_options).toBeUndefined()
  })

  test('CLAUDE_CODE_OPENAI_DISABLE_STREAM_USAGE opts out of stream_options', async () => {
    const prev = process.env.CLAUDE_CODE_OPENAI_DISABLE_STREAM_USAGE
    process.env.CLAUDE_CODE_OPENAI_DISABLE_STREAM_USAGE = '1'
    try {
      const { client, captured } = streamingCaptureClient([
        { id: 'c', choices: [{ delta: {}, finish_reason: 'stop' }] },
      ])
      const stream = (await client.messages.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 16,
        stream: true,
      })) as AsyncIterable<Record<string, unknown>>
      await collectStream(stream)
      expect(captured[0]!.body.stream).toBe(true)
      expect(captured[0]!.body.stream_options).toBeUndefined()
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_CODE_OPENAI_DISABLE_STREAM_USAGE
      } else {
        process.env.CLAUDE_CODE_OPENAI_DISABLE_STREAM_USAGE = prev
      }
    }
  })

  test('usage from a trailing usage-only chunk reaches a message_delta', async () => {
    // OpenAI with include_usage emits the usage in a final chunk that carries
    // an empty choices array, separate from the finish_reason chunk.
    const { client } = streamingCaptureClient([
      { id: 'c', choices: [{ delta: { content: 'hello' } }] },
      { id: 'c', choices: [{ delta: {}, finish_reason: 'stop' }] },
      {
        id: 'c',
        choices: [],
        usage: { prompt_tokens: 42, completion_tokens: 7 },
      },
    ])
    const stream = (await client.messages.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
      stream: true,
    })) as AsyncIterable<Record<string, unknown>>
    const events = await collectStream(stream)

    const usageDelta = events.find(
      e =>
        e.type === 'message_delta' &&
        (e.usage as { input_tokens?: number } | undefined)?.input_tokens === 42,
    )
    expect(usageDelta).toBeDefined()
    expect((usageDelta!.usage as { output_tokens: number }).output_tokens).toBe(7)
  })
})

describe('openaiShim tool strict mode', () => {
  // A schema shaped like zod v4 output: additionalProperties:false everywhere,
  // partial `required` on nested objects (optional fields excluded), and a
  // top-level $schema meta key.
  const nestedOptionalSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      a: { type: 'string' },
      opts: {
        type: 'object',
        properties: { x: { type: 'string' }, y: { type: 'number' } },
        required: ['x'],
        additionalProperties: false,
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { p: { type: 'string' }, q: { type: 'boolean' } },
          required: ['p'],
          additionalProperties: false,
        },
      },
    },
    required: ['a'],
    additionalProperties: false,
  }

  const PREV_STRICT = process.env.CLAUDE_CODE_OPENAI_STRICT_TOOLS
  afterEach(() => {
    if (PREV_STRICT === undefined) {
      delete process.env.CLAUDE_CODE_OPENAI_STRICT_TOOLS
    } else {
      process.env.CLAUDE_CODE_OPENAI_STRICT_TOOLS = PREV_STRICT
    }
  })

  async function captureToolBody() {
    const { client, captured } = captureClient()
    await client.messages.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
      tools: [
        { name: 'demo', description: 'd', input_schema: nestedOptionalSchema },
      ],
    })
    const tool = (captured[0]!.body.tools as Array<Record<string, any>>)[0]!
    return tool
  }

  test('default: not strict, optional fields preserved at every level', async () => {
    delete process.env.CLAUDE_CODE_OPENAI_STRICT_TOOLS
    const tool = await captureToolBody()
    expect(tool.function.strict).toBeUndefined()
    const params = tool.function.parameters
    // Top-level optional `opts`/`items` are NOT forced into required.
    expect(params.required).toEqual(['a'])
    // Nested object's optional `y` stays optional.
    expect(params.properties.opts.required).toEqual(['x'])
    expect(params.properties.items.items.required).toEqual(['p'])
  })

  test('strict mode: every object lists all keys required + additionalProperties:false', async () => {
    process.env.CLAUDE_CODE_OPENAI_STRICT_TOOLS = '1'
    const tool = await captureToolBody()
    expect(tool.function.strict).toBe(true)
    const params = tool.function.parameters
    expect(new Set(params.required)).toEqual(new Set(['a', 'opts', 'items']))
    expect(params.additionalProperties).toBe(false)
    // Nested object inside properties.
    expect(new Set(params.properties.opts.required)).toEqual(new Set(['x', 'y']))
    expect(params.properties.opts.additionalProperties).toBe(false)
    // Object inside array items.
    expect(new Set(params.properties.items.items.required)).toEqual(
      new Set(['p', 'q']),
    )
    expect(params.properties.items.items.additionalProperties).toBe(false)
    // strict mode rejects the $schema meta keyword — it must be stripped.
    expect(params.$schema).toBeUndefined()
  })

  test('strict mode: anyOf branches are each normalized', async () => {
    process.env.CLAUDE_CODE_OPENAI_STRICT_TOOLS = '1'
    const { client, captured } = captureClient()
    await client.messages.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
      tools: [
        {
          name: 'u',
          description: 'd',
          input_schema: {
            type: 'object',
            properties: {
              choice: {
                anyOf: [
                  {
                    type: 'object',
                    properties: { kind: { type: 'string' }, note: { type: 'string' } },
                    required: ['kind'],
                    additionalProperties: false,
                  },
                ],
              },
            },
            required: ['choice'],
            additionalProperties: false,
          },
        },
      ],
    })
    const tool = (captured[0]!.body.tools as Array<Record<string, any>>)[0]!
    const branch = tool.function.parameters.properties.choice.anyOf[0]
    expect(new Set(branch.required)).toEqual(new Set(['kind', 'note']))
    expect(branch.additionalProperties).toBe(false)
  })

  test('strict mode: dictionary-typed object is closed to additionalProperties:false', async () => {
    process.env.CLAUDE_CODE_OPENAI_STRICT_TOOLS = '1'
    const { client, captured } = captureClient()
    await client.messages.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
      tools: [
        {
          name: 'd',
          description: 'd',
          input_schema: {
            type: 'object',
            properties: {
              // z.record() shape: object with no `properties`, additionalProperties is a schema.
              map: {
                type: 'object',
                propertyNames: { type: 'string' },
                additionalProperties: { type: 'number' },
              },
            },
            required: ['map'],
            additionalProperties: false,
          },
        },
      ],
    })
    const params = (captured[0]!.body.tools as Array<Record<string, any>>)[0]!
      .function.parameters
    expect(params.properties.map.additionalProperties).toBe(false)
  })

  test('strict mode: array-form object type (["object","null"]) is normalized', async () => {
    process.env.CLAUDE_CODE_OPENAI_STRICT_TOOLS = '1'
    const { client, captured } = captureClient()
    await client.messages.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
      tools: [
        {
          name: 'a',
          description: 'd',
          input_schema: {
            type: 'object',
            properties: {
              node: {
                type: ['object', 'null'],
                properties: { k: { type: 'string' }, opt: { type: 'number' } },
                required: ['k'],
              },
            },
            required: ['node'],
            additionalProperties: false,
          },
        },
      ],
    })
    const node = (captured[0]!.body.tools as Array<Record<string, any>>)[0]!
      .function.parameters.properties.node
    expect(new Set(node.required)).toEqual(new Set(['k', 'opt']))
    expect(node.additionalProperties).toBe(false)
  })

  test('strict mode: strips root $schema but keeps properties literally named $id/$schema', async () => {
    process.env.CLAUDE_CODE_OPENAI_STRICT_TOOLS = '1'
    const { client, captured } = captureClient()
    await client.messages.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
      tools: [
        {
          name: 'p',
          description: 'd',
          input_schema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: {
              $id: { type: 'string' },
              $schema: { type: 'string' },
              normal: { type: 'string' },
            },
            required: ['$id'],
            additionalProperties: false,
          },
        },
      ],
    })
    const params = (captured[0]!.body.tools as Array<Record<string, any>>)[0]!
      .function.parameters
    // Root meta keyword stripped...
    expect(params.$schema).toBeUndefined()
    // ...but property names that merely look like meta keys survive.
    expect(params.properties.$id).toBeDefined()
    expect(params.properties.$schema).toBeDefined()
    expect(new Set(params.required)).toEqual(
      new Set(['$id', '$schema', 'normal']),
    )
  })
})

describe('retention opt-out', () => {
  test('sends store:false on the chat/completions body', async () => {
    const { client, captured } = captureClient()

    await client.messages.create({
      model: 'test-model',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
    })

    // `store` is an OpenAI field with no Anthropic equivalent, so this
    // transport is the only one where the privacy opt-out can be expressed.
    expect(captured[0]?.body.store).toBe(false)
  })

  test('CLAUDE_CODE_OPENAI_DISABLE_STORE drops the field entirely', async () => {
    const previous = process.env.CLAUDE_CODE_OPENAI_DISABLE_STORE
    process.env.CLAUDE_CODE_OPENAI_DISABLE_STORE = '1'
    try {
      const { client, captured } = captureClient()
      await client.messages.create({
        model: 'test-model',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hi' }],
      })
      // An endpoint that 400s on unknown fields has to be able to opt out.
      expect(captured[0]?.body).not.toHaveProperty('store')
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_CODE_OPENAI_DISABLE_STORE
      } else {
        process.env.CLAUDE_CODE_OPENAI_DISABLE_STORE = previous
      }
    }
  })
})

describe('openaiShim streaming tool_call translation', () => {
  function streamEvents(events: Array<Record<string, unknown>>) {
    return {
      starts: events.filter(e => e.type === 'content_block_start'),
      stops: events.filter(e => e.type === 'content_block_stop'),
      deltas: events.filter(e => e.type === 'content_block_delta'),
      messageDelta: events.find(e => e.type === 'message_delta') as
        | { delta?: { stop_reason?: string } }
        | undefined,
    }
  }

  test('id+name re-echoed on every delta stays one block, fully closed', async () => {
    const { client } = streamingCaptureClient([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'Read', arguments: '{"a":' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'Read', arguments: '1}' },
                },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ])
    const stream = await client.messages.create({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })
    const { starts, stops, deltas, messageDelta } = streamEvents(
      await collectStream(stream as AsyncIterable<Record<string, unknown>>),
    )

    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({
      content_block: { type: 'tool_use', id: 'call_1', name: 'Read' },
    })
    // The re-echoed arguments must accumulate on the same block, not fork it.
    expect(deltas).toHaveLength(2)
    expect(stops).toHaveLength(1)
    expect(messageDelta?.delta?.stop_reason).toBe('tool_use')
  })

  test('tool_call without an id gets a synthesized one instead of being dropped', async () => {
    const { client } = streamingCaptureClient([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  type: 'function',
                  function: { name: 'Grep', arguments: '{}' },
                },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ])
    const stream = await client.messages.create({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })
    const { starts, stops } = streamEvents(
      await collectStream(stream as AsyncIterable<Record<string, unknown>>),
    )

    expect(starts).toHaveLength(1)
    const block = starts[0]?.content_block as { id: string; name: string }
    expect(block.id).toMatch(/^toolu_/)
    expect(block.name).toBe('Grep')
    expect(stops).toHaveLength(1)
  })

  test('split id/name deltas buffer until the name arrives', async () => {
    const { client } = streamingCaptureClient([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9' }] } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { name: 'Read', arguments: '{"x":1}' } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ])
    const stream = await client.messages.create({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })
    const events = await collectStream(
      stream as AsyncIterable<Record<string, unknown>>,
    )
    const { starts, deltas } = streamEvents(events)

    // The block must open with the name — a nameless tool_use errors at
    // execution time when the model's call is looked up.
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({
      content_block: { type: 'tool_use', id: 'call_9', name: 'Read' },
    })
    // Arguments buffered before the name arrived are flushed after the start.
    expect(deltas[0]).toMatchObject({
      delta: { type: 'input_json_delta', partial_json: '{"x":1}' },
    })
  })
})

describe('openaiShim reasoning_content translation', () => {
  test('reasoning_content maps to thinking blocks, then text opens a new block', async () => {
    const { client } = streamingCaptureClient([
      { choices: [{ delta: { reasoning_content: 'thinking hard' } }] },
      { choices: [{ delta: { content: 'the answer' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ])
    const stream = await client.messages.create({
      model: 'deepseek-r1',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })
    const events = await collectStream(
      stream as AsyncIterable<Record<string, unknown>>,
    )
    const starts = events.filter(e => e.type === 'content_block_start')

    expect(starts[0]).toMatchObject({
      index: 0,
      content_block: { type: 'thinking' },
    })
    // No signature is forged — a forged one would be replayed and rejected
    // if the conversation ever went back to a first-party endpoint.
    expect((starts[0]?.content_block as { signature?: string }).signature).toBeUndefined()
    expect(starts[1]).toMatchObject({ index: 1, content_block: { type: 'text' } })
  })
})

describe('openaiShim SSE frame handling', () => {
  test('spaceless data: frames are parsed (SSE spec makes the space optional)', async () => {
    const fetchOverride = (async () => {
      const body =
        `data:${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\n` +
        `data:${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n` +
        'data:[DONE]\n\n'
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as unknown as typeof fetch
    const client = createOpenAIShimClient({
      apiKey: 'test-key',
      baseURL: 'https://api.example.test/v1',
      defaultHeaders: {},
      timeoutMs: 1000,
      fetchOverride,
    })
    const stream = await client.messages.create({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })
    const events = await collectStream(
      stream as AsyncIterable<Record<string, unknown>>,
    )

    expect(
      events.some(
        e =>
          e.type === 'content_block_delta' &&
          (e.delta as { text?: string }).text === 'hi',
      ),
    ).toBe(true)
    expect(events.some(e => e.type === 'message_stop')).toBe(true)
  })

  test('mid-stream error object throws so the caller falls back to retry', async () => {
    const { client } = streamingCaptureClient([
      { choices: [{ delta: { content: 'hi' } }] },
      { error: { message: 'upstream model unloaded' } },
    ])
    const stream = await client.messages.create({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })

    await expect(
      collectStream(stream as AsyncIterable<Record<string, unknown>>),
    ).rejects.toThrow('upstream model unloaded')
  })
})

describe('openaiShim tool_result translation', () => {
  test('non-text tool_result blocks become placeholders instead of empty strings', async () => {
    const { client, captured } = captureClient()
    await client.messages.create({
      model: 'test-model',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: [
                { type: 'text', text: 'see this' },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'aGVsbG8=',
                  },
                },
              ],
            },
          ],
        },
      ],
    })

    const toolMessage = (
      captured[0]?.body.messages as Array<{ role: string; content: string }>
    ).find(m => m.role === 'tool')
    expect(toolMessage?.content).toContain('see this')
    expect(toolMessage?.content).toContain('[image omitted')
  })
})
