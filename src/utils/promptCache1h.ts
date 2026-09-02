// @ts-nocheck
import {
  getPromptCache1hAllowlist,
  getPromptCache1hEligible,
} from '../bootstrap/state.js'
import { currentLimits } from '../services/claudeAiLimits.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isClaudeAISubscriber } from './auth.js'
import { isEnvTruthy } from './envUtils.js'
import {
  getPromptCache1hEnvAllowlist,
  matchAllowlist,
} from './promptCache1hEnv.js'
import { getAPIProvider } from './model/providers.js'
import {
  getDefaultOpusModel,
  getDefaultSonnetModel,
  getSmallFastModel,
} from './model/model.js'

export {
  getPromptCache1hEnvAllowlist,
  matchAllowlist,
  PROMPT_CACHE_1H_DEFAULT_SOURCES,
} from './promptCache1hEnv.js'

export type PromptCache1hReason =
  | 'enabled'
  | 'enabled_env'
  | 'enabled_bedrock_env'
  | 'prompt_caching_disabled'
  | 'disabled_env'
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

export function getPromptCache1hDiagnostic(
  querySource?: string,
  model?: string,
): PromptCache1hDiagnostic {
  const resolvedModel = model ?? getDefaultSonnetModel()
  if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING)) {
    return {
      enabled: false,
      reason: 'prompt_caching_disabled',
      querySource,
      userEligible: false,
      allowlist: [],
    }
  }
  if (
    isEnvTruthy(process.env.DISABLE_PROMPT_CACHING_HAIKU) &&
    resolvedModel === getSmallFastModel()
  ) {
    return {
      enabled: false,
      reason: 'prompt_caching_disabled',
      querySource,
      userEligible: false,
      allowlist: [],
    }
  }
  if (
    isEnvTruthy(process.env.DISABLE_PROMPT_CACHING_SONNET) &&
    resolvedModel === getDefaultSonnetModel()
  ) {
    return {
      enabled: false,
      reason: 'prompt_caching_disabled',
      querySource,
      userEligible: false,
      allowlist: [],
    }
  }
  if (
    isEnvTruthy(process.env.DISABLE_PROMPT_CACHING_OPUS) &&
    resolvedModel === getDefaultOpusModel()
  ) {
    return {
      enabled: false,
      reason: 'prompt_caching_disabled',
      querySource,
      userEligible: false,
      allowlist: [],
    }
  }

  // Local opt-in, ahead of the Bedrock env var: it is the more direct
  // statement, so an explicit `off` can turn the Bedrock one back off.
  const envAllowlist = getPromptCache1hEnvAllowlist()
  if (envAllowlist !== undefined) {
    if (envAllowlist.length === 0) {
      return {
        enabled: false,
        reason: 'disabled_env',
        querySource,
        userEligible: true,
        allowlist: envAllowlist,
      }
    }
    const matched =
      querySource !== undefined && matchAllowlist(querySource, envAllowlist)
    return {
      enabled: matched,
      reason: matched
        ? 'enabled_env'
        : querySource === undefined
          ? 'missing_query_source'
          : 'allowlist_miss',
      querySource,
      userEligible: true,
      allowlist: envAllowlist,
    }
  }

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
