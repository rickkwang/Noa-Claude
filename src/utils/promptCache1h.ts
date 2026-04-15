// @ts-nocheck
import {
  getPromptCache1hAllowlist,
  getPromptCache1hEligible,
} from '../bootstrap/state.js'
import { currentLimits } from '../services/claudeAiLimits.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isClaudeAISubscriber } from './auth.js'
import { isEnvTruthy } from './envUtils.js'
import { getAPIProvider } from './model/providers.js'

export type PromptCache1hReason =
  | 'enabled'
  | 'enabled_bedrock_env'
  | 'not_eligible'
  | 'allowlist_miss'
  | 'missing_query_source'

export type PromptCache1hDiagnostic = {
  enabled: boolean
  reason: PromptCache1hReason
  querySource?: string
  userEligible: boolean
  allowlist: string[]
}

function matchAllowlist(querySource: string, allowlist: string[]): boolean {
  return allowlist.some(pattern =>
    pattern.endsWith('*')
      ? querySource.startsWith(pattern.slice(0, -1))
      : querySource === pattern,
  )
}

export function getPromptCache1hDiagnostic(
  querySource?: string,
): PromptCache1hDiagnostic {
  if (
    getAPIProvider() === 'bedrock' &&
    isEnvTruthy(process.env.ENABLE_PROMPT_CACHING_1H_BEDROCK)
  ) {
    return {
      enabled: true,
      reason: 'enabled_bedrock_env',
      querySource,
      userEligible: true,
      allowlist: ['*'],
    }
  }

  const latchedEligible = getPromptCache1hEligible()
  const userEligible =
    latchedEligible ??
    (process.env.USER_TYPE === 'ant' ||
      (isClaudeAISubscriber() && !currentLimits.isUsingOverage))

  const latchedAllowlist = getPromptCache1hAllowlist()
  const allowlist =
    latchedAllowlist ??
    (getFeatureValue_CACHED_MAY_BE_STALE<{ allowlist?: string[] }>(
      'tengu_prompt_cache_1h_config',
      {},
    ).allowlist ?? [])

  if (!userEligible) {
    return {
      enabled: false,
      reason: 'not_eligible',
      querySource,
      userEligible,
      allowlist,
    }
  }

  if (!querySource) {
    return {
      enabled: false,
      reason: 'missing_query_source',
      querySource,
      userEligible,
      allowlist,
    }
  }

  if (!matchAllowlist(querySource, allowlist)) {
    return {
      enabled: false,
      reason: 'allowlist_miss',
      querySource,
      userEligible,
      allowlist,
    }
  }

  return {
    enabled: true,
    reason: 'enabled',
    querySource,
    userEligible,
    allowlist,
  }
}

