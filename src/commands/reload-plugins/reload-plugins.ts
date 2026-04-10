// @ts-nocheck
import { feature } from 'bun:bundle'
import { clearCommandMemoizationCaches } from '../../commands.js'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import { getAgentDefinitionsWithOverrides } from '../../tools/AgentTool/loadAgentsDir.js'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { getPluginCommands } from '../../utils/plugins/loadPluginCommands.js'
import { redownloadUserSettings } from '../../services/settingsSync/index.js'
import type { LocalCommandCall } from '../../types/command.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { refreshActivePlugins } from '../../utils/plugins/refresh.js'
import { settingsChangeDetector } from '../../utils/settings/changeDetector.js'
import { plural } from '../../utils/stringUtils.js'

export const call: LocalCommandCall = async (_args, context) => {
  // CCR: re-pull user settings before the cache sweep so enabledPlugins /
  // extraKnownMarketplaces pushed from the user's local CLI (settingsSync)
  // take effect. Non-CCR headless (e.g. vscode SDK subprocess) shares disk
  // with whoever writes settings — the file watcher delivers changes, no
  // re-pull needed there.
  //
  // Managed settings intentionally NOT re-fetched: it already polls hourly
  // (POLLING_INTERVAL_MS), and policy enforcement is eventually-consistent
  // by design (stale-cache fallback on fetch failure). Interactive
  // /reload-plugins has never re-fetched it either.
  //
  // No retries: user-initiated command, one attempt + fail-open. The user
  // can re-run /reload-plugins to retry. Startup path keeps its retries.
  if (
    feature('DOWNLOAD_USER_SETTINGS') &&
    (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) || getIsRemoteMode())
  ) {
    const applied = await redownloadUserSettings()
    // applyRemoteEntriesToLocal uses markInternalWrite to suppress the
    // file watcher (correct for startup, nothing listening yet); fire
    // notifyChange here so mid-session applySettingsChange runs.
    if (applied) {
      settingsChangeDetector.notifyChange('userSettings')
    }
  }

  const [beforePluginCommands, beforeAgentDefinitions] = await Promise.all([
    getPluginCommands(),
    getAgentDefinitionsWithOverrides(getOriginalCwd()),
  ])

  const beforeSkillFingerprintByName = new Map(
    beforePluginCommands.map(command => [
      command.name,
      `${command.description}|${command.whenToUse ?? ''}|${command.version ?? ''}`,
    ]),
  )
  const beforeAgentFingerprintByKey = new Map(
    beforeAgentDefinitions.allAgents.map(agent => [
      `${agent.source}:${agent.agentType}`,
      `${agent.model ?? ''}|${agent.memory ?? ''}|${agent.prompt ?? ''}|${agent.baseDir ?? ''}`,
    ]),
  )

  const r = await refreshActivePlugins(context.setAppState)
  clearCommandMemoizationCaches()

  const afterSkillFingerprintByName = new Map(
    r.pluginCommands.map(command => [
      command.name,
      `${command.description}|${command.whenToUse ?? ''}|${command.version ?? ''}`,
    ]),
  )
  const afterAgentFingerprintByKey = new Map(
    r.agentDefinitions.allAgents.map(agent => [
      `${agent.source}:${agent.agentType}`,
      `${agent.model ?? ''}|${agent.memory ?? ''}|${agent.prompt ?? ''}|${agent.baseDir ?? ''}`,
    ]),
  )

  let addedSkillCount = 0
  let changedSkillCount = 0
  for (const [name, afterFingerprint] of afterSkillFingerprintByName) {
    const beforeFingerprint = beforeSkillFingerprintByName.get(name)
    if (!beforeFingerprint) {
      addedSkillCount++
    } else if (beforeFingerprint !== afterFingerprint) {
      changedSkillCount++
    }
  }

  let addedAgentCount = 0
  let changedAgentCount = 0
  for (const [key, afterFingerprint] of afterAgentFingerprintByKey) {
    const beforeFingerprint = beforeAgentFingerprintByKey.get(key)
    if (!beforeFingerprint) {
      addedAgentCount++
    } else if (beforeFingerprint !== afterFingerprint) {
      changedAgentCount++
    }
  }

  const parts = [
    n(r.enabled_count, 'plugin'),
    n(r.command_count, 'skill'),
    n(r.agent_count, 'agent'),
    n(r.hook_count, 'hook'),
    // "plugin MCP/LSP" disambiguates from user-config/built-in servers,
    // which /reload-plugins doesn't touch. Commands/hooks are plugin-only;
    // agent_count is total agents (incl. built-ins). (gh-31321)
    n(r.mcp_count, 'plugin MCP server'),
    n(r.lsp_count, 'plugin LSP server'),
  ]
  let msg = `Reloaded: ${parts.join(' · ')}`
  msg += `\nHot-reload: skills +${addedSkillCount}/~${changedSkillCount} · agents +${addedAgentCount}/~${changedAgentCount}`
  msg += '\nPlugin skills are active in this session.'

  if (r.error_count > 0) {
    msg += `\n${n(r.error_count, 'error')} during load. Run /doctor for details.`
  }

  return { type: 'text', value: msg }
}

function n(count: number, noun: string): string {
  return `${count} ${plural(count, noun)}`
}
