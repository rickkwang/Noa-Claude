// @ts-nocheck
import { APIError } from '@anthropic-ai/sdk'
import { logForDebugging } from '../../utils/debug.js'
import { logError } from '../../utils/log.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
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

/**
 * Map Anthropic effort levels to OpenAI Chat Completions `reasoning_effort`.
 * OpenAI accepts: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null
 * Gemini OpenAI-compat accepts the same field with low/medium/high/minimal/none.
 *
 * `max` is Anthropic-only. In the normal flow it never reaches here:
 * getSupportedEffortLevelsForModel omits 'max' for openaiCompatible providers,
 * so resolveAppliedEffort clamps a requested 'max' down to 'xhigh' before the
 * request is built. We still map it to 'xhigh' (the highest portable level,
 * matching that clamp) to stay consistent if 'max' is ever injected directly
 * via CLAUDE_CODE_EXTRA_BODY.
 */
function mapAnthropicEffortToOpenAI(
  effort: string,
): 'low' | 'medium' | 'high' | 'xhigh' | undefined {
  switch (effort) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return effort
    case 'max':
      return 'xhigh'
    default:
      return undefined
  }
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

// JSON Schema meta keywords OpenAI rejects inside a strict-mode function schema.
const STRICT_UNSUPPORTED_KEYS = new Set(['$schema', '$id'])

/**
 * Recursively rewrite a JSON Schema into the subset OpenAI accepts in strict
 * function-calling mode: every object must list ALL of its properties in
 * `required` and set `additionalProperties: false`, at every level (nested
 * objects, array items, and anyOf/oneOf/allOf branches). The previous
 * implementation only touched the top-level `required`, so any tool with a
 * nested optional field (SendMessageTool, and most MCP tools) produced a schema
 * OpenAI/Azure reject with a 400 under strict mode.
 *
 * Optional fields are forced required rather than widened to nullable: tools are
 * written against the Anthropic API where "optional" means "absent", so making
 * the model emit a typed value is safer than letting it send explicit `null`.
 * The cost is that optional params become mandatory under strict mode — which is
 * why strict is opt-in (CLAUDE_CODE_OPENAI_STRICT_TOOLS) rather than the default.
 */
function normalizeSchemaForStrict(node: unknown, isRoot = true): unknown {
  if (Array.isArray(node)) {
    return node.map(item => normalizeSchemaForStrict(item, false))
  }
  if (!node || typeof node !== 'object') {
    return node
  }
  const schema = node as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    // Only strip meta keywords at the schema root — zod emits `$schema` there.
    // Deeper down these names can be real property names inside a `properties`
    // map, which must be preserved.
    if (isRoot && STRICT_UNSUPPORTED_KEYS.has(key)) continue
    out[key] = normalizeSchemaForStrict(value, false)
  }
  // Any object node (including array-form `type: ['object', 'null']` and
  // dictionary objects that carry no `properties`) must be closed under strict
  // mode: list every declared property as required and forbid extras. Open
  // dictionaries have no strict-valid form, so they collapse to a closed empty
  // object — degenerate but accepted, where leaving the schema untouched 400s.
  const type = out.type
  if (type === 'object' || (Array.isArray(type) && type.includes('object'))) {
    const props = out.properties
    out.required =
      props && typeof props === 'object' ? Object.keys(props) : []
    out.additionalProperties = false
  }
  return out
}

function convertTools(
  tools: Array<{ name: string; description?: string; input_schema?: Record<string, unknown> }>,
  strictMode: boolean,
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
          // Default (non-strict): pass the schema through unchanged. zod already
          // emits valid `required`/`additionalProperties`, and every
          // OpenAI-compatible provider accepts non-strict function schemas, so
          // honest optionality is preserved across all providers. Strict mode is
          // an opt-in reliability tweak for OpenAI/Azure.
          parameters: strictMode
            ? (normalizeSchemaForStrict(schema) as Record<string, unknown>)
            : schema,
          ...(strictMode ? { strict: true } : {}),
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
      logError(new Error('[OpenAI Shim] Incomplete chunk in stream buffer, discarding'))
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

    if (params.thinking !== undefined) {
      // Anthropic-style thinking has no portable OpenAI equivalent. Drop it
      // explicitly and log so callers see why extended reasoning isn't
      // happening on this provider.
      logForDebugging(
        `[openaiShim] thinking parameter dropped (not supported on OpenAI-compatible endpoint at ${this.config.baseURL})`,
        { level: 'warn' },
      )
    }

    // Anthropic output_config is {format, effort, task_budget}. We translate
    // `effort` → top-level `reasoning_effort` (the field name accepted by both
    // OpenAI Chat Completions and Gemini's OpenAI-compat endpoint) when the
    // user opts in via CLAUDE_CODE_OPENAI_REASONING_EFFORT (any truthy value
    // accepted by isEnvTruthy, matching the capability gate in effort.ts).
    // `format` and `task_budget` have no portable OpenAI equivalent and are
    // dropped.
    let reasoningEffort: string | undefined
    if (params.output_config !== undefined) {
      const outputConfig = params.output_config as Record<string, unknown>
      if (
        isEnvTruthy(process.env.CLAUDE_CODE_OPENAI_REASONING_EFFORT) &&
        typeof outputConfig.effort === 'string'
      ) {
        reasoningEffort = mapAnthropicEffortToOpenAI(outputConfig.effort)
      }
      const droppedKeys = Object.keys(outputConfig).filter(
        k => k !== 'effort' || reasoningEffort === undefined,
      )
      if (droppedKeys.length > 0) {
        logForDebugging(
          `[openaiShim] output_config keys dropped: ${droppedKeys.join(', ')} (not portable to OpenAI shape at ${this.config.baseURL})`,
          { level: 'warn' },
        )
      }
    }

    const body: Record<string, unknown> = {
      model: params.model,
      messages: convertMessages(params.messages, params.system),
      stream: !!params.stream,
      // OpenAI (and OpenAI-compatible endpoints) omit token usage from the
      // streamed response unless usage reporting is explicitly requested. Without
      // this the final usage-only chunk never arrives, so cost/token tracking
      // reports zero for every streamed turn. The field is part of the OpenAI
      // spec; the rare endpoint that rejects it can opt out via
      // CLAUDE_CODE_OPENAI_DISABLE_STREAM_USAGE.
      ...(params.stream &&
      !isEnvTruthy(process.env.CLAUDE_CODE_OPENAI_DISABLE_STREAM_USAGE)
        ? { stream_options: { include_usage: true } }
        : {}),
      ...(params.max_tokens !== undefined
        ? {
            [resolveMaxTokensParam(this.config.baseURL)]: params.max_tokens,
          }
        : {}),
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      ...(params.stop_sequences ? { stop: params.stop_sequences } : {}),
      ...(params.tools
        ? {
            tools: convertTools(
              params.tools,
              isEnvTruthy(process.env.CLAUDE_CODE_OPENAI_STRICT_TOOLS),
            ),
          }
        : {}),
      ...(params.tool_choice ? { tool_choice: params.tool_choice } : {}),
      ...(params.metadata ? { metadata: params.metadata } : {}),
      ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
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
      // Don't echo the raw response body to the user — providers sometimes
      // include sensitive context (request IDs, key fragments, internal
      // paths) in 5xx/429 bodies. Pull out the structured error.message
      // when the body is well-formed JSON; otherwise show just the
      // classification.
      let structuredMessage: string | undefined
      try {
        const parsed = JSON.parse(errorBody)
        const candidate =
          (typeof parsed?.error?.message === 'string' && parsed.error.message) ||
          (typeof parsed?.message === 'string' && parsed.message) ||
          undefined
        if (candidate) structuredMessage = candidate
      } catch {
        // not JSON — fall through, show classification only
      }
      const message = structuredMessage
        ? `${classification} ${structuredMessage}`
        : classification
      // Throw an APIError-shaped error so upstream `instanceof APIError`
      // checks (claude.ts retry/logging paths) can read .status, .headers,
      // and .requestID instead of falling through to the plain-Error branch
      // and losing those fields.
      throw new APIError(
        response.status,
        { message, error: { type: 'api_error', message: classification } },
        message,
        // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
        new globalThis.Headers(response.headers),
      )
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
