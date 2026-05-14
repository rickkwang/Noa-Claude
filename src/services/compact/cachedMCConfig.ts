export type CacheEditsBlock = {
  type: 'cache_edits'
  edits: { type: 'delete'; cache_reference: string }[]
}

export type PinnedCacheEdits = {
  userMessageIndex: number
  block: CacheEditsBlock
}

export type CachedMCConfig = {
  enabled: boolean
  supportedModels: string[]
  triggerThreshold: number
  keepRecent: number
  systemPromptSuggestSummaries: boolean
}

const DEFAULT_CONFIG: CachedMCConfig = {
  enabled: false,
  supportedModels: [],
  triggerThreshold: Number.MAX_SAFE_INTEGER,
  keepRecent: 0,
  systemPromptSuggestSummaries: false,
}

export function getCachedMCConfig(): CachedMCConfig {
  return DEFAULT_CONFIG
}
