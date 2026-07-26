// @ts-nocheck
// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import type { Tools } from '../Tool.js'
import type { MCPServerConnection } from '../services/mcp/types.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { shouldUseGlobalCacheScope } from '../utils/betas.js'
import { resolveSystemPromptSections } from './systemPromptSections.js'
import { shouldUseCompactSystemPrompt } from './systemPromptCompact.js'
import { getDefaultAgentPrompt } from './systemPromptCoreSections.js'
import {
  computeEnvInfo,
  computeMainSessionEnvInfo,
  getScratchpadInstructions,
  getUnameSR,
} from './systemPromptEnvHelpers.js'
import {
  buildDynamicSystemPromptSections,
  buildSimpleModeSystemPrompt,
  buildStaticSystemPromptSections,
  enhanceSystemPromptWithAssemblyDetails,
  getOptionalProactiveSection,
  resolveSystemPromptBuildInputs,
} from './systemPromptAssemblyHelpers.js'

/**
 * Boundary marker separating static (cross-org cacheable) content from dynamic content.
 * Everything BEFORE this marker in the system prompt array can use scope: 'global'.
 * Everything AFTER contains user/session-specific content and should not be cached.
 *
 * WARNING: Do not remove or reorder this marker without updating cache logic in:
 * - src/utils/api.ts (splitSysPromptPrefix)
 * - src/services/api/claude.ts (buildSystemPromptBlocks)
 */
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY =
  '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'

export async function getSystemPrompt(
  tools: Tools,
  model: string,
  additionalWorkingDirectories?: string[],
  mcpClients?: MCPServerConnection[],
): Promise<string[]> {
  if (isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
    return buildSimpleModeSystemPrompt()
  }

  const {
    settings,
    enabledTools,
    skillToolCommands,
    outputStyleConfig,
    includeCodingStyleSection,
  } = await resolveSystemPromptBuildInputs(tools)

  const dynamicSections = buildDynamicSystemPromptSections({
    enabledTools,
    skillToolCommands,
    model,
    additionalWorkingDirectories,
    mcpClients,
    language: settings.language,
    outputStyleConfig,
  })

  const resolvedDynamicSections =
    await resolveSystemPromptSections(dynamicSections)

  return buildStaticSystemPromptSections({
    enabledTools,
    includeCodingStyleSection,
    boundaryMarker: shouldUseGlobalCacheScope()
      ? SYSTEM_PROMPT_DYNAMIC_BOUNDARY
      : null,
    resolvedDynamicSections,
    proactiveSection: getOptionalProactiveSection(),
    useCompactPrompt: shouldUseCompactSystemPrompt(model),
    hasOutputStyle: outputStyleConfig !== null,
  }).filter(s => s !== null)
}

export const DEFAULT_AGENT_PROMPT = getDefaultAgentPrompt()

export async function enhanceSystemPromptWithEnvDetails(
  existingSystemPrompt: string[],
  model: string,
  additionalWorkingDirectories?: string[],
  enabledToolNames?: ReadonlySet<string>,
): Promise<string[]> {
  return enhanceSystemPromptWithAssemblyDetails(
    existingSystemPrompt,
    model,
    additionalWorkingDirectories,
    enabledToolNames,
  )
}

export {
  computeEnvInfo,
  computeMainSessionEnvInfo,
  getScratchpadInstructions,
  getUnameSR,
}
