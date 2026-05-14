import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import {
  getCachedMCConfig,
  type CacheEditsBlock,
  type PinnedCacheEdits,
} from './cachedMCConfig.js'

export type { CacheEditsBlock, PinnedCacheEdits } from './cachedMCConfig.js'

export type CachedMCState = {
  registeredTools: Set<string>
  toolOrder: string[]
  deletedRefs: Set<string>
  pendingDeletes: string[]
  messageGroups: string[][]
  pinnedEdits: PinnedCacheEdits[]
  sentToAPI: Set<string>
}

export function isCachedMicrocompactEnabled(): boolean {
  return (
    getCachedMCConfig().enabled &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_cached_microcompact', false)
  )
}

export function isModelSupportedForCacheEditing(model: string): boolean {
  const normalized = model.toLowerCase()
  return getCachedMCConfig().supportedModels.some(supported =>
    normalized.includes(supported.toLowerCase()),
  )
}

export function createCachedMCState(): CachedMCState {
  return {
    registeredTools: new Set(),
    toolOrder: [],
    deletedRefs: new Set(),
    pendingDeletes: [],
    messageGroups: [],
    pinnedEdits: [],
    sentToAPI: new Set(),
  }
}

export function registerToolResult(
  state: CachedMCState,
  toolUseId: string,
): void {
  state.registeredTools.add(toolUseId)
  state.toolOrder.push(toolUseId)
}

export function registerToolMessage(
  state: CachedMCState,
  toolUseIds: string[],
): void {
  if (toolUseIds.length > 0) {
    state.messageGroups.push(toolUseIds)
  }
}

export function getToolResultsToDelete(_state: CachedMCState): string[] {
  return []
}

export function createCacheEditsBlock(
  _state: CachedMCState,
  _toolUseIds: string[],
): CacheEditsBlock | null {
  return null
}

export function markToolsSentToAPI(state: CachedMCState): void {
  for (const toolId of state.toolOrder) {
    state.sentToAPI.add(toolId)
  }
}

export function resetCachedMCState(state: CachedMCState): void {
  state.registeredTools.clear()
  state.toolOrder = []
  state.deletedRefs.clear()
  state.pendingDeletes = []
  state.messageGroups = []
  state.pinnedEdits = []
  state.sentToAPI.clear()
}

export default {
  createCacheEditsBlock,
  createCachedMCState,
  getCachedMCConfig,
  getToolResultsToDelete,
  isCachedMicrocompactEnabled,
  isModelSupportedForCacheEditing,
  markToolsSentToAPI,
  registerToolMessage,
  registerToolResult,
  resetCachedMCState,
}
