// @ts-nocheck
/**
 * Agents subcommand handler — prints the list of configured agents and active sessions.
 * Dynamically imported only when `claude agents` runs.
 */

import {
  AGENT_SOURCE_GROUPS,
  compareAgentsByName,
  getOverrideSourceLabel,
  type ResolvedAgent,
  resolveAgentModelDisplay,
  resolveAgentOverrides,
} from '../../tools/AgentTool/agentDisplay.js'
import {
  getActiveAgentsFromList,
  getAgentDefinitionsWithOverrides,
} from '../../tools/AgentTool/loadAgentsDir.js'
import {
  formatRelativeTime,
  readAllSessions,
  truncateCwd,
} from '../../utils/background/sessionRegistry.js'
import { getCwd } from '../../utils/cwd.js'

function formatAgent(agent: ResolvedAgent): string {
  const model = resolveAgentModelDisplay(agent)
  const parts = [agent.agentType]
  if (model) {
    parts.push(model)
  }
  if (agent.memory) {
    parts.push(`${agent.memory} memory`)
  }
  return parts.join(' · ')
}

export async function agentsHandler(): Promise<void> {
  const cwd = getCwd()

  const sessions = await readAllSessions()
  const liveSessions = sessions.filter(s => s.alive)

  if (liveSessions.length > 0) {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`${liveSessions.length} active session${liveSessions.length === 1 ? '' : 's'}\n`)
    for (const s of liveSessions) {
      const state = s.derivedState.padEnd(8)
      const label = (s.name ?? s.kind ?? 'interactive').slice(0, 16).padEnd(16)
      const kind = (s.kind ?? 'interactive').padEnd(13)
      const dir = truncateCwd(s.cwd ?? '.', 25).padEnd(25)
      const time = s.startedAt ? formatRelativeTime(s.startedAt) : ''
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`  ${state}  ${label}  ${kind}  ${dir}  ${time}`)
    }
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log('')
  }

  const { allAgents } = await getAgentDefinitionsWithOverrides(cwd)
  const activeAgents = getActiveAgentsFromList(allAgents)
  const resolvedAgents = resolveAgentOverrides(allAgents, activeAgents)

  const lines: string[] = []
  let totalActive = 0

  for (const { label, source } of AGENT_SOURCE_GROUPS) {
    const groupAgents = resolvedAgents
      .filter(a => a.source === source)
      .sort(compareAgentsByName)

    if (groupAgents.length === 0) continue

    lines.push(`${label}:`)
    for (const agent of groupAgents) {
      if (agent.overriddenBy) {
        const winnerSource = getOverrideSourceLabel(agent.overriddenBy)
        lines.push(`  (shadowed by ${winnerSource}) ${formatAgent(agent)}`)
      } else {
        lines.push(`  ${formatAgent(agent)}`)
        totalActive++
      }
    }
    lines.push('')
  }

  if (lines.length === 0 && liveSessions.length === 0) {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log('No agents or sessions found.')
  } else if (lines.length > 0) {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`${totalActive} active agents\n`)
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(lines.join('\n').trimEnd())
  }
}
