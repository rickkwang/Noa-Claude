// @ts-nocheck
import memoize from 'lodash-es/memoize.js'
import {
  getAPIProvider,
  isThirdPartyAnthropicCompatibleProvider,
} from './providers.js'

export type ModelCapabilityOverride =
  | 'effort'
  | 'max_effort'
  | 'xhigh_effort'
  | 'thinking'
  | 'adaptive_thinking'
  | 'interleaved_thinking'
  | 'context_management'
  | 'claude_code_beta'
  | 'structured_outputs'
  | 'lean_prompt'

const TIERS = [
  {
    modelEnvVar: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    capabilitiesEnvVar: 'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  },
  {
    modelEnvVar: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    capabilitiesEnvVar: 'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  },
  {
    modelEnvVar: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    capabilitiesEnvVar: 'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  },
] as const

/**
 * `[1m]` selects the 1M-context variant of a model, not a different model, so it
 * must not affect which capabilities that model is declared to have. Upstream
 * strips it before its own capability lookup for the same reason. Stripped from
 * both sides here because the pin is written by hand and may carry the suffix
 * either way.
 */
function withoutContextWindowSuffix(model: string): string {
  return model.replace(/\[1m\]/gi, '').toLowerCase()
}

/**
 * Check whether a 3p model capability override is set for a model that matches one of
 * the pinned ANTHROPIC_DEFAULT_*_MODEL env vars.
 */
export const get3PModelCapabilityOverride = memoize(
  (model: string, capability: ModelCapabilityOverride): boolean | undefined => {
    if (
      getAPIProvider() === 'firstParty' &&
      !isThirdPartyAnthropicCompatibleProvider()
    ) {
      return undefined
    }
    const m = withoutContextWindowSuffix(model)
    for (const tier of TIERS) {
      const pinned = process.env[tier.modelEnvVar]
      const capabilities = process.env[tier.capabilitiesEnvVar]
      if (!pinned || capabilities === undefined) continue
      if (m !== withoutContextWindowSuffix(pinned)) continue
      return capabilities
        .toLowerCase()
        .split(',')
        .map(s => s.trim())
        .includes(capability)
    }
    return undefined
  },
  (model, capability) =>
    [
      // Same normalization as the lookup, so `foo` and `foo[1m]` share an entry
      // rather than one of them caching the other's answer under a stale key.
      withoutContextWindowSuffix(model),
      capability,
      getAPIProvider(),
      process.env.ANTHROPIC_BASE_URL ?? '',
      process.env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? '',
      process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES ?? '',
      process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? '',
      process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES ?? '',
      process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? '',
      process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES ?? '',
    ].join(':'),
)
