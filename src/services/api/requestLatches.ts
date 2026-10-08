import { APIError } from '@anthropic-ai/sdk'
import { getMaxThinkingTokensForModel } from '../../utils/context.js'
import { logForDebugging } from '../../utils/debug.js'
import { getAPIProvider } from '../../utils/model/providers.js'

// Request fields an endpoint rejected with a 400, per provider, base URL and
// model, for the rest of the process. Requests leave them out from then on, so
// a model or an Anthropic-compatible proxy that lacks a feature degrades
// instead of failing every request. Only optional fields qualify: never
// messages, tools or model.
const rejectedFields = new Map<string, Set<string>>()
const sentBetas = new Map<string, readonly string[]>()

const OPTIONAL_ROOTS = new Set([
  'thinking',
  'output_config',
  'context_management',
  'speed',
  'metadata',
  'temperature',
  'top_p',
  'top_k',
])

export function getRequestLatchSummary(): string {
  return [...rejectedFields].flatMap(([key, fields]) => {
    const model = key.slice(key.lastIndexOf('|') + 1)
    return key === endpointKey(model) ? [`${model}: ${[...fields].join(', ')}`] : []
  }).join('; ')
}

function endpointKey(model: string): string {
  const provider = getAPIProvider()
  const baseUrl = provider === 'openaiCompatible' ? process.env.OPENAI_BASE_URL : process.env.ANTHROPIC_BASE_URL
  return `${provider}|${baseUrl ?? ''}|${model}`
}

export function classifyRejectedField(
  message: string,
  betas: readonly string[],
): string | undefined {
  const lower = message.toLowerCase()
  const thinkingType =
    /thinking\.type[^a-z]{1,8}(enabled|adaptive)[^]*?not supported/i.exec(message) ??
    /\b(adaptive) thinking is not supported/i.exec(message)
  if (thinkingType) return `thinking.type:${thinkingType[1]!.toLowerCase()}`
  // Only the parameter itself: a rejected effort *value* is not a missing field.
  if (
    (lower.includes('effort parameter') && lower.includes('not support')) ||
    lower.includes('output_config.effort: extra inputs are not permitted') ||
    lower.includes('requires a model that supports per-turn effort')
  ) {
    return 'output_config.effort'
  }
  const thinkingField = /thinking\.(?:adaptive|enabled)\.(display|block_binding)\b/.exec(message)
  if (thinkingField) return `thinking.${thinkingField[1]}`
  if (/anthropic[-_]beta/.test(message)) {
    const beta = betas.find(b => message.includes(b))
    if (beta) return `beta:${beta}`
  }
  if (
    lower.includes('cache_control') &&
    /not permitted|cannot be set|unknown (?:name|field)|unrecognized|additional propert|not supported/.test(lower)
  ) {
    return /\bttl\b/.test(lower) ? 'cache_control.ttl' : 'cache_control'
  }
  const named =
    /\b([a-z_]+(?:\.[a-z_]+)?): Extra inputs are not permitted/.exec(message) ??
    /unknown field [`'"]?([a-z_]+(?:\.[a-z_]+)?)/i.exec(message) ??
    /Unrecognized request arguments? supplied: ([a-z_]+)/i.exec(message)
  const field = named?.[1]
  return field && OPTIONAL_ROOTS.has(field.split('.')[0]!) ? field : undefined
}

// Returns the newly rejected field, or undefined when the error is not a
// field rejection or that field is already left out (retrying cannot help).
export function healRejectedRequest(
  error: unknown,
  model: string,
): string | undefined {
  if (!(error instanceof APIError) || error.status !== 400) return undefined
  const key = endpointKey(model)
  const field = classifyRejectedField(error.message, sentBetas.get(key) ?? [])
  if (!field) return undefined
  const fields = rejectedFields.get(key) ?? new Set<string>()
  if (fields.has(field)) return undefined
  fields.add(field)
  rejectedFields.set(key, fields)
  logForDebugging(
    `[request-latch] ${model} rejected ${field}; leaving it out for the rest of the session and retrying`,
    { level: 'warn' },
  )
  return field
}

function stripCacheControl<T>(blocks: T, ttlOnly = false): T {
  if (!Array.isArray(blocks)) return blocks
  return blocks.map(block => {
    if (!block || typeof block !== 'object' || !('cache_control' in block)) return block
    if (ttlOnly) {
      const control = (block as Record<string, any>).cache_control
      if (!control || typeof control !== 'object' || !('ttl' in control)) return block
      const { ttl: _, ...rest } = control
      return { ...block, cache_control: rest }
    }
    const { cache_control: _, ...rest } = block as Record<string, unknown>
    return rest
  }) as T
}

function rewriteThinking(
  thinking: Record<string, unknown> | undefined,
  fields: Set<string>,
  maxTokens: number,
  model: string,
): Record<string, unknown> | undefined {
  if (!thinking) return thinking
  if (fields.has('thinking.type:adaptive') && fields.has('thinking.type:enabled')) return undefined
  if (thinking.type === 'adaptive' && fields.has('thinking.type:adaptive')) {
    return {
      type: 'enabled',
      budget_tokens: Math.min(maxTokens - 1, getMaxThinkingTokensForModel(model)),
    }
  }
  if (thinking.type === 'enabled' && fields.has('thinking.type:enabled')) {
    return { type: 'adaptive' }
  }
  return thinking
}

export function applyRequestLatches<T extends object>(params: T, model: string): T {
  const key = endpointKey(model)
  const fields = rejectedFields.get(key)
  const out = { ...params } as Record<string, any>
  if (fields) {
    out.thinking = rewriteThinking(out.thinking, fields, out.max_tokens, model)
    if (out.thinking === undefined) delete out.thinking
    for (const field of fields) {
      if (field.startsWith('thinking.type:')) continue
      if (field.startsWith('beta:')) {
        out.betas = out.betas?.filter((beta: string) => beta !== field.slice(5))
      } else if (field === 'cache_control' || field === 'cache_control.ttl') {
        const ttlOnly = field === 'cache_control.ttl'
        out.system = stripCacheControl(out.system, ttlOnly)
        out.tools = stripCacheControl(out.tools, ttlOnly)
        out.messages = out.messages?.map((m: Record<string, unknown>) => ({
          ...m,
          content: stripCacheControl(m.content, ttlOnly),
        }))
      } else {
        const [root, leaf] = field.split('.') as [string, string | undefined]
        if (!leaf) {
          delete out[root]
        } else if (out[root] && typeof out[root] === 'object') {
          const { [leaf]: _, ...rest } = out[root]
          if (Object.keys(rest).length > 0) out[root] = rest
          else delete out[root]
        }
      }
    }
    if (out.betas?.length === 0) delete out.betas
  }
  sentBetas.set(key, out.betas ?? [])
  return out as T
}
