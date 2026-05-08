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

function getSourceTitle(source: SkillSource): string {
  if (source === 'plugin') return 'Plugin skills'
  if (source === 'mcp') return 'MCP skills'
  return `${capitalize(getSettingSourceName(source))} skills`
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

  const [isSearchMode, setIsSearchMode] = useState(false)
  const [sortAlpha, setSortAlpha] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
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

  // Apply sort and filter
  const displaySkills = useMemo<SkillCommand[]>(() => {
    let list = orderedSkills
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
  }, [orderedSkills, sortAlpha, query])

  const clampedIdx =
    displaySkills.length === 0
      ? 0
      : Math.min(Math.max(selectedIdx, 0), displaySkills.length - 1)

  const handleCancel = React.useCallback((): void => {
    onExit('Skills dialog dismissed', { display: 'system' })
  }, [onExit])

  const handleConfirm = React.useCallback((): void | false => {
    if (hasPendingModeChanges) {
      if (isSavingModeChanges) return false
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
          setIsSavingModeChanges(false)
        })
      return
    }

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
  }, [
    clampedIdx,
    displaySkills,
    hasPendingModeChanges,
    isSavingModeChanges,
    onExit,
    syncChangedSkillName,
  ])

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
        const skill = displaySkills[clampedIdx]
        if (!skill) return
        if (!canToggleSkillMode(skill)) return
        if (blockingSources.get(skill.name) !== null) return
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
          Create skills in .claude-agent/skills/ or ~/.claude-agent/skills/
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
    globalIdx: number,
  ): React.ReactNode => {
    const isSelected = globalIdx === clampedIdx
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

  // Render skill list — flat when searching/sorting, grouped otherwise
  let listElement: React.ReactNode
  if (isSearchMode || sortAlpha || query) {
    listElement = (
      <Box flexDirection="column">
        {displaySkills.length === 0
          ? <Text dimColor>No skills match "{query}"</Text>
          : displaySkills.map((skill, i) => renderSkill(skill, i))}
      </Box>
    )
  } else {
    // Walk groups in the same order as orderedSkills, advancing a shared cursor
    // so globalIdx matches the flat list used by nav keybindings.
    let cursor = 0
    const groupElements: React.ReactNode[] = []
    for (const source of GROUP_ORDER) {
      const groupSkills = skillsBySource[source]
      if (groupSkills.length === 0) continue
      const title = getSourceTitle(source)
      const subtitle = getSourceSubtitle(source, groupSkills)
      const startIdx = cursor
      const rendered = groupSkills.map((skill, i) =>
        renderSkill(skill, startIdx + i),
      )
      cursor += groupSkills.length
      groupElements.push(
        <Box flexDirection="column" key={source}>
          <Box>
            <Text bold dimColor>
              {title}
            </Text>
            {subtitle && <Text dimColor> ({subtitle})</Text>}
          </Box>
          {rendered}
        </Box>,
      )
    }
    listElement = <Box flexDirection="column" gap={1}>{groupElements}</Box>
  }

  const subtitleCount = query
    ? `${displaySkills.length}/${skills.length} ${plural(skills.length, 'skill')}`
    : `${skills.length} ${plural(skills.length, 'skill')}`

  return (
    <Dialog
      title="Skills"
      subtitle={`${subtitleCount} · ${isSavingModeChanges ? 'Saving…' : hasPendingModeChanges ? 'Enter to save' : 'Enter to use'}, Space to toggle, / to search, t to sort, Esc to close`}
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
