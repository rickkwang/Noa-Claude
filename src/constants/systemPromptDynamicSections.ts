// @ts-nocheck
import { feature } from 'bun:bundle'
import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import {
  AGENT_TOOL_NAME,
  VERIFICATION_AGENT_TYPE,
} from '../tools/AgentTool/constants.js'
import {
  EXPLORE_AGENT,
  EXPLORE_AGENT_MIN_QUERIES,
} from '../tools/AgentTool/built-in/exploreAgent.js'
import { areExplorePlanAgentsEnabled } from '../tools/AgentTool/builtInAgents.js'
import { isForkSubagentEnabled } from '../tools/AgentTool/forkSubagent.js'
import { ASK_USER_QUESTION_TOOL_NAME } from '../tools/AskUserQuestionTool/prompt.js'
import { BASH_TOOL_NAME } from '../tools/BashTool/toolName.js'
import { GLOB_TOOL_NAME } from '../tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '../tools/GrepTool/prompt.js'
import { SKILL_TOOL_NAME } from '../tools/SkillTool/constants.js'
import { hasEmbeddedSearchTools } from '../utils/embeddedTools.js'
import { isUndercover } from '../utils/undercover.js'
import { getAntModelOverrideConfig } from '../utils/model/antModels.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import type { Command } from '../types/command.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
} from '../services/mcp/types.js'
import type { OutputStyleConfig } from './outputStyles.js'
import { prependBullets } from './systemPromptCoreSections.js'

export function getAntModelOverrideSection(): string | null {
  if (process.env.USER_TYPE !== 'ant') return null
  if (isUndercover()) return null
  return getAntModelOverrideConfig()?.defaultSystemPromptSuffix || null
}

export function getLanguageSection(
  languagePreference: string | undefined,
): string | null {
  if (!languagePreference) return null

  return `# Language
Always respond in ${languagePreference}. Use ${languagePreference} for all explanations, comments, and communications with the user. Technical terms and code identifiers should remain in their original form.`
}

// Intentional deviation from upstream: the precedence clause ships only inside
// the (digest-pinned, verbatim-ported) Concise style text, so Explanatory,
// Learning, and custom styles had no arbiter when their rules conflict with
// the main prompt's tone-and-style section. Append it here for any style that
// doesn't carry its own, instead of editing the pinned ports.
const OUTPUT_STYLE_PRECEDENCE_CLAUSE =
  'Where these rules conflict with more general communication or formatting guidance elsewhere in your instructions, these rules win.'

export function getOutputStyleSection(
  outputStyleConfig: OutputStyleConfig | null,
): string | null {
  if (outputStyleConfig === null) return null

  const prompt = outputStyleConfig.prompt.includes('these rules win')
    ? outputStyleConfig.prompt
    : `${outputStyleConfig.prompt}\n\n${OUTPUT_STYLE_PRECEDENCE_CLAUSE}`
  return `# Output Style: ${outputStyleConfig.name}
${prompt}`
}

export function getMcpInstructionsSection(
  mcpClients: MCPServerConnection[] | undefined,
): string | null {
  if (!mcpClients || mcpClients.length === 0) return null
  return getMcpInstructions(mcpClients)
}

function getMcpInstructions(mcpClients: MCPServerConnection[]): string | null {
  const connectedClients = mcpClients.filter(
    (client): client is ConnectedMCPServer => client.type === 'connected',
  )

  const clientsWithInstructions = connectedClients.filter(
    client => client.instructions,
  )

  if (clientsWithInstructions.length === 0) {
    return null
  }

  const instructionBlocks = clientsWithInstructions
    .map(client => {
      return `## ${client.name}
${client.instructions}`
    })
    .join('\n\n')

  return `# MCP Server Instructions

The following MCP servers have provided instructions for how to use their tools and resources:

${instructionBlocks}`
}

function getAgentToolSection(): string {
  return isForkSubagentEnabled()
    ? `Calling ${AGENT_TOOL_NAME} without a subagent_type creates a fork, which runs in the background and keeps its tool output out of your context — so you can keep chatting with the user while it works. Reach for it when research or multi-step implementation work would otherwise fill your context with raw output you won't need again. **If you ARE the fork** — execute directly; do not re-delegate.`
    : `Use the ${AGENT_TOOL_NAME} tool with specialized agents when the task at hand matches the agent's description. Subagents are valuable for parallelizing independent queries or for protecting the main context window from excessive results, but they should not be used excessively when not needed. Importantly, avoid duplicating work that subagents are already doing - if you delegate research to a subagent, do not also perform the same searches yourself.`
}

export function getDiscoverSkillsGuidance(
  discoverSkillsToolName: string | null,
): string | null {
  if (
    !feature('EXPERIMENTAL_SKILL_SEARCH') ||
    discoverSkillsToolName === null
  ) {
    return null
  }

  return `Relevant skills are automatically surfaced each turn as "Skills relevant to your task:" reminders. If you're about to do something those don't cover — a mid-task pivot, an unusual workflow, a multi-step plan — call ${discoverSkillsToolName} with a specific description of what you're doing. Skills already visible or loaded are filtered automatically. Skip this if the surfaced skills already cover your next action.`
}

/**
 * Session-variant guidance that would fragment the cacheScope:'global'
 * prefix if placed before SYSTEM_PROMPT_DYNAMIC_BOUNDARY. Each conditional
 * here is a runtime bit that would otherwise multiply the Blake2b prefix
 * hash variants (2^N). See PR #24490, #24171 for the same bug class.
 *
 * outputStyleConfig intentionally NOT moved here — identity framing lives
 * in the static intro pending eval.
 */
export function getSessionSpecificGuidanceSection(
  enabledTools: Set<string>,
  skillToolCommands: Command[],
  discoverSkillsToolName: string | null,
  autoCompactEnabled: boolean,
): string | null {
  const hasAskUserQuestionTool = enabledTools.has(ASK_USER_QUESTION_TOOL_NAME)
  const hasSkills =
    skillToolCommands.length > 0 && enabledTools.has(SKILL_TOOL_NAME)
  const hasAgentTool = enabledTools.has(AGENT_TOOL_NAME)
  const searchTools = hasEmbeddedSearchTools()
    ? `\`find\` or \`grep\` via the ${BASH_TOOL_NAME} tool`
    : `the ${GLOB_TOOL_NAME} or ${GREP_TOOL_NAME}`
  const skillRoutingHints: Record<string, string> = {
    'update-config': `update-config — for settings, permissions, env vars, hooks, or automated "from now on" behavior.`,
    loop: `loop / schedule — only for recurring, delayed, or monitored work, not one-off tasks.`,
    schedule: `loop / schedule — only for recurring, delayed, or monitored work, not one-off tasks.`,
  }
  const skillRoutingRules = Array.from(
    new Set(
      skillToolCommands
        .map(command => skillRoutingHints[command.name])
        .filter((hint): hint is string => hint !== undefined),
    ),
  )

  const items = [
    // Override the shared compaction guidance when this session disables it.
    !autoCompactEnabled
      ? `Automatic compaction is disabled for this session, so the summarization described under # Context management will not run and the context window is a hard limit. Keep tool output bounded and avoid loading context you do not need.`
      : null,
    hasAskUserQuestionTool
      ? `If you do not understand why the user has denied a tool call, use the ${ASK_USER_QUESTION_TOOL_NAME} to ask them.`
      : null,
    getIsNonInteractiveSession()
      ? null
      : `If you need the user to run a shell command themselves (e.g., an interactive login like \`gcloud auth login\`), suggest they type \`! <command>\` in the prompt — the \`!\` prefix runs the command in this session so its output lands directly in the conversation.`,
    // isForkSubagentEnabled() reads getIsNonInteractiveSession() — must be
    // post-boundary or it fragments the static prefix on session type.
    hasAgentTool ? getAgentToolSection() : null,
    ...(hasAgentTool &&
    areExplorePlanAgentsEnabled() &&
    !isForkSubagentEnabled()
      ? [
          `For simple, directed codebase searches (e.g. for a specific file/class/function) use ${searchTools} directly.`,
          `For broader codebase exploration and deep research, use the ${AGENT_TOOL_NAME} tool with subagent_type=${EXPLORE_AGENT.agentType}. This is slower than using ${searchTools} directly, so use this only when a simple, directed search proves to be insufficient or when your task will clearly require more than ${EXPLORE_AGENT_MIN_QUERIES} queries.`,
        ]
      : []),
    hasSkills
      ? `/<skill-name> (e.g., /commit) is shorthand for invoking a user-invocable skill via the ${SKILL_TOOL_NAME} tool — the skill expands to a full prompt when executed. If the user explicitly names a skill or uses /<skill-name>, invoking that skill is required. When a listed skill clearly and specifically matches the task and provides the intended workflow, invoke it early. Do not treat broad or ambiguous skill matches as a blocking requirement when direct tool use is simpler, more reliable, or clearly better for the task. Only invoke skills listed in the user-invocable skills section — do not guess names or treat built-in CLI commands as skills.`
      : null,
    hasSkills && skillRoutingRules.length > 0
      ? `Skill routing disambiguators (additive — skills not listed below still trigger via their own description; these only clarify the boundaries that are commonly mis-applied): ${skillRoutingRules.join(' ')}`
      : null,
    discoverSkillsToolName !== null &&
    hasSkills &&
    enabledTools.has(discoverSkillsToolName)
      ? getDiscoverSkillsGuidance(discoverSkillsToolName)
      : null,
    hasAgentTool &&
    feature('VERIFICATION_AGENT') &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_hive_evidence', false)
      ? `For implementation work, use the ${AGENT_TOOL_NAME} tool with subagent_type="${VERIFICATION_AGENT_TYPE}" before reporting completion after non-trivial tasks. Non-trivial means: 3+ file edits, backend/API changes, or infrastructure changes. Also use it for smaller changes when the work is risky, cross-cutting, user-visible, or expensive to guess wrong. Pass the original user request, all files changed, the approach taken, and the plan file path if applicable. The verifier runs independently and returns PASS/FAIL/PARTIAL. Use the verifier's verdict rather than substituting your own confidence; you cannot self-assign PASS or PARTIAL. On FAIL: fix the issue and re-run verification until the verifier returns PASS or PARTIAL. On PASS: spot-check a few commands from the report and confirm the evidence matches. On PARTIAL: report what was verified, what could not be verified, and why.`
      : null,
  ].filter(item => item !== null)

  if (items.length === 0) return null
  return ['# Session-specific guidance', ...prependBullets(items)].join('\n')
}
