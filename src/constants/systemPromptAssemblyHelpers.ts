// @ts-nocheck
import { feature } from 'bun:bundle'
import type { MCPServerConnection } from '../services/mcp/types.js'
import type { Tools } from '../Tool.js'
import { getSkillToolCommands } from 'src/commands.js'
import { getSessionStartDate } from './common.js'
import { getCwd } from '../utils/cwd.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import { isMcpInstructionsDeltaEnabled } from '../utils/mcpInstructionsDelta.js'
import { loadMemoryPrompt } from '../memdir/memdir.js'
import { getOutputStyleConfig } from './outputStyles.js'
import {
  DANGEROUS_uncachedSystemPromptSection,
  systemPromptSection,
} from './systemPromptSections.js'
import {
  getActionCautionSection,
  getAntiVerbositySection,
  getCompactHeadSection,
  hasFableMitigations,
  hasOpus5PromptBundle,
  shouldUseCompactSystemPrompt,
} from './systemPromptCompact.js'
import {
  ACT_DONT_REDERIVE_SECTION,
  CONTEXT_MANAGEMENT_SECTION,
  CORRECTIONS_SECTION,
  DELIVERING_WORK_SECTION,
  PRONOUNS_SECTION,
  getActionsSection,
  getCodingStyleAndWorkflowSection,
  getCoreExecutionGuardsSection,
  getDesignWorkflowSection,
  getResearchAndTruthfulnessSection,
  getSimpleIntroSection,
  getSimpleSystemSection,
  getSimpleToneAndStyleSection,
  getUsingYourToolsSection,
} from './systemPromptCoreSections.js'
import {
  getAntModelOverrideSection,
  getDiscoverSkillsGuidance,
  getLanguageSection,
  getMcpInstructionsSection,
  getOutputStyleSection,
  getSessionSpecificGuidanceSection,
} from './systemPromptDynamicSections.js'
import {
  computeEnvInfo,
  computeMainSessionEnvInfo,
  getScratchpadInstructions,
} from './systemPromptEnvHelpers.js'
import {
  getBriefSection,
  getFunctionResultClearingSection,
  getProactiveSection,
  SUMMARIZE_TOOL_RESULTS_SECTION,
} from './systemPromptFeatureSections.js'

// Dead code elimination: conditional imports for feature-gated modules
/* eslint-disable @typescript-eslint/no-require-imports */
const DISCOVER_SKILLS_TOOL_NAME: string | null = feature(
  'EXPERIMENTAL_SKILL_SEARCH',
)
  ? (
      require('../tools/DiscoverSkillsTool/prompt.js') as typeof import('../tools/DiscoverSkillsTool/prompt.js')
    ).DISCOVER_SKILLS_TOOL_NAME
  : null

const skillSearchFeatureCheck = feature('EXPERIMENTAL_SKILL_SEARCH')
  ? (require('../services/skillSearch/featureCheck.js') as typeof import('../services/skillSearch/featureCheck.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

const SIMPLE_MODE_IDENTITY = `You are Noa Claude, an AI coding agent built for software engineering tasks.`

const SYSTEM_PROMPT_ENV_NOTES = `Notes:
- Agent threads always have their cwd reset between bash calls, as a result please only use absolute file paths.
- In your final response, share file paths (always absolute, never relative) that are relevant to the task. Include code snippets only when the exact text is load-bearing (e.g., a bug you found, a function signature the caller asked for) — do not recap code you merely read.
- For clear communication with the user, avoid emojis unless the user explicitly asks for them.
- Write naturally around tool calls; do not assume the user can see the raw tool call immediately after your sentence.`

export async function resolveSystemPromptBuildInputs(tools: Tools): Promise<{
  settings: ReturnType<typeof getInitialSettings>
  enabledTools: Set<string>
  skillToolCommands: Awaited<ReturnType<typeof getSkillToolCommands>>
  outputStyleConfig: Awaited<ReturnType<typeof getOutputStyleConfig>>
  includeCodingStyleSection: boolean
}> {
  const cwd = getCwd()
  const [skillToolCommands, outputStyleConfig] = await Promise.all([
    getSkillToolCommands(cwd),
    getOutputStyleConfig(),
  ])

  const settings = getInitialSettings()
  const enabledTools = new Set(tools.map(_ => _.name))
  const includeCodingStyleSection =
    outputStyleConfig === null ||
    outputStyleConfig.keepCodingInstructions !== false

  return {
    settings,
    enabledTools,
    skillToolCommands,
    outputStyleConfig,
    includeCodingStyleSection,
  }
}

export function buildSimpleModeSystemPrompt(): string[] {
  return [
    `${SIMPLE_MODE_IDENTITY}\n\nCWD: ${getCwd()}\nDate: ${getSessionStartDate()}`,
    getCoreExecutionGuardsSection(),
  ]
}

export function buildDynamicSystemPromptSections(params: {
  enabledTools: Set<string>
  skillToolCommands: unknown[]
  model: string
  additionalWorkingDirectories?: string[]
  mcpClients?: MCPServerConnection[]
  language?: string
  outputStyleConfig: { name: string; prompt: string } | null
}): ReturnType<typeof systemPromptSection>[] {
  const {
    enabledTools,
    skillToolCommands,
    model,
    additionalWorkingDirectories,
    mcpClients,
    language,
    outputStyleConfig,
  } = params

  // Sections whose text depends on the lean/verbose split must vary their cache
  // key with it: resolveSystemPromptSections() memoizes on the section name
  // alone, so a mid-session /model switch would otherwise keep serving the
  // previous tier's text. Same `:L` suffix upstream uses for the same reason.
  //
  // Two independent gates land here, and each section keys off whichever one
  // actually drives its text — see hasOpus5PromptBundle() for why they are not
  // the same question.
  const lean = shouldUseCompactSystemPrompt(model)
  const bundle = hasOpus5PromptBundle(model)
  const bundleSuffix = bundle ? ':L' : ''
  // Emitted only under the lean prompt, but worded by the bundle gate, so the
  // key has to carry both bits. Upstream keys this one on the lean bit alone,
  // which lets a switch between two lean models that disagree on the bundle
  // (Opus 5 -> Fable 5) serve the previous model's wording for the rest of the
  // session. Carrying both bits is a deliberate departure, not a port gap.
  const actionCautionName = lean
    ? `action_caution:L${bundle ? '' : ':nb'}`
    : 'action_caution'

  // Upstream's first dynamic section, ahead of the pronoun guidance. Three
  // possible texts (the Fable branch, the lean one-liner, nothing), so the key
  // names the branch rather than carrying a single lean bit.
  const antiVerbosity = getAntiVerbositySection(model)
  const antiVerbosityName = hasFableMitigations(model)
    ? 'anti_verbosity:fable'
    : `anti_verbosity${antiVerbosity !== null ? ':L' : ''}`

  return [
    systemPromptSection(antiVerbosityName, () => antiVerbosity),
    systemPromptSection('pronouns', () => PRONOUNS_SECTION),
    systemPromptSection(actionCautionName, () =>
      getActionCautionSection(model),
    ),
    systemPromptSection('session_guidance', () =>
      getSessionSpecificGuidanceSection(
        enabledTools,
        skillToolCommands,
        DISCOVER_SKILLS_TOOL_NAME,
      ),
    ),
    systemPromptSection('memory', () => loadMemoryPrompt()),
    systemPromptSection('ant_model_override', () =>
      getAntModelOverrideSection(),
    ),
    systemPromptSection('env_info_simple', () =>
      computeMainSessionEnvInfo(model, additionalWorkingDirectories),
    ),
    systemPromptSection('language', () => getLanguageSection(language)),
    systemPromptSection('output_style', () =>
      getOutputStyleSection(outputStyleConfig),
    ),
    // When delta enabled, instructions are announced via persisted
    // mcp_instructions_delta attachments (attachments.ts) instead of this
    // per-turn recompute, which busts the prompt cache on late MCP connect.
    // Gate check inside compute (not selecting between section variants)
    // so a mid-session gate flip doesn't read a stale cached value.
    DANGEROUS_uncachedSystemPromptSection(
      'mcp_instructions',
      () =>
        isMcpInstructionsDeltaEnabled()
          ? null
          : getMcpInstructionsSection(mcpClients),
      'MCP servers connect/disconnect between turns',
    ),
    systemPromptSection('scratchpad', () => getScratchpadInstructions()),
    systemPromptSection(
      'context_management',
      () => CONTEXT_MANAGEMENT_SECTION,
    ),
    systemPromptSection('frc', () => getFunctionResultClearingSection(model)),
    systemPromptSection(
      'summarize_tool_results',
      () => SUMMARIZE_TOOL_RESULTS_SECTION,
    ),
    ...(feature('TOKEN_BUDGET')
      ? [
          // Cached unconditionally — the "When the user specifies..." phrasing
          // makes it a no-op with no budget active. Was DANGEROUS_uncached
          // (toggled on getCurrentTurnTokenBudget()), busting ~20K tokens per
          // budget flip. Not moved to a tail attachment: first-response and
          // budget-continuation paths don't see attachments (#21577).
          systemPromptSection(
            'token_budget',
            () =>
              'When the user specifies a token target (e.g., "+500k", "spend 2M tokens", "use 1B tokens"), your output token count will be shown each turn. Keep working until you approach the target — plan your work to fill it productively. The target is a hard minimum, not a suggestion. If you stop early, the system will automatically continue you.',
          ),
        ]
      : []),
    ...(feature('KAIROS') || feature('KAIROS_BRIEF')
      ? [systemPromptSection('brief', () => getBriefSection())]
      : []),
    systemPromptSection('act_dont_rederive', () => ACT_DONT_REDERIVE_SECTION),
    // Compact-head companions. Upstream gates these on the prompt bundle, not
    // on the lean prompt — the two coincide for every first-party model, and
    // only a pinned third-party model can pull them apart. They restate, in one
    // place, the scope and self-correction discipline that the verbose head
    // spells out across its own sections.
    systemPromptSection(`delivering_work${bundleSuffix}`, () =>
      bundle ? DELIVERING_WORK_SECTION : null,
    ),
    systemPromptSection(`corrections${bundleSuffix}`, () =>
      bundle ? CORRECTIONS_SECTION : null,
    ),
  ]
}

export function buildStaticSystemPromptSections(params: {
  enabledTools: Set<string>
  includeCodingStyleSection: boolean
  boundaryMarker: string | null
  resolvedDynamicSections: Array<string | null>
  proactiveSection: string | null
  useCompactPrompt?: boolean
  hasOutputStyle?: boolean
}): Array<string | null> {
  const {
    enabledTools,
    includeCodingStyleSection,
    boundaryMarker,
    resolvedDynamicSections,
    proactiveSection,
    useCompactPrompt = false,
    hasOutputStyle = false,
  } = params

  // Only the static head swaps; the boundary marker and everything after it
  // stay identical so cache splitting and dynamic content are unaffected.
  const head = useCompactPrompt
    ? [getCompactHeadSection(hasOutputStyle)]
    : [
        getSimpleIntroSection(),
        getSimpleSystemSection(),
        getResearchAndTruthfulnessSection(enabledTools),
        getDesignWorkflowSection(),
        getCoreExecutionGuardsSection(),
        includeCodingStyleSection ? getCodingStyleAndWorkflowSection() : null,
        getActionsSection(),
        getUsingYourToolsSection(enabledTools),
        getSimpleToneAndStyleSection(),
      ]

  return [
    ...head,
    ...(boundaryMarker !== null ? [boundaryMarker] : []),
    ...resolvedDynamicSections,
    proactiveSection,
  ]
}

export async function enhanceSystemPromptWithAssemblyDetails(
  existingSystemPrompt: string[],
  model: string,
  additionalWorkingDirectories?: string[],
  enabledToolNames?: ReadonlySet<string>,
): Promise<string[]> {
  const discoverSkillsGuidance =
    feature('EXPERIMENTAL_SKILL_SEARCH') &&
    skillSearchFeatureCheck?.isSkillSearchEnabled() &&
    DISCOVER_SKILLS_TOOL_NAME !== null &&
    (enabledToolNames?.has(DISCOVER_SKILLS_TOOL_NAME) ?? true)
      ? getDiscoverSkillsGuidance(DISCOVER_SKILLS_TOOL_NAME)
      : null

  const envInfo = await computeEnvInfo(model, additionalWorkingDirectories)

  return [
    ...existingSystemPrompt,
    SYSTEM_PROMPT_ENV_NOTES,
    ...(discoverSkillsGuidance !== null ? [discoverSkillsGuidance] : []),
    envInfo,
  ]
}

export function getOptionalProactiveSection(): string | null {
  return getProactiveSection()
}
