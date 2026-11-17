import axios from 'axios'
import { logForDebugging } from '../debug.js'
import { DISCOVERED_MODEL_DESCRIPTION, type ModelOption } from './modelOptions.js'
import { getOpenAIModelDiscoveryBaseUrl, getOpenAIModelDiscoveryScope } from './providerModels.js'
import { getAPIProvider } from './providers.js'
import type { ProviderType } from '../providerProfile.js'

const DISCOVERY_TIMEOUT_MS = 5000

type OpenAIModelsResponse = {
  data?: Array<{
    id?: string | null
    context_length?: number
    max_input_tokens?: number
  }>
  // Sign in with ChatGPT lists the account's models here instead.
  models?: Array<{
    slug?: string | null
    visibility?: string | null
    context_window?: number
    max_context_window?: number
  }>
}

type OllamaTagsResponse = {
  models?: Array<{
    name?: string | null
  }>
}

export type ProviderModelDiscoveryRequest = {
  type: ProviderType
  baseUrl: string
  apiKey?: string
}

function readTrimmedEnv(
  ...keys: Array<keyof NodeJS.ProcessEnv>
): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return undefined
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function isAzureOpenAIBaseUrl(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    return (
      hostname.endsWith('.openai.azure.com') ||
      hostname.endsWith('.cognitiveservices.azure.com')
    )
  } catch {
    return false
  }
}

function getModelListUrls(baseUrl: string): string[] {
  if (isAzureOpenAIBaseUrl(baseUrl)) {
    // Azure OpenAI uses a different endpoint structure for model discovery.
    // Standard OpenAI /v1/models is not available on deployment-scoped URLs.
    return []
  }

  const primary = baseUrl.endsWith('/v1')
    ? `${baseUrl}/models`
    : `${baseUrl}/v1/models`
  const secondary = `${baseUrl}/models`

  const apiVersion = readTrimmedEnv('OPENAI_API_VERSION')
  const addApiVersion =
    apiVersion && isAzureOpenAIBaseUrl(baseUrl)
      ? (url: string): string => {
          try {
            const parsed = new URL(url)
            parsed.searchParams.set('api-version', apiVersion)
            return parsed.toString()
          } catch {
            return url
          }
        }
      : (url: string): string => url

  if (primary === secondary) {
    return [addApiVersion(primary)]
  }
  return [addApiVersion(primary), addApiVersion(secondary)]
}

async function getChatGPTAuthHeaders(): Promise<Record<string, string>> {
  const { getChatGPTAccessToken } = await import(
    '../../services/api/chatgptAuth.js'
  )
  return { Authorization: `Bearer ${await getChatGPTAccessToken()}` }
}

function getOpenAIAuthHeaders(
  baseUrl: string,
  apiKey = readTrimmedEnv('OPENAI_API_KEY'),
): Record<string, string> {
  if (!apiKey) return {}

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  }
  if (isAzureOpenAIBaseUrl(baseUrl)) {
    headers['api-key'] = apiKey
  }
  return headers
}

function getAnthropicModelListUrls(baseUrl: string): string[] {
  const normalized = normalizeBaseUrl(baseUrl)
  const primary = normalized.endsWith('/v1')
    ? `${normalized}/models`
    : `${normalized}/v1/models`
  const secondary = `${normalized}/models`
  return primary === secondary ? [primary] : [primary, secondary]
}

function getAnthropicAuthHeaders(
  type: ProviderType,
  apiKey: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    'anthropic-version': '2026-10-21',
  }
  if (!apiKey) return headers
  if (type === 'kimi' || type === 'minimax') {
    headers.Authorization = `Bearer ${apiKey}`
  } else {
    headers['x-api-key'] = apiKey
  }
  return headers
}

function getOllamaTagsUrl(baseUrl: string): string | null {
  try {
    const parsed = new URL(baseUrl)
    const normalizedPath = parsed.pathname.replace(/\/+$/, '')
    const pathPrefix = normalizedPath.endsWith('/v1')
      ? normalizedPath.slice(0, -3)
      : normalizedPath
    const tagsPath = `${pathPrefix}/api/tags`.replace(/\/{2,}/g, '/')
    return `${parsed.origin}${tagsPath}`
  } catch {
    return null
  }
}

function uniqueModelNames(modelNames: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const modelName of modelNames) {
    const trimmed = modelName.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    unique.push(trimmed)
  }
  return unique
}

function normalizeKimiCodeModelName(modelName: string): string {
  const compact = modelName.replace(/\s+/g, '')
  return compact === 'kimi-for-coding' ? compact : modelName
}

type ContextWindows = {
  windows: Record<string, number>
  maximums?: Record<string, number>
}

async function fetchOpenAIModels(
  urls: string[],
  headers: Record<string, string>,
): Promise<{ names: string[] } & ContextWindows> {
  for (const url of urls) {
    try {
      const response = await axios.get<OpenAIModelsResponse>(url, {
        headers,
        timeout: DISCOVERY_TIMEOUT_MS,
      })
      const modelNames = uniqueModelNames(
        [
          ...(response.data?.data ?? []).map(model => model.id ?? ''),
          ...(response.data?.models ?? [])
            .filter(model => model.visibility === 'list')
            .map(model => model.slug ?? ''),
        ].filter(isNonEmptyString),
      )
      if (modelNames.length === 0) continue
      const windows: Array<[string, number]> = []
      for (const model of response.data?.data ?? []) {
        const limits = [model.context_length, model.max_input_tokens].filter(
          (value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0,
        )
        if (isNonEmptyString(model.id) && limits.length > 0) {
          windows.push([model.id.trim().toLowerCase(), Math.min(...limits)])
        }
      }
      const maximums: Array<[string, number]> = []
      for (const model of response.data?.models ?? []) {
        if (model.visibility !== 'list' || !isNonEmptyString(model.slug)) continue
        const id = model.slug.trim().toLowerCase()
        const maximum = model.max_context_window
        if (typeof maximum === 'number' && Number.isSafeInteger(maximum) && maximum > 0) {
          maximums.push([id, maximum])
        }
        const window = model.context_window
        if (typeof window === 'number' && Number.isSafeInteger(window) && window > 0) {
          windows.push([id, window])
        }
      }
      return {
        names: modelNames,
        windows: Object.fromEntries(windows),
        maximums: maximums.length > 0 ? Object.fromEntries(maximums) : undefined,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logForDebugging(
        `[ModelDiscovery] Failed OpenAI models request ${url}: ${message}`,
      )
    }
  }
  return { names: [], windows: {} }
}

async function fetchAnthropicCompatibleModels(
  urls: string[],
  headers: Record<string, string>,
): Promise<string[]> {
  for (const url of urls) {
    try {
      const response = await axios.get<OpenAIModelsResponse>(url, {
        headers,
        timeout: DISCOVERY_TIMEOUT_MS,
      })
      const modelNames = uniqueModelNames(
        (response.data?.data ?? [])
          .map(model => model.id ?? '')
          .filter(isNonEmptyString),
      )
      if (modelNames.length > 0) return modelNames
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logForDebugging(
        `[ModelDiscovery] Failed Anthropic-compatible models request ${url}: ${message}`,
      )
    }
  }
  return []
}

async function fetchOllamaModels(
  url: string,
  headers: Record<string, string>,
): Promise<string[]> {
  try {
    const response = await axios.get<OllamaTagsResponse>(url, {
      headers,
      timeout: DISCOVERY_TIMEOUT_MS,
    })
    return uniqueModelNames(
      (response.data?.models ?? [])
        .map(model => model.name ?? '')
        .filter(isNonEmptyString),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logForDebugging(
      `[ModelDiscovery] Failed Ollama tags request ${url}: ${message}`,
    )
    return []
  }
}

export async function discoverOpenAICompatibleCatalog(): Promise<
  { options: ModelOption[]; contextWindows?: { scope: string } & ContextWindows }
> {
  if (getAPIProvider() !== 'openaiCompatible') {
    return { options: [] }
  }

  const baseUrl = getOpenAIModelDiscoveryBaseUrl()
  const scope = getOpenAIModelDiscoveryScope(baseUrl)
  const headers =
    process.env.NOA_CLAUDE_OPENAI_AUTH === 'chatgpt'
      ? await getChatGPTAuthHeaders()
      : getOpenAIAuthHeaders(baseUrl)
  const catalog = await fetchOpenAIModels(getModelListUrls(baseUrl), headers)
  let names = catalog.names
  if (names.length === 0) {
    const ollamaTagsUrl = getOllamaTagsUrl(baseUrl)
    if (ollamaTagsUrl) {
      names = await fetchOllamaModels(ollamaTagsUrl, headers)
    }
  }

  return {
    options: names.map(name => ({
      value: name,
      label: name,
      description: DISCOVERED_MODEL_DESCRIPTION,
    })),
    contextWindows: Object.keys(catalog.windows).length > 0 || catalog.maximums
      ? { scope, windows: catalog.windows, maximums: catalog.maximums }
      : undefined,
  }
}

export async function discoverProviderModelNames({
  type,
  baseUrl,
  apiKey,
}: ProviderModelDiscoveryRequest): Promise<string[]> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  switch (type) {
    case 'anthropic':
    case 'minimax':
      return fetchAnthropicCompatibleModels(
        getAnthropicModelListUrls(normalizedBaseUrl),
        getAnthropicAuthHeaders(type, apiKey),
      )
    case 'kimi': {
      const names = await fetchAnthropicCompatibleModels(
        getAnthropicModelListUrls(normalizedBaseUrl),
        getAnthropicAuthHeaders(type, apiKey),
      )
      const normalizedNames = uniqueModelNames(
        names.map(normalizeKimiCodeModelName),
      )
      return normalizedNames.length > 0
        ? normalizedNames
        : ['kimi-for-coding']
    }
    case 'ollama': {
      const tagsUrl = getOllamaTagsUrl(normalizedBaseUrl)
      return tagsUrl ? fetchOllamaModels(tagsUrl, {}) : []
    }
    case 'chatgpt':
      return (await fetchOpenAIModels(
        getModelListUrls(normalizedBaseUrl),
        await getChatGPTAuthHeaders(),
      )).names
    case 'openai':
    case 'gemini':
    case 'github':
    case 'mistral':
    case 'codex':
    case 'deepseek':
    case 'moonshot':
    case 'glm':
    case 'together':
    case 'groq':
    case 'azure-openai':
    case 'openrouter':
    case 'lmstudio':
    case 'mimo': {
      const headers =
        type === 'gemini' && apiKey
          ? { 'x-goog-api-key': apiKey }
          : getOpenAIAuthHeaders(normalizedBaseUrl, apiKey)
      let { names } = await fetchOpenAIModels(
        getModelListUrls(normalizedBaseUrl),
        headers,
      )
      if (names.length === 0) {
        const ollamaTagsUrl = getOllamaTagsUrl(normalizedBaseUrl)
        if (ollamaTagsUrl) {
          names = await fetchOllamaModels(ollamaTagsUrl, headers)
        }
      }
      return names
    }
  }
}
