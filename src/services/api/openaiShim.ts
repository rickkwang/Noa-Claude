// @ts-nocheck
import {
  classifyOpenAICompatibleError,
  resolveMaxTokensParam,
} from './openaiCompatibleHelpers.js';

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

type OpenAITool = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
    strict?: boolean
  }
}

type OpenAIStreamChunk = {
  id: string
  model?: string
  choices?: Array<{
    delta: {
      role?: string
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
}

type AnthropicLikeMessage = {
  id: string
  type: 'message'
  role: 'assistant'
  content: Array<Record<string, unknown>>
  model: string
  stop_reason: 'tool_use' | 'max_tokens' | 'end_turn' | null
  stop_sequence: null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  }
}

function makeMessageId(): string {
  return `msg_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

function convertSystemPrompt(system: unknown): string {
  if (!system) return ''
  if (typeof system === 'string') return system
  if (Array.isArray(system)) {
    return system
      .map((block: { type?: string; text?: string }) =>
        block.type === 'text' ? block.text ?? '' : '',
      )
      .join('\n\n')
  }
  return String(system)
}

function convertContentBlocks(
  content: unknown,
): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')

  const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
        parts.push({ type: 'text', text: block.text ?? '' })
        break
      case 'image': {
        const src = block.source
        if (src?.type === 'base64') {
          parts.push({
            type: 'image_url',
            image_url: {
              url: `data:${src.media_type};base64,${src.data}`,
            },
          })
        } else if (src?.type === 'url') {
          parts.push({ type: 'image_url', image_url: { url: src.url } })
        }
        break
      }
      case 'thinking':
        if (block.thinking) {
          parts.push({ type: 'text', text: `<thinking>${block.thinking}</thinking>` })
        }
        break
      default:
        if (block.text) {
          parts.push({ type: 'text', text: block.text })
        }
    }
  }

  if (parts.length === 0) return ''
  if (parts.length === 1 && parts[0]!.type === 'text') return parts[0]!.text ?? ''
  return parts
}

function convertMessages(
  messages: Array<{ role: string; message?: { role?: string; content?: unknown }; content?: unknown }>,
  system: unknown,
): OpenAIMessage[] {
  const result: OpenAIMessage[] = []
  const sysText = convertSystemPrompt(system)
  if (sysText) {
    result.push({ role: 'system', content: sysText })
  }

  for (const msg of messages) {
    const inner = msg.message ?? msg
    const role = (inner as { role?: string }).role ?? msg.role
    const content = (inner as { content?: unknown }).content

    if (role === 'user') {
      if (Array.isArray(content)) {
        const toolResults = content.filter((b: { type?: string }) => b.type === 'tool_result')
        const otherContent = content.filter((b: { type?: string }) => b.type !== 'tool_result')

        for (const tr of toolResults) {
          const trContent = Array.isArray(tr.content)
            ? tr.content.map((c: { text?: string }) => c.text ?? '').join('\n')
            : typeof tr.content === 'string'
              ? tr.content
              : JSON.stringify(tr.content ?? '')
          result.push({
            role: 'tool',
            tool_call_id: tr.tool_use_id ?? 'unknown',
            content: tr.is_error ? `Error: ${trContent}` : trContent,
          })
        }

        if (otherContent.length > 0) {
          result.push({ role: 'user', content: convertContentBlocks(otherContent) })
        }
      } else {
        result.push({ role: 'user', content: convertContentBlocks(content) })
      }
    } else if (role === 'assistant') {
      if (Array.isArray(content)) {
        const toolUses = content.filter((b: { type?: string }) => b.type === 'tool_use')
        const textContent = content.filter(
          (b: { type?: string }) => b.type !== 'tool_use' && b.type !== 'thinking',
        )
        const assistantMsg: OpenAIMessage = {
          role: 'assistant',
          content: convertContentBlocks(textContent) as string,
        }
        if (toolUses.length > 0) {
          assistantMsg.tool_calls = toolUses.map(
            (tu: {
              id?: string
              name?: string
              input?: unknown
            }) => ({
              id: tu.id ?? `call_${Math.random().toString(36).slice(2)}`,
              type: 'function' as const,
              function: {
                name: tu.name ?? 'unknown',
                arguments:
                  typeof tu.input === 'string' ? tu.input : JSON.stringify(tu.input ?? {}),
              },
            }),
          )
        }
        result.push(assistantMsg)
      } else {
        result.push({ role: 'assistant', content: convertContentBlocks(content) as string })
      }
    }
  }

  return result
}

function normalizeSchemaForOpenAI(
  schema: Record<string, unknown>,
  strict = true,
): Record<string, unknown> {
  if (schema.type !== 'object' || !schema.properties) return schema
  const properties = schema.properties as Record<string, unknown>
  const existingRequired = Array.isArray(schema.required) ? (schema.required as string[]) : []
  if (strict) {
    const allKeys = Object.keys(properties)
    const required = Array.from(new Set([...existingRequired, ...allKeys]))
    return { ...schema, required }
  }
  const required = existingRequired.filter(k => k in properties)
  return { ...schema, required }
}

function convertTools(
  tools: Array<{ name: string; description?: string; input_schema?: Record<string, unknown> }>,
): OpenAITool[] {
  return tools
    .filter(t => t.name !== 'ToolSearchTool')
    .map(t => {
      const schema = { ...(t.input_schema ?? { type: 'object', properties: {} }) } as Record<
        string,
        unknown
      >
      return {
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description ?? '',
          parameters: normalizeSchemaForOpenAI(schema, true),
          strict: true,
        },
      }
    })
}

function convertChunkUsage(
  usage: OpenAIStreamChunk['usage'] | undefined,
): AnthropicLikeMessage['usage'] | undefined {
  if (!usage) return undefined
  return {
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
}

async function* openaiStreamToAnthropic(
  response: Response,
  model: string,
): AsyncGenerator<Record<string, unknown>> {
  const messageId = makeMessageId()
  let contentBlockIndex = 0
  const activeToolCalls = new Map<number, { id: string; name: string; index: number }>()
  let hasEmittedContentStart = false
  let lastStopReason: 'tool_use' | 'max_tokens' | 'end_turn' | null = null
  let hasEmittedFinalUsage = false
  let hasProcessedFinishReason = false

  yield {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  }

  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'data: [DONE]') continue
      if (!trimmed.startsWith('data: ')) continue

      let chunk: OpenAIStreamChunk
      try {
        chunk = JSON.parse(trimmed.slice(6))
      } catch {
        continue
      }

      const chunkUsage = convertChunkUsage(chunk.usage)

      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta

        if (delta.content != null) {
          if (!hasEmittedContentStart) {
            yield {
              type: 'content_block_start',
              index: contentBlockIndex,
              content_block: { type: 'text', text: '' },
            }
            hasEmittedContentStart = true
          }
          yield {
            type: 'content_block_delta',
            index: contentBlockIndex,
            delta: { type: 'text_delta', text: delta.content },
          }
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.id && tc.function?.name) {
              if (hasEmittedContentStart) {
                yield { type: 'content_block_stop', index: contentBlockIndex }
                contentBlockIndex++
                hasEmittedContentStart = false
              }

              const toolBlockIndex = contentBlockIndex
              activeToolCalls.set(tc.index, {
                id: tc.id,
                name: tc.function.name,
                index: toolBlockIndex,
              })

              yield {
                type: 'content_block_start',
                index: toolBlockIndex,
                content_block: {
                  type: 'tool_use',
                  id: tc.id,
                  name: tc.function.name,
                  input: {},
                },
              }
              contentBlockIndex++

              if (tc.function.arguments) {
                yield {
                  type: 'content_block_delta',
                  index: toolBlockIndex,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: tc.function.arguments,
                  },
                }
              }
            } else if (tc.function?.arguments) {
              const active = activeToolCalls.get(tc.index)
              if (active) {
                yield {
                  type: 'content_block_delta',
                  index: active.index,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: tc.function.arguments,
                  },
                }
              }
            }
          }
        }

        if (choice.finish_reason && !hasProcessedFinishReason) {
          hasProcessedFinishReason = true
          if (hasEmittedContentStart) {
            yield { type: 'content_block_stop', index: contentBlockIndex }
          }
          for (const [, tc] of activeToolCalls) {
            yield { type: 'content_block_stop', index: tc.index }
          }
          const stopReason =
            choice.finish_reason === 'tool_calls'
              ? 'tool_use'
              : choice.finish_reason === 'length'
                ? 'max_tokens'
                : 'end_turn'
          lastStopReason = stopReason
          yield {
            type: 'message_delta',
            delta: { stop_reason: stopReason, stop_sequence: null },
            ...(chunkUsage ? { usage: chunkUsage } : {}),
          }
          if (chunkUsage) {
            hasEmittedFinalUsage = true
          }
        }
      }

      if (
        !hasEmittedFinalUsage &&
        chunkUsage &&
        (chunk.choices?.length ?? 0) === 0
      ) {
        yield {
          type: 'message_delta',
          delta: { stop_reason: lastStopReason, stop_sequence: null },
          usage: chunkUsage,
        }
        hasEmittedFinalUsage = true
      }
    }
  }

  // Handle any leftover data in buffer (incomplete JSON from early disconnect)
  const leftover = buffer.trim()
  if (leftover && leftover !== 'data: [DONE]' && leftover.startsWith('data: ')) {
    try {
      JSON.parse(leftover.slice(6))
    } catch {
      // Incomplete JSON — log warning but don't crash
      console.error('[OpenAI Shim] Incomplete chunk in stream buffer, discarding:', leftover.slice(0, 100))
    }
  }

  yield { type: 'message_stop' }
}

class OpenAIShimStream {
  controller = new AbortController()

  constructor(private generator: AsyncGenerator<Record<string, unknown>>) {}

  async *[Symbol.asyncIterator]() {
    yield* this.generator
  }
}

class OpenAIShimMessages {
  constructor(private config: {
    apiKey?: string
    baseURL: string
    defaultHeaders: Record<string, string>
    timeoutMs: number
    fetchOverride?: typeof fetch
  }) {}

  create(
    params: {
      model: string
      messages: Array<{ role: string; message?: { role?: string; content?: unknown }; content?: unknown }>
      system?: unknown
      tools?: Array<{ name: string; description?: string; input_schema?: Record<string, unknown> }>
      tool_choice?: unknown
      output_config?: unknown
      max_tokens?: number
      temperature?: number
      stream?: boolean
      stop_sequences?: string[]
      metadata?: Record<string, unknown>
      thinking?: unknown
    },
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) {
    const promise = (async () => {
      const response = await this._doRequest(params, options)
      if (params.stream) {
        return new OpenAIShimStream(
          openaiStreamToAnthropic(response, params.model),
        )
      }

      const data = await response.json()
      return this._convertNonStreamingResponse(data, params.model)
    })()

    ;(promise as unknown as Record<string, unknown>).withResponse = async () => {
      const data = await promise
      return { data, response: new Response(), request_id: makeMessageId() }
    }

    return promise as Promise<AnthropicLikeMessage | OpenAIShimStream> & {
      withResponse: () => Promise<{
        data: AnthropicLikeMessage | OpenAIShimStream
        response: Response
        request_id: string
      }>
    }
  }

  private async _doRequest(
    params: {
      model: string
      messages: Array<{ role: string; message?: { role?: string; content?: unknown }; content?: unknown }>
      system?: unknown
      tools?: Array<{ name: string; description?: string; input_schema?: Record<string, unknown> }>
      tool_choice?: unknown
      output_config?: unknown
      max_tokens?: number
      temperature?: number
      stream?: boolean
      stop_sequences?: string[]
      metadata?: Record<string, unknown>
      thinking?: unknown
    },
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.defaultHeaders,
      ...(options?.headers ?? {}),
    }

    const apiKey = this.config.apiKey ?? process.env.OPENAI_API_KEY ?? ''
    if (apiKey && !headers['x-goog-api-key']) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    const body: Record<string, unknown> = {
      model: params.model,
      messages: convertMessages(params.messages, params.system),
      stream: !!params.stream,
      ...(params.max_tokens !== undefined
        ? {
            [resolveMaxTokensParam(this.config.baseURL)]: params.max_tokens,
          }
        : {}),
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      ...(params.stop_sequences ? { stop: params.stop_sequences } : {}),
      ...(params.tools ? { tools: convertTools(params.tools) } : {}),
      ...(params.tool_choice ? { tool_choice: params.tool_choice } : {}),
      ...(params.output_config ? { response_format: params.output_config } : {}),
      ...(params.metadata ? { metadata: params.metadata } : {}),
    }

    const baseURL = this.config.baseURL.replace(/\/+$/, '')
    const chatCompletionsUrl = `${baseURL}/chat/completions`
    const fetchImpl = this.config.fetchOverride ?? globalThis.fetch
    const response = await fetchImpl(chatCompletionsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options?.signal,
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown error')
      const classification = classifyOpenAICompatibleError(
        response.status,
        errorBody,
      )
      throw new Error(`${classification} Response: ${errorBody}`)
    }

    return response
  }

  private _convertNonStreamingResponse(
    data: {
      id?: string
      model?: string
      choices?: Array<{
        message?: {
          role?: string
          content?: string | null
          tool_calls?: Array<{
            id: string
            function: { name: string; arguments: string }
          }>
        }
        finish_reason?: string
      }>
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
      }
    },
    model: string,
  ): AnthropicLikeMessage {
    const choice = data.choices?.[0]
    const content: Array<Record<string, unknown>> = []

    if (choice?.message?.content) {
      content.push({ type: 'text', text: choice.message.content })
    }

    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let input: unknown
        try {
          input = JSON.parse(tc.function.arguments)
        } catch {
          input = { raw: tc.function.arguments }
        }
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input,
        })
      }
    }

    const stopReason =
      choice?.finish_reason === 'tool_calls'
        ? 'tool_use'
        : choice?.finish_reason === 'length'
          ? 'max_tokens'
          : 'end_turn'

    return {
      id: data.id ?? makeMessageId(),
      type: 'message',
      role: 'assistant',
      content,
      model: data.model ?? model,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: data.usage?.prompt_tokens ?? 0,
        output_tokens: data.usage?.completion_tokens ?? 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    }
  }
}

export function createOpenAIShimClient(config: {
  apiKey?: string
  baseURL: string
  defaultHeaders: Record<string, string>
  timeoutMs: number
  fetchOverride?: typeof fetch
}) {
  const messages = new OpenAIShimMessages(config)
  return {
    messages,
    beta: { messages },
    models: {
      async *list() {
        return
      },
    },
  }
}
