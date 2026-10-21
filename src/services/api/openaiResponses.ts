// OpenAI Responses API transport for the OpenAI shim, used with Sign in with
// ChatGPT (plan usage reaches only /v1/responses). That route rejects
// max_output_tokens, temperature, top_p, metadata and previous_response_id,
// and requires store:false + stream:true, so none of those are sent.

// Reasoning items are replayed verbatim on later turns so the model keeps its
// chain of thought across tool calls. They ride in the thinking block's
// signature; the prefix keeps them apart from Anthropic signatures, which are
// dropped instead of being sent here.
const REASONING_SIGNATURE_PREFIX = 'openai-reasoning:'

const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

function toolResultText(block: { content?: unknown; is_error?: boolean }): string {
  const text = Array.isArray(block.content)
    ? block.content
        .map((c: { type?: string; text?: string }) =>
          c.text ?? (c.type && c.type !== 'text' ? `[${c.type} omitted: not supported by this provider]` : ''),
        )
        .join('\n')
    : typeof block.content === 'string'
      ? block.content
      : JSON.stringify(block.content ?? '')
  return block.is_error ? `Error: ${text}` : text
}

function userPart(block: Record<string, any>): Record<string, unknown> | null {
  if (block.type === 'text') {
    return block.text ? { type: 'input_text', text: block.text } : null
  }
  if (block.type === 'image') {
    const src = block.source
    if (src?.type === 'base64') {
      return { type: 'input_image', image_url: `data:${src.media_type};base64,${src.data}` }
    }
    if (src?.type === 'url') return { type: 'input_image', image_url: src.url }
    return null
  }
  return block.text ? { type: 'input_text', text: block.text } : null
}

function convertInput(
  messages: Array<{ role?: string; message?: { role?: string; content?: unknown }; content?: unknown }>,
): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = []
  for (const msg of messages) {
    const inner = msg.message ?? msg
    const role = (inner as { role?: string }).role ?? msg.role
    const content = (inner as { content?: unknown }).content
    const blocks: Array<Record<string, any>> =
      typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []

    if (role === 'user') {
      const parts: Array<Record<string, unknown>> = []
      for (const block of blocks) {
        if (block.type === 'tool_result') {
          input.push({ type: 'function_call_output', call_id: block.tool_use_id, output: toolResultText(block) })
        } else {
          const part = userPart(block)
          if (part) parts.push(part)
        }
      }
      if (parts.length > 0) input.push({ type: 'message', role: 'user', content: parts })
    } else if (role === 'assistant') {
      for (const block of blocks) {
        if (block.type === 'thinking' && block.signature?.startsWith(REASONING_SIGNATURE_PREFIX)) {
          try {
            input.push(JSON.parse(block.signature.slice(REASONING_SIGNATURE_PREFIX.length)))
          } catch {
            // Corrupt signature: drop the reasoning, keep the turn.
          }
        } else if (block.type === 'text' && block.text) {
          input.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: block.text }] })
        } else if (block.type === 'tool_use') {
          input.push({
            type: 'function_call',
            call_id: block.id,
            name: block.name,
            arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
          })
        }
      }
    }
  }
  return input
}

export function buildResponsesBody(options: {
  model: string
  instructions: string
  messages: Array<{ role?: string; message?: { role?: string; content?: unknown }; content?: unknown }>
  // Chat Completions shapes from the shim's converters.
  tools?: Array<{ type: 'function'; function: Record<string, unknown> }>
  toolChoice?: unknown
  effort?: unknown
  promptCacheKey?: string
  webSearch?: boolean
}): Record<string, unknown> {
  const toolChoice = options.toolChoice as { type?: string; function?: { name?: string } } | string | undefined
  return {
    model: options.model,
    ...(options.instructions ? { instructions: options.instructions } : {}),
    input: convertInput(options.messages),
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    reasoning: {
      summary: 'auto',
      ...(typeof options.effort === 'string' && EFFORT_LEVELS.has(options.effort) ? { effort: options.effort } : {}),
    },
    ...(options.tools?.length || options.webSearch
      ? {
          tools: [
            ...(options.tools ?? []).map(t => ({ type: 'function', ...t.function })),
            ...(options.webSearch ? [{ type: 'web_search' }] : []),
          ],
        }
      : {}),
    ...(toolChoice !== undefined
      ? {
          tool_choice:
            typeof toolChoice === 'object' && toolChoice?.function?.name
              ? { type: 'function', name: toolChoice.function.name }
              : toolChoice,
        }
      : {}),
    ...(options.promptCacheKey ? { prompt_cache_key: options.promptCacheKey } : {}),
  }
}

function convertUsage(usage: Record<string, any> | undefined) {
  const input = usage?.input_tokens ?? 0
  const cached = Math.min(input, Math.max(0, usage?.input_tokens_details?.cached_tokens ?? 0))
  return {
    input_tokens: input - cached,
    output_tokens: usage?.output_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
  }
}

// GPT models fill optional string arguments with "" instead of leaving them
// out, which tools then reject (Read's pages: "" fails validation and costs a
// round trip). Maps tool name → its optional parameter names.
export function optionalToolArgs(
  tools: Array<{ name: string; input_schema?: Record<string, unknown> }> | undefined,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const tool of tools ?? []) {
    const schema = tool.input_schema as { properties?: Record<string, unknown>; required?: string[] } | undefined
    const required = new Set(schema?.required ?? [])
    const optional = Object.keys(schema?.properties ?? {}).filter(key => !required.has(key))
    if (optional.length > 0) out.set(tool.name, new Set(optional))
  }
  return out
}

function dropEmptyOptionalArgs(args: string, optional: Set<string> | undefined): string {
  if (!optional) return args
  try {
    const parsed = JSON.parse(args)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return args
    let changed = false
    for (const key of optional) {
      if (parsed[key] === '') {
        delete parsed[key]
        changed = true
      }
    }
    return changed ? JSON.stringify(parsed) : args
  } catch {
    return args
  }
}

export async function* responsesStreamToAnthropic(
  response: Response,
  model: string,
  signal?: AbortSignal,
  optionalArgs: Map<string, Set<string>> = new Map(),
): AsyncGenerator<Record<string, unknown>> {
  yield {
    type: 'message_start',
    message: {
      id: `msg_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: convertUsage(undefined),
    },
  }

  const reader = response.body?.getReader()
  if (!reader) return
  const cancelReader = () => {
    reader.cancel().catch(() => {})
  }
  if (signal?.aborted) cancelReader()
  else signal?.addEventListener('abort', cancelReader, { once: true })

  // output_index → Anthropic block index, plus whether any delta streamed (some
  // items arrive whole in output_item.done with no deltas).
  const blocks = new Map<number, { index: number; streamed: boolean }>()
  let nextIndex = 0
  let sawToolCall = false
  // Hosted web_search calls surface as Anthropic server_tool_use blocks, and
  // the message's url_citation annotations as a web_search_tool_result for
  // the latest call, the shapes WebSearchTool reads.
  let lastSearchId: string | undefined
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
      if (!trimmed.startsWith('data:')) continue
      let event: Record<string, any>
      try {
        event = JSON.parse(trimmed.slice(5).trim())
      } catch {
        continue
      }
      const block = blocks.get(event.output_index)

      switch (event.type) {
        case 'response.output_item.added': {
          const item = event.item ?? {}
          const index = nextIndex++
          blocks.set(event.output_index, { index, streamed: false })
          if (item.type === 'reasoning') {
            yield { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } }
          } else if (item.type === 'function_call') {
            sawToolCall = true
            yield {
              type: 'content_block_start',
              index,
              content_block: { type: 'tool_use', id: item.call_id, name: item.name, input: {} },
            }
          } else if (item.type === 'web_search_call') {
            lastSearchId = item.id
            yield {
              type: 'content_block_start',
              index,
              content_block: { type: 'server_tool_use', id: item.id, name: 'web_search', input: {} },
            }
          } else {
            yield { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }
          }
          break
        }
        case 'response.reasoning_summary_part.added':
          if (block && event.summary_index > 0) {
            yield { type: 'content_block_delta', index: block.index, delta: { type: 'thinking_delta', thinking: '\n\n' } }
          }
          break
        case 'response.reasoning_summary_text.delta':
          if (block && event.delta) {
            yield { type: 'content_block_delta', index: block.index, delta: { type: 'thinking_delta', thinking: event.delta } }
          }
          break
        case 'response.output_text.delta':
          if (block && event.delta) {
            block.streamed = true
            yield { type: 'content_block_delta', index: block.index, delta: { type: 'text_delta', text: event.delta } }
          }
          break
        case 'response.function_call_arguments.delta':
          // Arguments are emitted whole at output_item.done, once they can be
          // parsed and cleaned.
          break
        case 'response.output_item.done': {
          if (!block) break
          const item = event.item ?? {}
          if (item.type === 'reasoning') {
            if (item.encrypted_content) {
              const { id: _id, status: _status, ...replayable } = item
              yield {
                type: 'content_block_delta',
                index: block.index,
                delta: {
                  type: 'signature_delta',
                  signature: REASONING_SIGNATURE_PREFIX + JSON.stringify(replayable),
                },
              }
            }
          } else if (item.type === 'function_call') {
            if (item.arguments) {
              yield {
                type: 'content_block_delta',
                index: block.index,
                delta: {
                  type: 'input_json_delta',
                  partial_json: dropEmptyOptionalArgs(item.arguments, optionalArgs.get(item.name)),
                },
              }
            }
          } else if (item.type === 'web_search_call') {
            const query = item.action?.query
            if (typeof query === 'string') {
              yield {
                type: 'content_block_delta',
                index: block.index,
                delta: { type: 'input_json_delta', partial_json: JSON.stringify({ query }) },
              }
            }
          } else if (!block.streamed) {
            const text = (item.content ?? []).map((c: { text?: string }) => c.text ?? '').join('')
            if (text) {
              yield { type: 'content_block_delta', index: block.index, delta: { type: 'text_delta', text } }
            }
          }
          yield { type: 'content_block_stop', index: block.index }
          if (item.type === 'message' && lastSearchId) {
            const seen = new Set<string>()
            const hits = (item.content ?? [])
              .flatMap((c: { annotations?: Array<Record<string, any>> }) => c.annotations ?? [])
              .filter((a: Record<string, any>) => a.type === 'url_citation' && typeof a.url === 'string' && !seen.has(a.url) && seen.add(a.url))
              .map((a: Record<string, any>) => ({ type: 'web_search_result', title: a.title ?? a.url, url: a.url }))
            if (hits.length > 0) {
              const index = nextIndex++
              yield {
                type: 'content_block_start',
                index,
                content_block: { type: 'web_search_tool_result', tool_use_id: lastSearchId, content: hits },
              }
              yield { type: 'content_block_stop', index }
            }
          }
          break
        }
        case 'response.completed':
        case 'response.incomplete': {
          const incomplete = event.type === 'response.incomplete'
          yield {
            type: 'message_delta',
            delta: {
              stop_reason:
                incomplete && event.response?.incomplete_details?.reason === 'max_output_tokens'
                  ? 'max_tokens'
                  : sawToolCall
                    ? 'tool_use'
                    : 'end_turn',
              stop_sequence: null,
            },
            usage: convertUsage(event.response?.usage),
          }
          yield { type: 'message_stop' }
          return
        }
        case 'response.failed':
        case 'error': {
          const error = event.response?.error ?? event.error ?? event
          throw new Error(
            `OpenAI Responses error${error?.code ? ` (${error.code})` : ''}: ${error?.message ?? 'request failed'}`,
          )
        }
      }
    }
  }
  // Ending without a terminal event means the stream was cut; leave it
  // unfinished rather than reporting a complete turn.
}

/** Drains converted stream events into one Anthropic-shaped message. */
export async function collectAnthropicMessage(
  events: AsyncIterable<Record<string, any>>,
): Promise<Record<string, unknown>> {
  let message: Record<string, any> | undefined
  const content: Array<Record<string, any>> = []
  const partialJson = new Map<number, string>()
  for await (const event of events) {
    switch (event.type) {
      case 'message_start':
        message = { ...event.message }
        break
      case 'content_block_start':
        content[event.index] = { ...event.content_block }
        break
      case 'content_block_delta': {
        const block = content[event.index]
        const delta = event.delta
        if (!block) break
        if (delta.type === 'text_delta') block.text += delta.text
        else if (delta.type === 'thinking_delta') block.thinking += delta.thinking
        else if (delta.type === 'signature_delta') block.signature = delta.signature
        else if (delta.type === 'input_json_delta') {
          partialJson.set(event.index, (partialJson.get(event.index) ?? '') + delta.partial_json)
        }
        break
      }
      case 'message_delta':
        message!.stop_reason = event.delta.stop_reason
        message!.usage = event.usage
        break
    }
  }
  for (const [index, json] of partialJson) {
    const block = content[index]
    if (!block) continue
    try {
      block.input = JSON.parse(json)
    } catch {
      block.input = { raw: json }
    }
  }
  if (!message?.stop_reason) {
    throw new Error('OpenAI Responses stream ended before completion')
  }
  return { ...message, content: content.filter(Boolean) }
}
