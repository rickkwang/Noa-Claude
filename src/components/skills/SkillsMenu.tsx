// @ts-nocheck
import capitalize from 'lodash-es/capitalize.js'
import figures from 'figures'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  type Command,
  type CommandBase,
  type CommandResultDisplay,
  clearCommandMemoizationCaches,
  getCommandName,
  type PromptCommand,
} from '../../commands.js'
import { Box, Text, useInput, useTerminalFocus } from '../../ink.js'
import { useSearchInput } from '../../hooks/useSearchInput.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import { estimateSkillFrontmatterTokens, getSkillsPath } from '../../skills/loadSkillsDir.js'
import { logForDebugging } from '../../utils/debug.js'
import { getDisplayPath } from '../../utils/file.js'
import { formatTokens } from '../../utils/format.js'
import { settingsChangeDetector } from '../../utils/settings/changeDetector.js'
import {
  getSettingSourceName,
  getSettingSourceDisplayNameLowercase,
  type SettingSource,
} from '../../utils/settings/constants.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import {
  applySkillMode,
  getBaseSkillMode,
  getNextSkillMode,
  getSkillMode,
  isSettingsToggleableSkill,
  type SkillMode,
} from '../../utils/skills/skillModes.js'
import { plural } from '../../utils/stringUtils.js'
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js'
import { Dialog } from '../design-system/Dialog.js'
import { Tab, Tabs } from '../design-system/Tabs.js'
import { SearchBox } from '../SearchBox.js'

type SkillCommand = CommandBase & PromptCommand
type SkillSource = SettingSource | 'plugin' | 'mcp'

const pendingSkillModeWrites = new Set<Promise<boolean>>()
const latestSkillModeWriteIds = new Map<string, number>()
let skillModeWriteQueue: Promise<void> = Promise.resolve()

type Props = {
  onExit: (
    result?: string,
    options?: {
      display?: CommandResultDisplay
      nextInput?: string
      submitNextInput?: boolean
    },
  ) => void
  commands: Command[]
}

// Render + keyboard-navigation order. Keep in lock-step so flat index ↔ group
// position can be reconstructed without a separate map.
const GROUP_ORDER: SkillSource[] = [
  'projectSettings',
  'userSettings',
  'policySettings',
  'plugin',
  'mcp',
]

function getTabTitle(source: SkillSource): string {
  if (source === 'plugin') return 'Plugin'
  if (source === 'mcp') return 'MCP'
  return capitalize(getSettingSourceName(source))
}

function getSourceSubtitle(
  source: SkillSource,
  skills: SkillCommand[],
): string | undefined {
  if (source === 'mcp') {
    const servers = [
      ...new Set(
        skills
          .map(s => {
            const idx = s.name.indexOf(':')
            return idx > 0 ? s.name.slice(0, idx) : null
          })
          .filter((n): n is string => n != null),
      ),
    ]
    return servers.length > 0 ? servers.join(', ') : undefined
  }
  if (source === 'plugin') return 'Plugin-provided skills'
  const skillsPath = getDisplayPath(getSkillsPath(source, 'skills'))
  const hasCommandsSkills = skills.some(
    s => s.loadedFrom === 'commands_DEPRECATED',
  )
  return hasCommandsSkills
    ? `${skillsPath}, ${getDisplayPath(getSkillsPath(source, 'commands'))}`
    : skillsPath
}

function canToggleSkillMode(skill: SkillCommand): boolean {
  return isSettingsToggleableSkill(skill)
}

function getHigherPrecedenceSkillModeSource(
  skillName: string,
): SettingSource | null {
  if (getSettingsForSource('flagSettings')?.skillModes?.[skillName] !== undefined) {
    return 'flagSettings'
  }
  if (getSettingsForSource('policySettings')?.skillModes?.[skillName] !== undefined) {
    return 'policySettings'
  }
  return null
}

function getNextWriteId(skillName: string): number {
  const nextWriteId = (latestSkillModeWriteIds.get(skillName) ?? 0) + 1
  latestSkillModeWriteIds.set(skillName, nextWriteId)
  return nextWriteId
}

function isLatestWriteId(skillName: string, writeId: number): boolean {
  return latestSkillModeWriteIds.get(skillName) === writeId
}

async function persistSkillMode(
  skillName: string,
  mode: SkillMode,
  baseMode: SkillMode,
  writeId: number,
): Promise<boolean> {
  const nextWrite = skillModeWriteQueue.catch(() => undefined).then(() => {
    const currentSkillModes = {
      ...(getSettingsForSource('localSettings')?.skillModes ?? {}),
    }

    if (mode === baseMode) {
      delete currentSkillModes[skillName]
    } else {
      currentSkillModes[skillName] = mode
    }

    if (!isLatestWriteId(skillName, writeId)) {
      return false
    }

    const nextSkillModes =
      Object.keys(currentSkillModes).length > 0 ? currentSkillModes : undefined
    const { error } = updateSettingsForSource('localSettings', {
      skillModes: nextSkillModes,
    })

    if (error) {
      throw error
    }

    settingsChangeDetector.notifyChange('localSettings')
    return true
  })

  skillModeWriteQueue = nextWrite.then(() => undefined, () => undefined)
  pendingSkillModeWrites.add(nextWrite)
  try {
    return await nextWrite
  } finally {
    pendingSkillModeWrites.delete(nextWrite)
  }
}

function readPersistedSkillMode(
  skillName: string,
  fallbackMode: SkillMode,
): SkillMode {
  return getSettings_DEPRECATED().skillModes?.[skillName] ?? fallbackMode
}

async function waitForPendingSkillWrites(): Promise<boolean> {
  let hasRejectedWrite = false
  while (pendingSkillModeWrites.size > 0) {
    const results = await Promise.allSettled(
      Array.from(pendingSkillModeWrites),
    )
    if (results.some(result => result.status === 'rejected')) {
      hasRejectedWrite = true
    }
  }
  return !hasRejectedWrite
}

export function SkillsMenu({ onExit, commands }: Props): React.ReactNode {
  const isTerminalFocused = useTerminalFocus()
  const initialSkillModesRef = React.useRef(new Map<string, SkillMode>())
  const changedSkillNamesRef = React.useRef(new Set<string>())
  const failedSkillNamesRef = React.useRef(new Set<string>())
  const isSavingModeChangesRef = React.useRef(false)

  const skills = useMemo(
    () =>
      commands.filter(
        (cmd): cmd is SkillCommand =>
          cmd.type === 'prompt' &&
          (cmd.loadedFrom === 'skills' ||
            cmd.loadedFrom === 'commands_DEPRECATED' ||
            cmd.loadedFrom === 'plugin' ||
            cmd.loadedFrom === 'mcp'),
      ),
    [commands],
  )

  const skillsBySource = useMemo<Record<SkillSource, SkillCommand[]>>(() => {
    const groups: Record<SkillSource, SkillCommand[]> = {
      policySettings: [],
      userSettings: [],
      projectSettings: [],
      localSettings: [],
      flagSettings: [],
      plugin: [],
      mcp: [],
    }
    for (const skill of skills) {
      const source = skill.source as SkillSource
      if (source in groups) groups[source].push(skill)
    }
    for (const group of Object.values(groups)) {
      group.sort((a, b) => getCommandName(a).localeCompare(getCommandName(b)))
    }
    return groups
  }, [skills])

  // Flat ordered list — MUST match the walk order in the render below so the
  // selected index maps to what the user sees.
  const orderedSkills = useMemo<SkillCommand[]>(
    () => GROUP_ORDER.flatMap(src => skillsBySource[src] ?? []),
    [skillsBySource],
  )

  const blockingSources = useMemo(
    () =>
      new Map(
        orderedSkills.map(skill => [
          skill.name,
          getHigherPrecedenceSkillModeSource(skill.name),
        ]),
      ),
    [orderedSkills],
  )

  useMemo(() => {
    for (const skill of orderedSkills) {
      if (
        !canToggleSkillMode(skill) ||
        initialSkillModesRef.current.has(skill.name)
      ) {
        continue
      }
      initialSkillModesRef.current.set(skill.name, getSkillMode(skill))
    }
  }, [orderedSkills])

  const { rows: terminalRows } = useTerminalSize()
  // Reserve rows for: title(1) + subtitle(1) + searchbox(3) + tabs(2) + path(1) + hints(2) + padding(4)
  const visibleRows = Math.max(5, terminalRows - 14)

  // Sources with at least one skill — drives which tabs render.
  const visibleSources = useMemo<SkillSource[]>(
    () => GROUP_ORDER.filter(s => (skillsBySource[s]?.length ?? 0) > 0),
    [skillsBySource],
  )

  const [isSearchMode, setIsSearchMode] = useState(false)
  const [sortAlpha, setSortAlpha] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [activeTab, setActiveTabState] = useState<SkillSource>(
    () => visibleSources[0] ?? 'userSettings',
  )
  // If the active tab loses all its skills (e.g. mode persistence churn),
  // fall back to the first remaining tab.
  useEffect(() => {
    if (visibleSources.length > 0 && !visibleSources.includes(activeTab)) {
      setActiveTabState(visibleSources[0]!)
      setSelectedIdx(0)
    }
  }, [visibleSources, activeTab])
  const handleTabChange = React.useCallback((tab: string) => {
    setActiveTabState(tab as SkillSource)
    setSelectedIdx(0)
  }, [])
  const [isSavingModeChanges, setIsSavingModeChanges] = useState(false)
  const [, forceRefresh] = useState(0)
  const hasPendingModeChanges = changedSkillNamesRef.current.size > 0
  const syncChangedSkillName = React.useCallback(
    (skillName: string, mode: SkillMode): void => {
      const initialMode = initialSkillModesRef.current.get(skillName)
      if (initialMode === undefined || initialMode === mode) {
        changedSkillNamesRef.current.delete(skillName)
        return
      }
      changedSkillNamesRef.current.add(skillName)
    },
    [],
  )

  const { query, setQuery, cursorOffset } = useSearchInput({
    isActive: isSearchMode,
    onExit: () => setIsSearchMode(false),
    onCancel: () => {
      setQuery('')
      setIsSearchMode(false)
    },
    backspaceExitsOnEmpty: true,
  })

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIdx(0)
  }, [query])

  // Tabs are shown only in default browse mode. Sort and search are global
  // (cross-tab) for discoverability.
  const showTabs = visibleSources.length >= 2 && !sortAlpha && !query

  // Apply sort and filter
  const displaySkills = useMemo<SkillCommand[]>(() => {
    let list = showTabs ? (skillsBySource[activeTab] ?? []) : orderedSkills
    if (sortAlpha) {
      list = [...list].sort((a, b) =>
        getCommandName(a).localeCompare(getCommandName(b)),
      )
    }
    if (query) {
      const lower = query.toLowerCase()
      list = list.filter(s => getCommandName(s).toLowerCase().includes(lower))
    }
    return list
  }, [orderedSkills, sortAlpha, query, showTabs, skillsBySource, activeTab])

  const clampedIdx =
    displaySkills.length === 0
      ? 0
      : Math.min(Math.max(selectedIdx, 0), displaySkills.length - 1)

  const handleCancel = React.useCallback((): void => {
    onExit('Skills dialog dismissed', { display: 'system' })
  }, [onExit])

  const handleUseSkill = React.useCallback((): void | false => {
    const skill = displaySkills[clampedIdx]
    if (!skill) return false

    // Fill the prompt with `/<name> ` so the user can add args or press
    // Enter again to execute. `submitNextInput: false` is deliberate —
    // many skills take arguments, and direct execution would surprise.
    onExit(undefined, {
      display: 'skip',
      nextInput: `/${getCommandName(skill)} `,
      submitNextInput: false,
    })
  }, [clampedIdx, displaySkills, onExit])

  const handleToggleSkillMode = React.useCallback((): void | false => {
    if (isSavingModeChangesRef.current) return false
    const skill = displaySkills[clampedIdx]
    if (!skill) return false
    if (!canToggleSkillMode(skill)) return false
    if (blockingSources.get(skill.name) !== null) return false

    const previousMode = getSkillMode(skill)
    const baseMode = getBaseSkillMode(skill)
    const nextMode = getNextSkillMode(previousMode)
    const writeId = getNextWriteId(skill.name)
    applySkillMode(skill, nextMode)
    syncChangedSkillName(skill.name, nextMode)
    failedSkillNamesRef.current.delete(skill.name)
    clearCommandMemoizationCaches()
    forceRefresh(v => v + 1)
    void persistSkillMode(skill.name, nextMode, baseMode, writeId)
      .then(didPersist => {
        if (!didPersist || !isLatestWriteId(skill.name, writeId)) return
        failedSkillNamesRef.current.delete(skill.name)
      })
      .catch(error => {
        let revertedMode = previousMode
        if (!isLatestWriteId(skill.name, writeId)) return
        try {
          revertedMode = readPersistedSkillMode(skill.name, baseMode)
          applySkillMode(skill, revertedMode)
        } catch {
          applySkillMode(skill, revertedMode)
        }
        syncChangedSkillName(skill.name, revertedMode)
        failedSkillNamesRef.current.add(skill.name)
        clearCommandMemoizationCaches()
        forceRefresh(v => v + 1)
        logForDebugging(
          `[skills] failed to persist ${skill.name} mode ${nextMode}: ${error}`,
          { level: 'warn' },
        )
      })
  }, [
    blockingSources,
    clampedIdx,
    displaySkills,
    forceRefresh,
    syncChangedSkillName,
  ])

  const handleConfirm = React.useCallback((): void | false => {
    if (changedSkillNamesRef.current.size > 0) {
      if (isSavingModeChangesRef.current) return false
      isSavingModeChangesRef.current = true
      setIsSavingModeChanges(true)
      void waitForPendingSkillWrites()
        .then(allWritesSucceeded => {
          const hasSaveFailures = failedSkillNamesRef.current.size > 0
          onExit(
            allWritesSucceeded && !hasSaveFailures
              ? 'Skill settings saved'
              : 'Failed to save some skill settings',
            { display: 'system' },
          )
        })
        .finally(() => {
          isSavingModeChangesRef.current = false
          setIsSavingModeChanges(false)
        })
      return
    }

    return handleToggleSkillMode()
  }, [handleToggleSkillMode, onExit])

  const handleNext = React.useCallback((): void | false => {
    if (displaySkills.length === 0) return false
    setSelectedIdx(i => (i + 1) % displaySkills.length)
  }, [displaySkills.length])

  const handlePrevious = React.useCallback((): void | false => {
    if (displaySkills.length === 0) return false
    setSelectedIdx(i => (i - 1 + displaySkills.length) % displaySkills.length)
  }, [displaySkills.length])

  useKeybindings(
    {
      'select:next': handleNext,
      'select:previous': handlePrevious,
      'select:accept': handleConfirm,
      'select:cancel': handleCancel,
    },
    { context: 'Select', isActive: !isSearchMode },
  )

  useKeybindings(
    {
      'confirm:yes': handleConfirm,
      'confirm:no': handleCancel,
    },
    { context: 'Confirmation', isActive: !isSearchMode },
  )

  // Raw input for Skills-only actions that do not have configurable actions yet.
  useInput(
    (input, key, event) => {
      if (isSavingModeChanges) {
        event.stopImmediatePropagation()
        return
      }
      if (input === ' ') {
        event.stopImmediatePropagation()
        void handleToggleSkillMode()
        return
      }
      if (input === 'i') {
        event.stopImmediatePropagation()
        void handleUseSkill()
        return
      }
      if (input === '/') {
        event.stopImmediatePropagation()
        setIsSearchMode(true)
        setSelectedIdx(0)
        return
      }
      if (input === 't') {
        event.stopImmediatePropagation()
        setSortAlpha(s => !s)
        return
      }
      // Any printable character (except space, reserved for toggle) starts type-to-filter search.
      if (input.length === 1 && input !== ' ' && !key.ctrl && !key.meta) {
        event.stopImmediatePropagation()
        setQuery(input)
        setIsSearchMode(true)
        setSelectedIdx(0)
        return
      }
    },
    { isActive: !isSearchMode },
  )

  if (skills.length === 0) {
    return (
      <Dialog
        title="Skills"
        subtitle="No skills found"
        onCancel={handleCancel}
        hideInputGuide
      >
        <Text dimColor>
          Create skills in .noa/skills/ or ~/.noa/skills/
        </Text>
        <Text dimColor italic>
          <ConfigurableShortcutHint
            action="confirm:no"
            context="Confirmation"
            fallback="Esc"
            description="close"
          />
        </Text>
      </Dialog>
    )
  }

  const renderSkill = (
    skill: SkillCommand,
    displayIdx: number,
  ): React.ReactNode => {
    const isSelected = displayIdx === clampedIdx
    const estimatedTokens = estimateSkillFrontmatterTokens(skill)
    const tokenDisplay = `~${formatTokens(estimatedTokens)}`
    const pluginName =
      skill.source === 'plugin'
        ? skill.pluginInfo?.pluginManifest.name
        : undefined
    const sourceLabel = skill.source === 'plugin' || skill.source === 'mcp'
      ? skill.source
      : getSettingSourceName(skill.source as SettingSource)
    const mode = getSkillMode(skill)
    const blockingSource = blockingSources.get(skill.name) ?? null
    const isToggleable =
      canToggleSkillMode(skill) && blockingSource === null
    const readOnlyReason =
      blockingSource !== null
        ? ` · overridden by ${getSettingSourceDisplayNameLowercase(blockingSource)}`
        : !isToggleable
          ? ' · read-only'
          : ''
    return (
      <Box key={`${skill.name}-${skill.source}`}>
        <Text color={isSelected ? 'suggestion' : undefined}>
          {isSelected ? '❯ ' : '  '}
        </Text>
        <Box width={14}>
          {mode === 'name-only' ? (
            <Text color="white">● name-only</Text>
          ) : mode === 'on' ? (
            <Text color="success">{figures.tick} on</Text>
          ) : mode === 'user-only' ? (
            <Text color="warning">◯ user-only</Text>
          ) : (
            <Text color="error">{figures.cross} off</Text>
          )}
        </Box>
        <Text color={isSelected ? 'suggestion' : undefined}>
          {getCommandName(skill)}
        </Text>
        <Text dimColor>
          {pluginName ? ` · ${pluginName}` : ` · ${sourceLabel}`} · {tokenDisplay} tok{readOnlyReason}
        </Text>
      </Box>
    )
  }

  // Sliding window of visible items centered on the selection.
  const windowStart = useMemo(() => {
    if (displaySkills.length <= visibleRows) return 0
    const ideal = clampedIdx - Math.floor(visibleRows / 2)
    return Math.max(0, Math.min(ideal, displaySkills.length - visibleRows))
  }, [displaySkills.length, clampedIdx, visibleRows])
  const windowEnd = Math.min(displaySkills.length, windowStart + visibleRows)
  const aboveCount = windowStart
  const belowCount = displaySkills.length - windowEnd

  // Optional path/source subtitle shown above the list for the active tab.
  const pathSubtitle = showTabs
    ? getSourceSubtitle(activeTab, skillsBySource[activeTab] ?? [])
    : undefined

  let listElement: React.ReactNode
  if (displaySkills.length === 0 && query) {
    listElement = <Text dimColor>No skills match "{query}"</Text>
  } else {
    listElement = (
      <Box
        flexDirection="column"
        height={showTabs ? visibleRows + 2 : undefined}
        overflow="hidden"
      >
        {!showTabs && pathSubtitle && <Text dimColor>{pathSubtitle}</Text>}
        {aboveCount > 0 && <Text dimColor>↑ {aboveCount} more above</Text>}
        {displaySkills.slice(windowStart, windowEnd).map((skill, i) =>
          renderSkill(skill, windowStart + i),
        )}
        {belowCount > 0 && <Text dimColor>↓ {belowCount} more below</Text>}
      </Box>
    )
  }

  if (showTabs) {
    listElement = (
      <Box marginLeft={1} flexDirection="column">
        <Tabs
          color="suggestion"
          selectedTab={activeTab}
          onTabChange={handleTabChange}
          banner={pathSubtitle ? <Box marginLeft={1}><Text dimColor>{pathSubtitle}</Text></Box> : undefined}
        >
          {visibleSources.map(src => (
            <Tab key={src} id={src} title={getTabTitle(src)}>
              {src === activeTab ? listElement : null}
            </Tab>
          ))}
        </Tabs>
      </Box>
    )
  }

  const subtitleCount = query
    ? `${displaySkills.length}/${skills.length} ${plural(skills.length, 'skill')}`
    : `${skills.length} ${plural(skills.length, 'skill')}`

  return (
    <Dialog
      title="Skills"
      subtitle={`${subtitleCount} · ${isSavingModeChanges ? 'Saving…' : hasPendingModeChanges ? 'Enter to save' : 'Enter/Space to toggle'}, i to insert, type to search, t to sort, Esc to close`}
      onCancel={handleCancel}
      hideInputGuide
      isCancelActive={!isSearchMode}
    >
      <SearchBox
        query={query}
        placeholder="Search skills..."
        isFocused={isSearchMode}
        isTerminalFocused={isTerminalFocused}
        cursorOffset={cursorOffset}
      />
      {listElement}
    </Dialog>
  )
}
