// @ts-nocheck
import axios from 'axios'
import { logForDebugging } from '../debug.js'
import type { ModelOption } from './modelOptions.js'
import { getAPIProvider } from './providers.js'

const DISCOVERY_TIMEOUT_MS = 5000
const DISCOVERED_MODEL_DESCRIPTION = 'Discovered from OpenAI-compatible endpoint'

type OpenAIModelsResponse = {
  data?: Array<{
    id?: string | null
  }>
}

type OllamaTagsResponse = {
  models?: Array<{
    name?: string | null
  }>
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

function getNormalizedOpenAIBaseUrl(): string {
  return normalizeBaseUrl(
    readTrimmedEnv('OPENAI_BASE_URL', 'OPENAI_API_BASE') ??
      'https://api.openai.com/v1',
  )
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

function getOpenAIAuthHeaders(baseUrl: string): Record<string, string> {
  const apiKey = readTrimmedEnv('OPENAI_API_KEY')
  if (!apiKey) return {}

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  }
  if (isAzureOpenAIBaseUrl(baseUrl)) {
    headers['api-key'] = apiKey
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

async function fetchOpenAIModels(
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
        `[ModelDiscovery] Failed OpenAI models request ${url}: ${message}`,
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

export async function discoverOpenAICompatibleModelOptions(): Promise<
  ModelOption[]
> {
  if (getAPIProvider() !== 'openaiCompatible') {
    return []
  }

  const baseUrl = getNormalizedOpenAIBaseUrl()
  const headers = getOpenAIAuthHeaders(baseUrl)
  let names = await fetchOpenAIModels(getModelListUrls(baseUrl), headers)
  if (names.length === 0) {
    const ollamaTagsUrl = getOllamaTagsUrl(baseUrl)
    if (ollamaTagsUrl) {
      names = await fetchOllamaModels(ollamaTagsUrl, headers)
    }
  }

  return names.map(name => ({
    value: name,
    label: name,
    description: DISCOVERED_MODEL_DESCRIPTION,
  }))
}
