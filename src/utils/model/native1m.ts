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
  // Opus 5 serves 1M natively on first party only. The empty third-party set
  // is upstream's own value, not caution on our part: its catalog entry for
  // Opus 5 carries `native_1m` and `supports_1m_beta`/`supports_1m_suffix` but
  // no `native_1m_3p` map, so on Bedrock/Vertex/Foundry the 1M window is the
  // `[1m]` opt-in rather than the default. (Sonnet 5 is the model that *does*
  // carry `native_1m_3p:{bedrock,vertex,foundry}` — hence the difference below.)
  // Do not "fix" this by reasoning from the 3P default: Bedrock and Vertex now
  // default to Opus 5, and it is still 200k there until `[1m]` is asked for.
  'claude-opus-5': { thirdParty: new Set() },
  'claude-fable-5': { thirdParty: new Set() },
  'claude-fable-5-1': { thirdParty: new Set() },
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
