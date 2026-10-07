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
export function hasNative1mContext(model: string): boolean {
  return NATIVE_1M_MODELS.has(getCanonicalName(model))
}
