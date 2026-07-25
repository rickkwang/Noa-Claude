// @ts-nocheck
import { getCanonicalName } from './model.js'
import { getAPIProvider, isFirstPartyAnthropicBaseUrl } from './providers.js'

/**
 * Models that serve a 1M context window natively — no `[1m]` suffix and no
 * `context-1m-*` beta header required. Mirrors the `context.native_1m` /
 * `context.native_1m_3p` fields in the upstream model-capability table.
 *
 * `thirdParty` lists the non-first-party backends that also serve 1M natively;
 * a backend absent from the set falls back to the 200k default.
 *
 * @[MODEL LAUNCH]: add new native-1M models here.
 */
const NATIVE_1M_MODELS: Record<string, { thirdParty: ReadonlySet<string> }> = {
  'claude-sonnet-5': {
    thirdParty: new Set(['bedrock', 'vertex', 'foundry']),
  },
  'claude-opus-4-7': { thirdParty: new Set() },
  'claude-opus-4-8': { thirdParty: new Set() },
  // Opus 5 serves 1M as both the default and the maximum. Third-party backends
  // are left empty like the rest of the Opus family: 3P still defaults to Opus
  // 4.8 (see getDefaultOpusModel), so a 3P user only reaches Opus 5 by pinning
  // it, and over-reporting the window there would push auto-compact past the
  // real limit. `[1m]` remains the explicit opt-in on those backends.
  'claude-opus-5': { thirdParty: new Set() },
  'claude-fable-5': { thirdParty: new Set() },
}

/**
 * Whether this model serves 1M context natively for the current backend.
 *
 * First-party access is gated on the base URL actually pointing at Anthropic —
 * a proxy or gateway sitting on ANTHROPIC_BASE_URL may not honour 1M, and
 * over-reporting the window would push auto-compact past the real limit.
 */
export function hasNative1mContext(model: string): boolean {
  const entry = NATIVE_1M_MODELS[getCanonicalName(model)]
  if (!entry) {
    return false
  }

  const provider = getAPIProvider()
  if (provider === 'firstParty') {
    return isFirstPartyAnthropicBaseUrl()
  }
  return entry.thirdParty.has(provider)
}
