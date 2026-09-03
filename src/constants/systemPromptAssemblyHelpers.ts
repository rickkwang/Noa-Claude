// @ts-nocheck
import { feature } from 'bun:bundle'
import type { MCPServerConnection } from '../services/mcp/types.js'
import { isAutoCompactEnabled } from '../services/compact/autoCompact.js'
import type { Tools } from '../Tool.js'
import { getSkillToolCommands } from 'src/commands.js'
import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import { getSessionStartDate } from './common.js'
import { getCwd } from '../utils/cwd.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import { isMcpInstructionsDeltaEnabled } from '../utils/mcpInstructionsDelta.js'
import { loadMemoryPrompt } from '../memdir/memdir.js'
import {
  DEFAULT_OUTPUT_STYLE_NAME,
  getOutputStyleConfig,
} from './outputStyles.js'
import {
  DANGEROUS_uncachedSystemPromptSection,
  systemPromptSection,
} from './systemPromptSections.js'
import {
  getActionCautionSection,
  getAntiVerbositySection,
  getCompactHeadSection,
  hasFable51PromptBundle,
  hasFableMitigations,
  hasOpus5PromptBundle,
  shouldUseCompactSystemPrompt,
} from './systemPromptCompact.js'
import {
  ACT_DONT_REDERIVE_SECTION,
  AUTONOMY_SECTION,
  BOUNDED_TARGET_DISCOVERY_SECTION,
  CONTEXT_MANAGEMENT_SECTION,
  CORRECTIONS_SECTION,
  DELIVERING_WORK_SECTION,
  PRONOUNS_SECTION,
  getActionsSection,
  getCoreExecutionGuardsSection,
  getDoingTasksSection,
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
    // Simple mode never assembles the dynamic sections, so the target-discovery
    // rule (which lives there now) has to be repeated here explicitly.
    BOUNDED_TARGET_DISCOVERY_SECTION,
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
  // Three independent gates land here, and each section keys off whichever one
  // actually drives its text — see hasOpus5PromptBundle() for why they are not
  // the same question. Of the four lean models, only Opus 5 carries the bundle;
  // the fable branch covers Fable 5 and Mythos 5.
  const lean = shouldUseCompactSystemPrompt(model)
  const bundle = hasOpus5PromptBundle(model)
  const fable = hasFableMitigations(model)
  const fable51 = hasFable51PromptBundle(model)
  const autoCompactEnabled = isAutoCompactEnabled()
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
  const antiVerbosityName = fable51
    ? 'anti_verbosity:turn_updates'
    : fable
      ? 'anti_verbosity:fable'
      : `anti_verbosity${antiVerbosity !== null ? ':L' : ''}`

  return [
    systemPromptSection(antiVerbosityName, () => antiVerbosity),
    systemPromptSection('pronouns', () => PRONOUNS_SECTION),
    systemPromptSection(actionCautionName, () =>
      getActionCautionSection(model),
    ),
    systemPromptSection(
      `session_guidance:${autoCompactEnabled ? 'ac' : 'noac'}`,
      () => getSessionSpecificGuidanceSection(
        enabledTools,
        skillToolCommands,
        DISCOVER_SKILLS_TOOL_NAME,
        autoCompactEnabled,
      ),
    ),
    systemPromptSection('memory', () => loadMemoryPrompt()),
    systemPromptSection('ant_model_override', () =>
      getAntModelOverrideSection(),
    ),
    systemPromptSection(`env_info_simple:${model}`, () =>
      computeMainSessionEnvInfo(model, additionalWorkingDirectories),
    ),
    systemPromptSection('language', () => getLanguageSection(language)),
    // Keyed by style name, not the bare section name: the cache lives until
    // /clear or /compact, so a mid-session switch (via /config) would otherwise
    // keep serving whatever the style was on the first turn — and when that was
    // `default` the section is null, leaving the model with a per-turn reminder
    // ("X output style is active…") pointing at guidelines never sent. Upstream
    // keys this one on the bare name and has that gap; this is the same
    // cache-key rule the lean/verbose sections above follow.
    systemPromptSection(
      `output_style:${outputStyleConfig?.name ?? DEFAULT_OUTPUT_STYLE_NAME}`,
      () => getOutputStyleSection(outputStyleConfig),
    ),
    systemPromptSection('target_discovery', () =>
      BOUNDED_TARGET_DISCOVERY_SECTION,
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
    systemPromptSection(`frc:${model}`, () =>
      getFunctionResultClearingSection(model),
    ),
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
    // on the lean prompt: three of the four lean models (Fable 5, Mythos 5,
    // Opus 4.8) do not carry the bundle, so substituting `lean` here would ship
    // them a prompt no upstream build produces. They restate, in one place, the
    // scope and self-correction discipline that the verbose head spells out
    // across its own sections.
    // `delivering_work` is the one companion the Fable 5.1 bundle also turns on
    // (upstream: `tU(model) || tnr(model)`); `corrections` below stays on the
    // Opus 5 bundle alone, so the two keys are no longer the same suffix.
    systemPromptSection(
      `delivering_work${bundle || fable51 ? ':L' : ''}`,
      () => (bundle || fable51 ? DELIVERING_WORK_SECTION : null),
    ),
    systemPromptSection(`corrections${bundleSuffix}`, () =>
      bundle ? CORRECTIONS_SECTION : null,
    ),
    // Gated on the Fable branch AND a non-interactive session — see
    // AUTONOMY_SECTION for why the second condition is ours. Only the model bit
    // varies mid-session (/model switch); the session kind is fixed at startup,
    // so it stays out of the key.
    systemPromptSection(`autonomy_append${fable ? ':fable' : ''}`, () =>
      fable && getIsNonInteractiveSession() ? AUTONOMY_SECTION : null,
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
        getSimpleIntroSection(hasOutputStyle),
        getSimpleSystemSection(),
        getDoingTasksSection(enabledTools, includeCodingStyleSection),
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
