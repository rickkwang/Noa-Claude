// @ts-nocheck
import figures from 'figures'
import * as React from 'react'
import type { SettingSource } from 'src/utils/settings/constants.js'
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js'
import { Box, Text } from '../../ink.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import type { ResolvedAgent } from '../../tools/AgentTool/agentDisplay.js'
import {
  AGENT_SOURCE_GROUPS,
  compareAgentsByName,
  getOverrideSourceLabel,
  resolveAgentModelDisplay,
} from '../../tools/AgentTool/agentDisplay.js'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import { Divider } from '../design-system/Divider.js'
import { Pane } from '../design-system/Pane.js'

export type AgentListView = 'running' | 'library'

const VIEW_ORDER: AgentListView[] = ['running', 'library']

type Props = {
  source: SettingSource | 'all' | 'built-in' | 'plugin'
  agents: ResolvedAgent[]
  onBack: () => void
  onSelect: (agent: AgentDefinition) => void
  onCreateNew?: () => void
  changes?: string[]
  view: AgentListView
  onViewChange: (view: AgentListView) => void
}

export function AgentsList({
  source,
  agents,
  onBack,
  onSelect,
  onCreateNew,
  changes,
  view,
  onViewChange,
}: Props): React.ReactNode {
  const [selectedAgent, setSelectedAgent] = React.useState<ResolvedAgent | null>(
    null,
  )
  const [isCreateNewSelected, setIsCreateNewSelected] = React.useState(
    view === 'library',
  )

  const sortedAgents = React.useMemo(
    () => [...agents].sort(compareAgentsByName),
    [agents],
  )

  const selectableAgentsInOrder = React.useMemo(() => {
    const nonBuiltIn = sortedAgents.filter(a => a.source !== 'built-in')
    if (view === 'running') {
      return nonBuiltIn
    }
    if (source === 'all') {
      return AGENT_SOURCE_GROUPS.filter(g => g.source !== 'built-in').flatMap(
        ({ source: groupSource }) =>
          nonBuiltIn.filter(a => a.source === groupSource),
      )
    }
    return nonBuiltIn
  }, [sortedAgents, source, view])

  const createEnabled = view === 'library' && !!onCreateNew

  React.useEffect(() => {
    setSelectedAgent(selectableAgentsInOrder[0] ?? null)
    setIsCreateNewSelected(createEnabled)
  }, [createEnabled, selectableAgentsInOrder, view])

  useKeybinding('confirm:no', onBack, { context: 'Confirmation', isActive: true })

  const switchView = React.useCallback(
    (next: AgentListView) => {
      if (next !== view) onViewChange(next)
    },
    [onViewChange, view],
  )

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'right' || e.key === 'tab') {
      e.preventDefault()
      const idx = VIEW_ORDER.indexOf(view)
      switchView(VIEW_ORDER[(idx + 1) % VIEW_ORDER.length]!)
      return
    }
    if (e.key === 'left') {
      e.preventDefault()
      const idx = VIEW_ORDER.indexOf(view)
      switchView(VIEW_ORDER[(idx - 1 + VIEW_ORDER.length) % VIEW_ORDER.length]!)
      return
    }

    if (e.key === 'return') {
      e.preventDefault()
      if (isCreateNewSelected && createEnabled) {
        onCreateNew?.()
      } else if (selectedAgent) {
        onSelect(selectedAgent)
      }
      return
    }

    if (e.key !== 'up' && e.key !== 'down') return
    e.preventDefault()

    const totalItems = selectableAgentsInOrder.length + (createEnabled ? 1 : 0)
    if (totalItems === 0) return

    let currentPosition = 0
    if (!isCreateNewSelected && selectedAgent) {
      const agentIndex = selectableAgentsInOrder.findIndex(
        a =>
          a.agentType === selectedAgent.agentType &&
          a.source === selectedAgent.source,
      )
      if (agentIndex >= 0) {
        currentPosition = createEnabled ? agentIndex + 1 : agentIndex
      }
    }

    const nextPosition =
      e.key === 'up'
        ? currentPosition === 0
          ? totalItems - 1
          : currentPosition - 1
        : currentPosition === totalItems - 1
          ? 0
          : currentPosition + 1

    if (createEnabled && nextPosition === 0) {
      setIsCreateNewSelected(true)
      setSelectedAgent(null)
      return
    }

    const nextAgentIndex = createEnabled ? nextPosition - 1 : nextPosition
    const nextAgent = selectableAgentsInOrder[nextAgentIndex]
    if (nextAgent) {
      setIsCreateNewSelected(false)
      setSelectedAgent(nextAgent)
    }
  }

  const renderAgent = (agent: ResolvedAgent): React.ReactNode => {
    const isBuiltIn = agent.source === 'built-in'
    const isSelected =
      !isBuiltIn &&
      !isCreateNewSelected &&
      selectedAgent?.agentType === agent.agentType &&
      selectedAgent?.source === agent.source
    const isOverridden = !!agent.overriddenBy
    const dimmed = isBuiltIn || isOverridden
    const textColor = !isBuiltIn && isSelected ? 'suggestion' : undefined
    const resolvedModel = resolveAgentModelDisplay(agent)

    return (
      <Box key={`${agent.agentType}-${agent.source}`}>
        <Text dimColor={dimmed && !isSelected} color={textColor}>
          {isBuiltIn ? '  ' : isSelected ? `${figures.pointer} ` : '  '}
        </Text>
        <Text dimColor={dimmed && !isSelected} color={textColor}>
          {agent.agentType}
        </Text>
        {resolvedModel && (
          <Text dimColor color={textColor}>
            {' · '}
            {resolvedModel}
          </Text>
        )}
        {agent.memory && (
          <Text dimColor color={textColor}>
            {' · '}
            {agent.memory} memory
          </Text>
        )}
        {agent.overriddenBy && (
          <Text dimColor={!isSelected} color={isSelected ? 'warning' : undefined}>
            {' '}
            {figures.warning} shadowed by{' '}
            {getOverrideSourceLabel(agent.overriddenBy)}
          </Text>
        )}
      </Box>
    )
  }

  const renderAgentGroup = (title: string, groupAgents: ResolvedAgent[]) => {
    if (!groupAgents.length) return null
    const folderPath = groupAgents[0]?.baseDir
    const showPath = folderPath && folderPath !== 'built-in'

    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box paddingLeft={2}>
          <Text bold dimColor>
            {title}
          </Text>
          {showPath && <Text dimColor> ({folderPath})</Text>}
        </Box>
        {groupAgents.map(renderAgent)}
      </Box>
    )
  }

  const tabHeader = (
    <Box gap={1}>
      <Text bold color="suggestion">Agents</Text>
      <Text
        backgroundColor={view === 'running' ? 'suggestion' : undefined}
        color={view === 'running' ? 'inverseText' : undefined}
        bold={view === 'running'}
      >
        {' Running '}
      </Text>
      <Text
        backgroundColor={view === 'library' ? 'suggestion' : undefined}
        color={view === 'library' ? 'inverseText' : undefined}
        bold={view === 'library'}
      >
        {' Library '}
      </Text>
    </Box>
  )

  const hasNoAgents =
    !sortedAgents.length ||
    (view === 'library' &&
      source !== 'built-in' &&
      !sortedAgents.some(a => a.source !== 'built-in'))

  const builtInAgents = sortedAgents.filter(a => a.source === 'built-in')

  const agentContent = hasNoAgents ? (
    <Box flexDirection="column" gap={1}>
      {createEnabled && (
        <Box>
          <Text color={isCreateNewSelected ? 'suggestion' : undefined}>
            {isCreateNewSelected ? `${figures.pointer} ` : '  '}
          </Text>
          <Text color={isCreateNewSelected ? 'suggestion' : undefined}>
            Create new agent
          </Text>
        </Box>
      )}
      {view === 'running' ? (
        <Text dimColor>No subagents are currently running.</Text>
      ) : (
        <>
          <Text dimColor>
            No agents found. Create specialized subagents that Claude can
            delegate to.
          </Text>
          <Text dimColor>
            Each subagent has its own context window, custom system prompt, and
            specific tools.
          </Text>
          <Text dimColor>
            Try creating: Code Reviewer, Code Simplifier, Security Reviewer,
            Tech Lead, or UX Reviewer.
          </Text>
          {builtInAgents.length > 0 && (
            <>
              <Divider />
              {renderAgentGroup('Built-in (always available):', builtInAgents)}
            </>
          )}
        </>
      )}
    </Box>
  ) : (
    <Box flexDirection="column">
      {changes && changes.length > 0 && (
        <Box marginBottom={1}>
          <Text dimColor>{changes[changes.length - 1]}</Text>
        </Box>
      )}
      {createEnabled && (
        <Box marginBottom={1}>
          <Text color={isCreateNewSelected ? 'suggestion' : undefined}>
            {isCreateNewSelected ? `${figures.pointer} ` : '  '}
          </Text>
          <Text color={isCreateNewSelected ? 'suggestion' : undefined}>
            Create new agent
          </Text>
        </Box>
      )}
      {view === 'running' ? (
        <>
          {AGENT_SOURCE_GROUPS.filter(g => g.source !== 'built-in').map(
            ({ label, source: groupSource }) => (
              <React.Fragment key={groupSource}>
                {renderAgentGroup(
                  label,
                  sortedAgents.filter(a => a.source === groupSource),
                )}
              </React.Fragment>
            ),
          )}
          {builtInAgents.length > 0 && (
            <>
              {sortedAgents.some(a => a.source !== 'built-in') && <Divider />}
              {renderAgentGroup('Built-in (always available):', builtInAgents)}
            </>
          )}
        </>
      ) : source === 'all' ? (
        <>
          {AGENT_SOURCE_GROUPS.filter(g => g.source !== 'built-in').map(
            ({ label, source: groupSource }) => (
              <React.Fragment key={groupSource}>
                {renderAgentGroup(
                  label,
                  sortedAgents.filter(a => a.source === groupSource),
                )}
              </React.Fragment>
            ),
          )}
          {builtInAgents.length > 0 && (
            <>
              {sortedAgents.some(a => a.source !== 'built-in') && <Divider />}
              {renderAgentGroup('Built-in (always available):', builtInAgents)}
            </>
          )}
        </>
      ) : source === 'built-in' ? (
        <>
          <Text dimColor italic>
            Built-in agents are provided by default and cannot be modified.
          </Text>
          <Box marginTop={1} flexDirection="column">
            {sortedAgents.map(renderAgent)}
          </Box>
        </>
      ) : (
        <>
          {sortedAgents
            .filter(a => a.source !== 'built-in')
            .map(agent => renderAgent(agent))}
          {sortedAgents.some(a => a.source === 'built-in') && (
            <>
              <Divider />
              {renderAgentGroup('Built-in (always available):', builtInAgents)}
            </>
          )}
        </>
      )}
    </Box>
  )

  return (
    <Box tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Pane color="permission">
        <Box flexDirection="column" gap={1}>
          {tabHeader}
          {agentContent}
        </Box>
      </Pane>
    </Box>
  )
}
