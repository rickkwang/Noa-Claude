// @ts-nocheck
import { getCanonicalName } from './model.js'

/**
 * Models that serve a 1M context window natively — no `[1m]` suffix and no
 * `context-1m-*` beta header required. This holds on every provider: a 3P
 * deployment of a native-1M model is 1M too, not a `[1m]` opt-in.
 *
 * @[MODEL LAUNCH]: add new native-1M models here.
 */
const NATIVE_1M_MODELS: ReadonlySet<string> = new Set([
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-5-5',
  'claude-sonnet-5',
  'claude-sonnet-5-5',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-opus-5',
  'claude-opus-5-5',
  'claude-fable-5',
  'claude-fable-5-1',
  'claude-mythos-5',
  'claude-mythos-5-1',
])

/**
 * Whether this model serves 1M context natively. Provider-independent.
 * First party counts even behind a custom ANTHROPIC_BASE_URL: the
 * catalog flag is trusted over the gateway's unknown ceiling. A gateway that
 * stops at 200k is handled by the user setting `/autocompact 200k` (or
 * CLAUDE_CODE_AUTO_COMPACT_WINDOW), not by under-reporting every session.
 */
/**
 * Native-1M models that still get the `context-1m-*` beta header with every
 * request. Opus 4.6 / Sonnet 4.6 are documented at 1M, but their long context
 * originally shipped behind that header; sending it is harmless where it is
 * no longer required and keeps requests above 200k from being rejected where
 * it still is.
 */
const NATIVE_1M_WITH_BETA_HEADER: ReadonlySet<string> = new Set([
  'claude-opus-4-6',
  'claude-sonnet-4-6',
])

export function native1mNeedsBetaHeader(model: string): boolean {
  return NATIVE_1M_WITH_BETA_HEADER.has(getCanonicalName(model))
}

/**
 * Models whose `[1m]` suffix is inert: natively 1M per the upstream catalog's
 * `native_1m` flag, so the suffix neither changes the served window nor is
 * rendered. Deliberately NOT NATIVE_1M_MODELS: Opus/Sonnet 4.6 serve 1M here
 * via the beta header but upstream keeps them opt-in (`supports_1m_suffix`),
 * so `claude-sonnet-4-6[1m]` must survive normalization and keep its marker.
 */
const SUFFIX_INERT_1M_MODELS: ReadonlySet<string> = new Set([
  'claude-haiku-5-5',
  'claude-sonnet-5',
  'claude-sonnet-5-5',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-opus-5',
  'claude-opus-5-5',
  'claude-fable-5',
  'claude-fable-5-1',
  'claude-mythos-5',
  'claude-mythos-5-1',
])

export function is1mSuffixInert(model: string): boolean {
  return SUFFIX_INERT_1M_MODELS.has(getCanonicalName(model))
}

/**
 * Drop every `[1m]` tag when the underlying model is suffix-inert — the
 * upstream `vz` normalization applied to every resolved model id. Aliases and
 * opt-in models (Sonnet/Opus 4.6 and older) pass through untouched, so legacy
 * settings like `claude-sonnet-4-6[1m]` keep working and keep their marker.
 */
export function stripIneffective1mSuffix(model: string): string {
  const stripped = model.replace(/\[1m\]/gi, '')
  if (stripped === model) {
    return model
  }
  return is1mSuffixInert(stripped) ? stripped : model
}

export function hasNative1mContext(model: string): boolean {
  return NATIVE_1M_MODELS.has(getCanonicalName(model))
}
