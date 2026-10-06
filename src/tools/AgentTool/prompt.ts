import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { getSubscriptionType } from '../../utils/auth.js'
import { hasEmbeddedSearchTools } from '../../utils/embeddedTools.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../../utils/envUtils.js'
import { isTeammate } from '../../utils/teammate.js'
import { isInProcessTeammate } from '../../utils/teammateContext.js'
import { FILE_READ_TOOL_NAME } from '../FileReadTool/prompt.js'
import { GLOB_TOOL_NAME } from '../GlobTool/prompt.js'
import { SEND_MESSAGE_TOOL_NAME } from '../SendMessageTool/constants.js'
import { AGENT_TOOL_NAME } from './constants.js'
import { shouldUseCompactSystemPrompt } from '../../constants/systemPromptCompact.js'
import type { AgentDefinition } from './loadAgentsDir.js'

function getToolsDescription(agent: AgentDefinition): string {
  const { tools, disallowedTools } = agent
  const hasAllowlist = tools && tools.length > 0
  const hasDenylist = disallowedTools && disallowedTools.length > 0

  if (hasAllowlist && hasDenylist) {
    // Both defined: filter allowlist by denylist to match runtime behavior
    const denySet = new Set(disallowedTools)
    const effectiveTools = tools.filter(t => !denySet.has(t))
    if (effectiveTools.length === 0) {
      return 'None'
    }
    return effectiveTools.join(', ')
  } else if (hasAllowlist) {
    // Allowlist only: show the specific tools available
    return tools.join(', ')
  } else if (hasDenylist) {
    // Denylist only: show "All tools except X, Y, Z"
    return `All tools except ${disallowedTools.join(', ')}`
  }
  // No restrictions
  return 'All tools'
}

/**
 * Format one agent line for the agent_listing_delta attachment message:
 * `- type: whenToUse (Tools: ...)`.
 */
export function formatAgentLine(agent: AgentDefinition): string {
  const toolsDescription = getToolsDescription(agent)
  return `- ${agent.agentType}: ${agent.whenToUse} (Tools: ${toolsDescription})`
}

/**
 * Whether the agent list should be injected as an attachment message instead
 * of embedded in the tool description. When true, getPrompt() returns a static
 * description and attachments.ts emits an agent_listing_delta attachment.
 *
 * The dynamic agent list was ~10.2% of fleet cache_creation tokens: MCP async
 * connect, /reload-plugins, or permission-mode changes mutate the list →
 * description changes → full tool-schema cache bust.
 *
 * Override with CLAUDE_CODE_AGENT_LIST_IN_MESSAGES=true/false for testing.
 */
export function shouldInjectAgentListInMessages(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_AGENT_LIST_IN_MESSAGES)) return true
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_AGENT_LIST_IN_MESSAGES))
    return false
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_agent_list_attach', false)
}

export async function getPrompt(
  agentDefinitions: AgentDefinition[],
  isCoordinator?: boolean,
  allowedAgentTypes?: string[],
  model?: string,
): Promise<string> {
  // Filter agents by allowed types when Agent(x,y) restricts which agents can be spawned
  const effectiveAgents = allowedAgentTypes
    ? agentDefinitions.filter(a => allowedAgentTypes.includes(a.agentType))
    : agentDefinitions

  const writingThePromptSection = `

## Writing the prompt

Brief the agent like a smart colleague who just walked into the room — it hasn't seen this conversation, doesn't know what you've tried, doesn't understand why this task matters.
- Explain what you're trying to accomplish and why.
- Describe what you've already learned or ruled out.
- Give enough context about the surrounding problem that the agent can make judgment calls rather than just following a narrow instruction.
- If you need a short response, say so ("report in under 200 words").
- Lookups: hand over the exact command. Investigations: hand over the question — prescribed steps become dead weight when the premise is wrong.

Terse command-style prompts produce shallow, generic work.

**Never delegate understanding.** Don't write "based on your findings, fix the bug" or "based on the research, implement it." Those phrases push synthesis onto the agent instead of doing it yourself. Write prompts that prove you understood: include file paths, line numbers, what specifically to change.
`

  const currentExamples = `Example usage:

<example>
user: "What's left on this branch before we can ship?"
assistant: <thinking>A survey question across git state, tests, and config. I'll delegate it and ask for a short report so the raw command output stays out of my context.</thinking>
${AGENT_TOOL_NAME}({
  description: "Branch ship-readiness audit",
  prompt: "Audit what's left before this branch can ship. Check: uncommitted changes, commits ahead of main, whether tests exist, whether the GrowthBook gate is wired up, whether CI-relevant files changed. Report a punch list — done vs. missing. Under 200 words."
})
<commentary>
The prompt is self-contained: it states the goal, lists what to check, and caps the response length. The agent's report comes back as the tool result; relay the findings to the user.
</commentary>
</example>

<example>
user: "Can you get a second opinion on whether this migration is safe?"
assistant: <thinking>I'll ask the code-reviewer agent — it won't see my analysis, so it can give an independent read.</thinking>
${AGENT_TOOL_NAME}({
  description: "Independent migration review",
  subagent_type: "code-reviewer",
  prompt: "Review migration 0042_user_schema.sql for safety. Context: we're adding a NOT NULL column to a 50M-row table. Existing rows get a backfill default. I want a second opinion on whether the backfill approach is safe under concurrent writes — I've checked locking behavior but want independent verification. Report: is this safe, and if not, what specifically breaks?"
})
<commentary>
The agent starts with no context from this conversation, so the prompt briefs it: what to assess, the relevant background, and what form the answer should take.
</commentary>
</example>
`

  // When the gate is on, the agent list lives in an agent_listing_delta
  // attachment (see attachments.ts) instead of inline here. This keeps the
  // tool description static across MCP/plugin/permission changes so the
  // tools-block prompt cache doesn't bust every time an agent loads.
  const listViaAttachment = shouldInjectAgentListInMessages()

  const agentListSection = listViaAttachment
    ? `Available agent types are listed in <system-reminder> messages in the conversation.`
    : `Available agent types and the tools they have access to:
${effectiveAgents.map(agent => formatAgentLine(agent)).join('\n')}`

  // Shared core prompt used by both coordinator and non-coordinator modes
  const shared = `Launch a new agent to handle complex, multi-step tasks autonomously.

The ${AGENT_TOOL_NAME} tool launches specialized agents (subprocesses) that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

${agentListSection}

When using the ${AGENT_TOOL_NAME} tool, specify a subagent_type parameter to select which agent type to use. If omitted, the general-purpose agent is used.`

  // Coordinator mode gets the slim prompt -- the coordinator system prompt
  // already covers usage notes, examples, and when-not-to-use guidance.
  if (isCoordinator) {
    return shared
  }

  // Lean variant. Unlike the other tool ports this one is an adaptation, not a
  // verbatim copy — the agent surface itself differs here, so several of
  // upstream's sentences describe behaviour we don't have:
  //
  //   - agent definitions live under `.noa/`, not `.claude/`
  //   - omitted subagent_type selects general-purpose; implicit forks are
  //     unavailable in this build
  //   - the agent list is inlined; upstream points at a <system-reminder>
  //
  // Everything else follows upstream's lean branch. Note that its "## When not
  // to use" text is built into a local and then never interpolated into either
  // return — dead on their side, and absent from a real 2.1.220 transcript — so
  // what ships here is its "## When to use" section instead. Upstream picks
  // between a long and a short variant on a steering-mode flag we don't have,
  // and suppresses the section entirely behind a plan-tier notice we also don't
  // have; the long variant is the one its default mode emits.
  if (shouldUseCompactSystemPrompt(model)) {
    const subagentTypeLine = `When using the ${AGENT_TOOL_NAME} tool, specify a subagent_type parameter to select which agent type to use. If omitted, the general-purpose agent is used.`


    const backgroundNote =
      !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS) &&
      !isInProcessTeammate()
        ? "\n- Subagents run in the background by default; you'll be notified when one completes. Pass `run_in_background: false` only when your very next action depends on the result and nothing else could usefully happen while it runs — otherwise background it so the user can interject. Never fabricate or predict a pending agent's results — the notification is never something you write yourself; if the user asks before it arrives, say it's still running."
        : ''

    const teammateNote = isInProcessTeammate()
      ? '\n- `run_in_background`, `name` and `team_name` are unavailable here — only synchronous subagents.'
      : isTeammate()
        ? '\n- `name` and `team_name` are unavailable here — teammates cannot spawn teammates.'
        : ''

    return `Launch a new agent to handle complex, multi-step tasks. Each agent type has specific capabilities and tools available to it.

${agentListSection}

${subagentTypeLine}

## When to use
Reach for this when the task matches an available agent type, when you have independent work to run in parallel, or when answering would mean reading across several files — delegate it and you keep the conclusion, not the file dumps. For a single-fact lookup where you already know the file, symbol, or value, search directly. Once you've delegated a search, don't also run it yourself — wait for the result.

- The agent's final report is not shown to the user — relay what matters.
- Use ${SEND_MESSAGE_TOOL_NAME} with the agent's ID or name to continue a previously spawned agent with its context intact; a new ${AGENT_TOOL_NAME} call starts fresh.
- Each agent type's model, reasoning effort, and tools come from its definition (\`.noa/agents/*.md\` frontmatter or SDK \`agents\`).
- \`isolation: "worktree"\` gives the agent its own git worktree (auto-cleaned if unchanged).${backgroundNote}${teammateNote}`
  }

  // Ant-native builds alias find/grep to embedded bfs/ugrep and remove the
  // dedicated Glob/Grep tools, so point at find via Bash instead.
  const embedded = hasEmbeddedSearchTools()
  const fileSearchHint = embedded
    ? '`find` via the Bash tool'
    : `the ${GLOB_TOOL_NAME} tool`
  // The "class Foo" example is about content search. Non-embedded stays Glob
  // (original intent: find-the-file-containing). Embedded gets grep because
  // find -name doesn't look at file contents.
  const contentSearchHint = embedded
    ? '`grep` via the Bash tool'
    : `the ${GLOB_TOOL_NAME} tool`
  const whenNotToUseSection = `
When NOT to use the ${AGENT_TOOL_NAME} tool:
- If you want to read a specific file path, use the ${FILE_READ_TOOL_NAME} tool or ${fileSearchHint} instead of the ${AGENT_TOOL_NAME} tool, to find the match more quickly
- If you are searching for a specific class definition like "class Foo", use ${contentSearchHint} instead, to find the match more quickly
- If you are searching for code within a specific file or set of 2-3 files, use the ${FILE_READ_TOOL_NAME} tool instead of the ${AGENT_TOOL_NAME} tool, to find the match more quickly
- Other tasks that are not related to the agent descriptions above
`

  // When listing via attachment, the "launch multiple agents" note is in the
  // attachment message (conditioned on subscription there). When inline, keep
  // the existing per-call getSubscriptionType() check.
  const concurrencyNote =
    !listViaAttachment && getSubscriptionType() !== 'pro'
      ? `
- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses`
      : ''

  // Non-coordinator gets the full prompt with all sections
  return `${shared}
${whenNotToUseSection}

Usage notes:
- Always include a short description (3-5 words) summarizing what the agent will do${concurrencyNote}
- When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.${
    // eslint-disable-next-line custom-rules/no-process-env-top-level
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS) &&
    !isInProcessTeammate()
      ? `
- Agents run in the background by default. When an agent runs in the background, you will be automatically notified when it completes — do NOT sleep, poll, or proactively check on its progress. Continue with other work or respond to the user instead.
- **Foreground vs background**: Pass run_in_background: false only when your very next action depends on the result and nothing else could usefully happen while it runs — otherwise leave it in the background so the user can interject.`
      : ''
  }
- To continue a previously spawned agent, use ${SEND_MESSAGE_TOOL_NAME} with the agent's ID or name as the \`to\` field. The agent resumes with its full context preserved. Each Agent invocation starts fresh — provide a complete task description.
- Trust but verify: an agent's summary describes what it intended to do, not necessarily what it did. When an agent writes or edits code, check the actual changes before reporting the work as done.
- Clearly tell the agent whether you expect it to write code or just to do research (search, file reads, web fetches, etc.), since it is not aware of the user's intent
- If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.
- If the user specifies that they want you to run agents "in parallel", you MUST send a single message with multiple ${AGENT_TOOL_NAME} tool use content blocks. For example, if you need to launch both a build-validator agent and a test-runner agent in parallel, send a single message with both tool calls.
- You can optionally set \`isolation: "worktree"\` to run the agent in a temporary git worktree, giving it an isolated copy of the repository. The worktree is automatically cleaned up if the agent makes no changes; if changes are made, the worktree path and branch are returned in the result.${
    process.env.USER_TYPE === 'ant'
      ? `\n- You can set \`isolation: "remote"\` to run the agent in a remote CCR environment. This is always a background task; you'll be notified when it completes. Use for long-running tasks that need a fresh sandbox.`
      : ''
  }${
    isInProcessTeammate()
      ? `
- The run_in_background, name, team_name, and mode parameters are not available in this context. Only synchronous subagents are supported.`
      : isTeammate()
        ? `
- The name, team_name, and mode parameters are not available in this context — teammates cannot spawn other teammates. Omit them to spawn a subagent.`
        : ''
  }${writingThePromptSection}

${currentExamples}`
}
