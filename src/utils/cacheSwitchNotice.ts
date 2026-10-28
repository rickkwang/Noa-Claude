import { getLastMainThreadCacheState } from '../bootstrap/state.js'
import { should1hCacheTTL } from '../services/api/claude.js'
import { CACHE_TTL_1HOUR_MS } from '../services/api/promptCacheBreakDetection.js'
import { formatTokens } from './format.js'

const CACHE_TTL_5MIN_MS = 5 * 60 * 1000

// Only a warm cache is worth warning about: a switch then re-caches the whole
// prefix on the next request. Cold cache means the re-cache happens anyway.
export function withCacheSwitchNotice(message: string): string {
  const last = getLastMainThreadCacheState()
  if (!last) return message
  const ttlMs = should1hCacheTTL(last.querySource)
    ? CACHE_TTL_1HOUR_MS
    : CACHE_TTL_5MIN_MS
  if (Date.now() - last.completedAt >= ttlMs) return message
  return `${message} · Prompt cache is warm (~${formatTokens(last.promptTokens)} tokens); the next request re-caches the full context`
}
