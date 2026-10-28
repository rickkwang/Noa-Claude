// @ts-nocheck
import type { AppState } from '../../state/AppStateStore.js'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import type { Tools, ToolUseContext } from '../../Tool.js'
import type { AgentDefinitionsResult } from '../../tools/AgentTool/loadAgentsDir.js'
import type { Message } from '../../types/message.js'
import {
  analyzeContextUsage,
  buildContextUsage,
  formatApproxTokens,
  formatContextOverLimit,
  type ContextData,
  type ContextDetail,
} from '../../utils/analyzeContext.js'
import { formatTokens } from '../../utils/format.js'
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js'
import { getSourceDisplayName } from '../../utils/settings/constants.js'

/**
 * Shared data-collection path for `/context` (slash command) and the SDK
 * `get_context_usage` control request. Applies the compact boundary, the same
 * transform `/context` uses, so the token count reflects what the model sees.
 */
type CollectContextDataInput = {
  messages: Message[]
  getAppState: () => AppState
  options: {
    mainLoopModel: string
    tools: Tools
    agentDefinitions: AgentDefinitionsResult
    customSystemPrompt?: string
    appendSystemPrompt?: string
    mcpClients?: ToolUseContext['options']['mcpClients']
    autoCompactWindow?: ToolUseContext['options']['autoCompactWindow']
  }
  detail?: ContextDetail
  terminalWidth?: number
  localPaths?: boolean
}

export async function collectContextData(
  context: CollectContextDataInput,
): Promise<ContextData> {
  const {
    messages,
    getAppState,
    options: {
      mainLoopModel,
      tools,
      agentDefinitions,
      customSystemPrompt,
      appendSystemPrompt,
      mcpClients,
      autoCompactWindow,
    },
    detail = 'full',
    terminalWidth,
    localPaths = false,
  } = context

  const apiView = getMessagesAfterCompactBoundary(messages)
  const appState = getAppState()

  return analyzeContextUsage(
    apiView,
    mainLoopModel,
    async () => appState.toolPermissionContext,
    tools,
    agentDefinitions,
    terminalWidth,
    // analyzeContextUsage only reads options.* from this argument, but its
    // signature declares the full Pick<ToolUseContext, 'options'>.
    {
      options: { customSystemPrompt, appendSystemPrompt, mcpClients },
    } as Pick<ToolUseContext, 'options'>,
    undefined, // mainThreadAgentDefinition
    apiView, // original messages for API usage extraction
    detail,
    autoCompactWindow,
    localPaths,
  )
}

export async function call(
  _args: string,
  context: ToolUseContext,
): Promise<{
  type: 'text'
  value: string
  contextUsage: ReturnType<typeof buildContextUsage>
}> {
  const data = await collectContextData(context)
  const outputData = getIsRemoteMode()
    ? { ...data, memoryFiles: [] }
    : data
  return {
    type: 'text' as const,
    value: formatContextAsMarkdownTable(outputData),
    contextUsage: buildContextUsage(outputData),
  }
}

export function formatContextAsMarkdownTable(data: ContextData): string {
  const {
    categories,
    totalTokens,
    rawMaxTokens,
    percentage,
    model,
    memoryFiles,
    mcpTools,
    agents,
    skills,
  } = data

  let output = `## Context Usage\n\n`
  output += `**Model:** ${model}  \n`
  output += `**Tokens:** ${formatTokens(totalTokens)} / ${formatTokens(rawMaxTokens)} (${percentage}%)\n`
  const overLimit = formatContextOverLimit(data)
  if (overLimit) {
    output += `**Over limit:** ${overLimit}\n`
  }
  output += '\n'

  // Main categories table
  const visibleCategories = categories.filter(
    cat =>
      cat.tokens > 0 &&
      cat.name !== 'Free space' &&
      cat.name !== 'Autocompact buffer',
  )

  if (visibleCategories.length > 0) {
    output += `### Estimated usage by category\n\n`
    output += `| Category | Tokens | Percentage |\n`
    output += `|----------|--------|------------|\n`

    for (const cat of visibleCategories) {
      const percentDisplay = ((cat.tokens / rawMaxTokens) * 100).toFixed(1)
      output += `| ${cat.name} | ${formatTokens(cat.tokens)} | ${percentDisplay}% |\n`
    }

    const freeSpaceCategory = categories.find(c => c.name === 'Free space')
    if (freeSpaceCategory && freeSpaceCategory.tokens > 0) {
      const percentDisplay = (
        (freeSpaceCategory.tokens / rawMaxTokens) *
        100
      ).toFixed(1)
      output += `| Free space | ${formatTokens(freeSpaceCategory.tokens)} | ${percentDisplay}% |\n`
    }

    const autocompactCategory = categories.find(
      c => c.name === 'Autocompact buffer',
    )
    if (autocompactCategory && autocompactCategory.tokens > 0) {
      const percentDisplay = (
        (autocompactCategory.tokens / rawMaxTokens) *
        100
      ).toFixed(1)
      output += `| Autocompact buffer | ${formatTokens(autocompactCategory.tokens)} | ${percentDisplay}% |\n`
    }

    output += `\n`
  }

  // MCP tools
  if (mcpTools.length > 0) {
    output += `### MCP Tools\n\n`
    output += `| Tool | Server | Tokens |\n`
    output += `|------|--------|--------|\n`
    for (const tool of mcpTools) {
      output += `| ${tool.name} | ${tool.serverName} | ${formatTokens(tool.tokens)} |\n`
    }
    output += `\n`
  }

  // Custom agents
  if (agents.length > 0) {
    output += `### Custom Agents\n\n`
    output += `| Agent Type | Source | Tokens |\n`
    output += `|------------|--------|--------|\n`
    for (const agent of agents) {
      let sourceDisplay: string
      switch (agent.source) {
        case 'projectSettings':
          sourceDisplay = 'Project'
          break
        case 'userSettings':
          sourceDisplay = 'User'
          break
        case 'localSettings':
          sourceDisplay = 'Local'
          break
        case 'flagSettings':
          sourceDisplay = 'Flag'
          break
        case 'policySettings':
          sourceDisplay = 'Policy'
          break
        case 'plugin':
          sourceDisplay = 'Plugin'
          break
        case 'built-in':
          sourceDisplay = 'Built-in'
          break
        default:
          sourceDisplay = String(agent.source)
      }
      output += `| ${agent.agentType} | ${sourceDisplay} | ${formatTokens(agent.tokens)} |\n`
    }
    output += `\n`
  }

  // Memory files
  if (memoryFiles.length > 0) {
    output += `### Memory Files\n\n`
    output += `| Type | Path | Tokens |\n`
    output += `|------|------|--------|\n`
    for (const file of memoryFiles) {
      output += `| ${file.type} | ${file.path} | ${formatTokens(file.tokens)} |\n`
    }
    output += `\n`
  }

  // Skills
  if (skills && skills.tokens > 0 && skills.skillFrontmatter.length > 0) {
    output += `### Skills\n\n`
    output += `| Skill | Source | Tokens |\n`
    output += `|-------|--------|--------|\n`
    for (const skill of skills.skillFrontmatter) {
      const sourceLabel = `${getSourceDisplayName(skill.source)}${
        skill.pluginName && skill.source !== 'syncedSkills'
          ? ` (${skill.pluginName})`
          : ''
      }`
      output += `| ${skill.name} | ${sourceLabel} | ${formatApproxTokens(skill.tokens)} |\n`
    }
    output += `\n`
  }

  return output
}
