// @ts-nocheck
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { isEnvTruthy } from '../envUtils.js'
import { chatReasoningSignature } from '../../services/api/openaiCompatibleHelpers.js'

export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry' | 'openaiCompatible'

export function getAPIProvider(): APIProvider {
  return isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
    ? 'bedrock'
    : isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
      ? 'vertex'
      : isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
        ? 'foundry'
        : isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI)
          ? 'openaiCompatible'
          : 'firstParty'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if ANTHROPIC_BASE_URL is a first-party Anthropic API URL.
 * Returns true if not set (default API) or points to api.anthropic.com
 * (or api-staging.anthropic.com for ant users).
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}

/** The OpenAI shim's /chat/completions route, not the ChatGPT /responses route. */
export function isOpenAIChatCompletionsRoute(): boolean {
  return (
    getAPIProvider() === 'openaiCompatible' &&
    process.env.NOA_CLAUDE_OPENAI_AUTH !== 'chatgpt'
  )
}

/**
 * The marker the active endpoint's Chat Completions reasoning carries, or
 * undefined off that route. Resume and compaction keep blocks with this
 * marker; a provider switch strips them all (providerSwitch.ts).
 */
export function getActiveChatReasoningSignature(): string | undefined {
  if (!isOpenAIChatCompletionsRoute()) return undefined
  // Same default as the shim client (services/api/client.ts).
  return chatReasoningSignature(
    process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  )
}

export function isThirdPartyAnthropicCompatibleProvider(): boolean {
  return (
    getAPIProvider() === 'firstParty' && !isFirstPartyAnthropicBaseUrl()
  )
}

/**
 * Direct Anthropic first-party API (api.anthropic.com or unset base URL) — i.e.
 * provider 'firstParty' AND not a custom base URL. A proxy / third-party
 * Anthropic-compatible endpoint also reports provider 'firstParty', so any gate
 * meant for the real first-party API must use this, not getAPIProvider() alone.
 */
export function isDirectFirstParty(): boolean {
  return getAPIProvider() === 'firstParty' && isFirstPartyAnthropicBaseUrl()
}
