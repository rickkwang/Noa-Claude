// @ts-nocheck
/**
 * Session cache clearing utilities.
 * This module is imported at startup by main.tsx, so keep imports minimal.
 */
import { feature } from 'bun:bundle'
import {
  clearInvokedSkills,
  setLastEmittedDate,
} from '../../bootstrap/state.js'
import { clearCommandsCache } from '../../commands.js'
import { getSessionStartDate } from '../../constants/common.js'
import {
  getGitStatus,
  getSystemContext,
  getUserContext,
  setSystemPromptInjection,
} from '../../context.js'
import { clearFileSuggestionCaches } from '../../hooks/fileSuggestions.js'
import { clearAllPendingCallbacks } from '../../hooks/useSwarmPermissionPoller.js'
import { clearAllDumpState } from '../../services/api/dumpPrompts.js'
import { resetPromptCacheBreakDetection } from '../../services/api/promptCacheBreakDetection.js'
import { clearAllSessions } from '../../services/api/sessionIngress.js'
import { runPostCompactCleanup } from '../../services/compact/postCompactCleanup.js'
import { resetAllLSPDiagnosticState } from '../../services/lsp/LSPDiagnosticRegistry.js'
import { clearTrackedMagicDocs } from '../../services/MagicDocs/magicDocs.js'
import { clearDynamicSkills } from '../../skills/loadSkillsDir.js'
import { clearCommandPrefixCaches } from '../../utils/bash/commands.js'
import { resetBtwHistory } from '../../utils/btwHistory.js'
import { resetGetMemoryFilesCache } from '../../utils/claudemd.js'
import { clearRepositoryCaches } from '../../utils/detectRepository.js'
import { clearResolveGitDirCache } from '../../utils/git/gitFilesystem.js'
import { clearStoredImagePaths } from '../../utils/imageStore.js'
import { logError } from '../../utils/log.js'
import { clearSessionEnvVars } from '../../utils/sessionEnvVars.js'

/**
 * Clear all session-related caches.
 * Call this when resuming a session to ensure fresh file/skill discovery.
 * This is a subset of what clearConversation does - it only clears caches
 * without affecting messages, session ID, or triggering hooks.
 *
 * @param preservedAgentIds - Agent IDs whose per-agent state should survive
 *   the clear (e.g., background tasks preserved across /clear). When non-empty,
 *   agentId-keyed state (invoked skills) is selectively cleared and requestId-keyed
 *   state (pending permission callbacks, dump state, cache-break tracking) is left
 *   intact since it cannot be safely scoped to the main session.
 */
export function clearSessionCaches(
  preservedAgentIds: ReadonlySet<string> = new Set(),
): void {
  const hasPreserved = preservedAgentIds.size > 0
  getUserContext.cache.clear?.()
  getSystemContext.cache.clear?.()
  getGitStatus.cache.clear?.()
  getSessionStartDate.cache.clear?.()
  clearFileSuggestionCaches()

  clearCommandsCache()

  if (!hasPreserved) resetPromptCacheBreakDetection()

  setSystemPromptInjection(null)

  setLastEmittedDate(null)

  // Run post-compaction cleanup (clears system prompt sections, microcompact tracking,
  // classifier approvals, speculative checks, and — for main-thread compacts — memory
  // files cache with load_reason 'compact').
  runPostCompactCleanup()
  // Override the memory cache reset with 'session_start': clearSessionCaches is called
  // from /clear and --resume/--continue, which are NOT compaction events. Without this,
  // the InstructionsLoaded hook would fire with load_reason 'compact' instead of
  // 'session_start' on the next getMemoryFiles() call.
  resetGetMemoryFilesCache('session_start')

  clearStoredImagePaths()

  // /btw history belongs to the conversation it was asked in
  resetBtwHistory()

  // Clear all session ingress caches (lastUuidMap, sequentialAppendBySession)
  clearAllSessions()
  if (!hasPreserved) clearAllPendingCallbacks()

  if (process.env.USER_TYPE === 'ant') {
    void import('../../tools/TungstenTool/TungstenTool.js').then(
      ({ clearSessionsWithTungstenUsage, resetInitializationState }) => {
        clearSessionsWithTungstenUsage()
        resetInitializationState()
      },
    ).catch(err => logError(err as Error))
  }
  // Dynamic import preserves dead code elimination for COMMIT_ATTRIBUTION.
  if (feature('COMMIT_ATTRIBUTION')) {
    void import('../../utils/attributionHooks.js').then(
      ({ clearAttributionCaches }) => clearAttributionCaches(),
    ).catch(err => logError(err as Error))
  }
  clearRepositoryCaches()
  clearCommandPrefixCaches()
  if (!hasPreserved) clearAllDumpState()
  // Entries retain full skill file contents.
  clearInvokedSkills(preservedAgentIds)
  clearResolveGitDirCache()
  clearDynamicSkills()
  resetAllLSPDiagnosticState()
  clearTrackedMagicDocs()
  clearSessionEnvVars()
  // Cached pages can retain up to 50MB.
  void import('../../tools/WebFetchTool/utils.js').then(
    ({ clearWebFetchCache }) => clearWebFetchCache(),
  ).catch(err => logError(err as Error))
  // Full tool prompts can retain ~500KB for 50 MCP tools.
  void import('../../tools/ToolSearchTool/ToolSearchTool.js').then(
    ({ clearToolSearchDescriptionCache }) => clearToolSearchDescriptionCache(),
  ).catch(err => logError(err as Error))
  // Entries accumulate per cwd via EnterWorktreeTool.
  void import('../../tools/AgentTool/loadAgentsDir.js').then(
    ({ clearAgentDefinitionsCache }) => clearAgentDefinitionsCache(),
  ).catch(err => logError(err as Error))
  // Entries accumulate per project root.
  void import('../../tools/SkillTool/prompt.js').then(({ clearPromptCache }) =>
    clearPromptCache(),
  ).catch(err => logError(err as Error))
}
