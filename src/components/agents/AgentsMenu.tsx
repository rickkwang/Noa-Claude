// @ts-nocheck
import chalk from 'chalk'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import type { SettingSource } from 'src/utils/settings/constants.js'
import type { CommandResultDisplay } from '../../commands.js'
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js'
import { useMergedTools } from '../../hooks/useMergedTools.js'
import { Box, Text } from '../../ink.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { Tools } from '../../Tool.js'
import {
  type ResolvedAgent,
  resolveAgentOverrides,
} from '../../tools/AgentTool/agentDisplay.js'
import {
  type AgentDefinition,
  getActiveAgentsFromList,
} from '../../tools/AgentTool/loadAgentsDir.js'
import { toError } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { Select } from '../CustomSelect/select.js'
import { Dialog } from '../design-system/Dialog.js'
import { AgentDetail } from './AgentDetail.js'
import { AgentEditor } from './AgentEditor.js'
import { AgentNavigationFooter } from './AgentNavigationFooter.js'
import { AgentsList } from './AgentsList.js'
import { deleteAgentFromFile } from './agentFileUtils.js'
import { CreateAgentWizard } from './new-agent-creation/CreateAgentWizard.js'
import type { ModeState } from './types.js'

type AgentListView = 'running' | 'library'

type Props = {
  tools: Tools
  onExit: (
    result?: string,
    options?: {
      display?: CommandResultDisplay
    },
  ) => void
}

type AgentSource = SettingSource | 'all' | 'built-in' | 'plugin'

function getAgentsForSource(
  allAgents: AgentDefinition[],
  source: AgentSource,
): AgentDefinition[] {
  if (source === 'all') {
    return [
      ...allAgents.filter(a => a.source === 'built-in'),
      ...allAgents.filter(a => a.source === 'userSettings'),
      ...allAgents.filter(a => a.source === 'projectSettings'),
      ...allAgents.filter(a => a.source === 'localSettings'),
      ...allAgents.filter(a => a.source === 'policySettings'),
      ...allAgents.filter(a => a.source === 'flagSettings'),
      ...allAgents.filter(a => a.source === 'plugin'),
    ]
  }
  return allAgents.filter(a => a.source === source)
}

function getTaskAgentType(task: unknown): string | undefined {
  if (!task || typeof task !== 'object') return undefined
  const taskType = (task as { type?: string }).type
  const status = (task as { status?: string }).status
  if (!taskType || !status) return undefined
  const isTrackedTask =
    (taskType === 'remote_agent' || taskType === 'local_agent') &&
    (status === 'running' || status === 'pending')
  if (!isTrackedTask) return undefined
  const agentType = (task as { agentType?: string }).agentType
  if (!agentType || agentType === 'main-session') return undefined
  return agentType
}

function resolveRunningAgents(
  allAgents: AgentDefinition[],
  tasks: Record<string, unknown> | undefined,
): AgentDefinition[] {
  const runningAgentTypes = new Set<string>()
  for (const task of Object.values(tasks ?? {})) {
    const agentType = getTaskAgentType(task)
    if (agentType) runningAgentTypes.add(agentType)
  }
  if (runningAgentTypes.size === 0) return []

  const matched: AgentDefinition[] = []
  for (const agentType of runningAgentTypes) {
    const allMatches = allAgents.filter(agent => agent.agentType === agentType)
    if (allMatches.length === 0) continue
    const activeMatch = allMatches.find(
      a =>
        a.source !== 'built-in' &&
        a.source !== 'policySettings' &&
        a.source !== 'flagSettings',
    )
    matched.push(activeMatch ?? allMatches[0]!)
  }
  return matched
}

export function AgentsMenu({ tools, onExit }: Props): React.ReactNode {
  const [modeState, setModeState] = useState<ModeState>({
    mode: 'list-agents',
    source: 'all',
  })
  const [listView, setListView] = useState<AgentListView>('library')
  const [changes, setChanges] = useState<string[]>([])

  const agentDefinitions = useAppState(s => s.agentDefinitions)
  const mcpTools = useAppState(s => s.mcp.tools)
  const toolPermissionContext = useAppState(s => s.toolPermissionContext)
  const tasks = useAppState(s => s.tasks)
  const setAppState = useSetAppState()
  const { allAgents, activeAgents: agents } = agentDefinitions

  const mergedTools = useMergedTools(tools, mcpTools, toolPermissionContext)
  useExitOnCtrlCDWithKeybindings()

  const runningAgentCount = useMemo(
    () =>
      Object.values(tasks ?? {}).filter(task => !!getTaskAgentType(task)).length,
    [tasks],
  )

  const handleAgentCreated = useCallback((message: string) => {
    setChanges(prev => [...prev, message])
    setModeState({ mode: 'list-agents', source: 'all' })
    setListView('library')
  }, [])

  const handleAgentDeleted = useCallback(
    async (agent: AgentDefinition) => {
      try {
        await deleteAgentFromFile(agent)
        setAppState(state => {
          const nextAllAgents = state.agentDefinitions.allAgents.filter(
            a =>
              !(a.agentType === agent.agentType && a.source === agent.source),
          )
          return {
            ...state,
            agentDefinitions: {
              ...state.agentDefinitions,
              allAgents: nextAllAgents,
              activeAgents: getActiveAgentsFromList(nextAllAgents),
            },
          }
        })

        setChanges(prev => [
          ...prev,
          `Deleted agent: ${chalk.bold(agent.agentType)}`,
        ])
        setModeState({ mode: 'list-agents', source: 'all' })
        setListView('library')
      } catch (error) {
        logError(toError(error))
      }
    },
    [setAppState],
  )

  switch (modeState.mode) {
    case 'list-agents': {
      const libraryAgents = getAgentsForSource(allAgents, modeState.source)
      const resolvedLibraryAgents: ResolvedAgent[] = resolveAgentOverrides(
        libraryAgents,
        agents,
      )
      const runningAgents = resolveRunningAgents(allAgents, tasks)
      const resolvedRunningAgents: ResolvedAgent[] = resolveAgentOverrides(
        runningAgents,
        agents,
      )
      const agentsToShow =
        listView === 'running' ? resolvedRunningAgents : resolvedLibraryAgents

      return (
        <>
          <AgentsList
            source={modeState.source}
            agents={agentsToShow}
            view={listView}
            onViewChange={setListView}
            runningAgentCount={runningAgentCount}
            totalLibraryCount={resolvedLibraryAgents.length}
            onBack={() => {
              const exitMessage =
                changes.length > 0
                  ? `Agent changes:\n${changes.join('\n')}`
                  : undefined
              onExit(exitMessage ?? 'Agents dialog dismissed', {
                display: changes.length === 0 ? 'system' : undefined,
              })
            }}
            onSelect={agent =>
              setModeState({
                mode: 'agent-menu',
                agent,
                previousMode: modeState,
              })
            }
            onCreateNew={() => setModeState({ mode: 'create-agent' })}
            changes={changes}
          />
          <AgentNavigationFooter />
        </>
      )
    }

    case 'create-agent':
      return (
        <CreateAgentWizard
          tools={mergedTools}
          existingAgents={agents}
          onComplete={handleAgentCreated}
          onCancel={() => setModeState({ mode: 'list-agents', source: 'all' })}
        />
      )

    case 'agent-menu': {
      const freshAgent =
        allAgents.find(
          a =>
            a.agentType === modeState.agent.agentType &&
            a.source === modeState.agent.source,
        ) ?? modeState.agent

      const isEditable =
        freshAgent.source !== 'built-in' &&
        freshAgent.source !== 'plugin' &&
        freshAgent.source !== 'flagSettings'

      const menuItems = [
        { label: 'View agent', value: 'view' },
        ...(isEditable
          ? [
              { label: 'Edit agent', value: 'edit' },
              { label: 'Delete agent', value: 'delete' },
            ]
          : []),
        { label: 'Back', value: 'back' },
      ]

      const handleMenuSelect = (value: string): void => {
        switch (value) {
          case 'view':
            setModeState({
              mode: 'view-agent',
              agent: freshAgent,
              previousMode: modeState.previousMode,
            })
            break
          case 'edit':
            setModeState({
              mode: 'edit-agent',
              agent: freshAgent,
              previousMode: modeState,
            })
            break
          case 'delete':
            setModeState({
              mode: 'delete-confirm',
              agent: freshAgent,
              previousMode: modeState,
            })
            break
          case 'back':
            setModeState(modeState.previousMode)
            break
        }
      }

      return (
        <>
          <Dialog
            title={modeState.agent.agentType}
            onCancel={() => setModeState(modeState.previousMode)}
            hideInputGuide
          >
            <Box flexDirection="column">
              <Select
                options={menuItems}
                onChange={handleMenuSelect}
                onCancel={() => setModeState(modeState.previousMode)}
              />
              {changes.length > 0 && (
                <Box marginTop={1}>
                  <Text dimColor>{changes[changes.length - 1]}</Text>
                </Box>
              )}
            </Box>
          </Dialog>
          <AgentNavigationFooter />
        </>
      )
    }

    case 'view-agent': {
      const freshAgent =
        allAgents.find(
          a =>
            a.agentType === modeState.agent.agentType &&
            a.source === modeState.agent.source,
        ) ?? modeState.agent

      return (
        <>
          <Dialog
            title={freshAgent.agentType}
            onCancel={() =>
              setModeState({
                mode: 'agent-menu',
                agent: freshAgent,
                previousMode: modeState.previousMode,
              })
            }
            hideInputGuide
          >
            <AgentDetail
              agent={freshAgent}
              tools={mergedTools}
              allAgents={allAgents}
              onBack={() =>
                setModeState({
                  mode: 'agent-menu',
                  agent: freshAgent,
                  previousMode: modeState.previousMode,
                })
              }
            />
          </Dialog>
          <AgentNavigationFooter instructions="Press Enter or Esc to go back" />
        </>
      )
    }

    case 'delete-confirm': {
      const deleteOptions = [
        { label: 'Yes, delete', value: 'yes' },
        { label: 'No, cancel', value: 'no' },
      ]

      const back = () => {
        if ('previousMode' in modeState) {
          setModeState(modeState.previousMode)
        }
      }

      return (
        <>
          <Dialog title="Delete agent" onCancel={back} color="error">
            <Text>
              Are you sure you want to delete the agent{' '}
              <Text bold>{modeState.agent.agentType}</Text>?
            </Text>
            <Box marginTop={1}>
              <Text dimColor>Source: {modeState.agent.source}</Text>
            </Box>
            <Box marginTop={1}>
              <Select
                options={deleteOptions}
                onChange={value => {
                  if (value === 'yes') {
                    void handleAgentDeleted(modeState.agent)
                  } else {
                    back()
                  }
                }}
                onCancel={back}
              />
            </Box>
          </Dialog>
          <AgentNavigationFooter
            instructions={'Press ↑↓ to navigate, Enter to select, Esc to cancel'}
          />
        </>
      )
    }

    case 'edit-agent': {
      const freshAgent =
        allAgents.find(
          a =>
            a.agentType === modeState.agent.agentType &&
            a.source === modeState.agent.source,
        ) ?? modeState.agent

      return (
        <>
          <Dialog
            title={`Edit agent: ${freshAgent.agentType}`}
            onCancel={() => setModeState(modeState.previousMode)}
            hideInputGuide
          >
            <AgentEditor
              agent={freshAgent}
              tools={mergedTools}
              onSaved={message => {
                handleAgentCreated(message)
                setModeState(modeState.previousMode)
              }}
              onBack={() => setModeState(modeState.previousMode)}
            />
          </Dialog>
          <AgentNavigationFooter />
        </>
      )
    }

    default:
      return null
  }
}
