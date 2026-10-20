// @ts-nocheck
import figures from 'figures'
import * as React from 'react'
import { useMemo, useState } from 'react'
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
import { stringWidth } from '../../ink/stringWidth.js'
import { estimateSkillFrontmatterTokens } from '../../skills/loadSkillsDir.js'
import { logForDebugging } from '../../utils/debug.js'
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
import { MoreRow } from '../ui/MoreRow.js'
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
  bytesPerToken?: number
}

// Keep source order while showing every source in one list.
const GROUP_ORDER: SkillSource[] = [
  'projectSettings',
  'userSettings',
  'policySettings',
  'localSettings',
  'flagSettings',
  'plugin',
  'mcp',
]

function isAuthorLocked(skill: SkillCommand): boolean {
  const baseMode = getBaseSkillMode(skill)
  return baseMode === 'user-only' || baseMode === 'off'
}

// Longest run of leading details that fits; the first one always stays and
// is truncated by the row instead.
function fitDetails(details: string[], width: number): string {
  return details
    .map((_, i) => details.slice(0, i + 1).join(' · '))
    .findLast((joined, i) => i === 0 || stringWidth(joined) <= width) ?? ''
}

function canToggleSkillMode(skill: SkillCommand): boolean {
  return isSettingsToggleableSkill(skill) && !isAuthorLocked(skill)
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
  // Keep the actual file write synchronous so a toggle survives immediate
  // process exit / resume right after Enter. Chain through skillModeWriteQueue
  // to serialize concurrent toggles and avoid read-before-write races.
  const nextWrite = skillModeWriteQueue
    .catch(() => undefined)
    .then(() => {
      const currentSkillModes = {
        ...(getSettingsForSource('localSettings')?.skillModes ?? {}),
      }

      if (mode === baseMode) {
        // Set to undefined (NOT delete) so updateSettingsForSource's mergeWith
        // customizer (see src/utils/settings/settings.ts:514) treats this key
        // as a deletion against the existing on-disk settings.
        currentSkillModes[skillName] = undefined
      } else {
        currentSkillModes[skillName] = mode
      }

      if (!isLatestWriteId(skillName, writeId)) {
        return false
      }

      // Only count keys with a real value — undefined entries are delete
      // markers, so an all-reverted state should drop the whole skillModes
      // field instead of leaving "skillModes": {} on disk.
      const hasRealEntries = Object.values(currentSkillModes).some(
        v => v !== undefined,
      )
      const nextSkillModes = hasRealEntries ? currentSkillModes : undefined
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

export function SkillsMenu({ onExit, commands, bytesPerToken }: Props): React.ReactNode {
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

  const { rows: terminalRows, columns: terminalColumns } = useTerminalSize()
  // Leave room for the title, search box, overflow rows and wrapped hints.
  const visibleRows = Math.max(1, terminalRows - 12)

  const [isSearchMode, setIsSearchMode] = useState(false)
  const [sortByTokens, setSortByTokens] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [isSavingModeChanges, setIsSavingModeChanges] = useState(false)
  const [, forceRefresh] = useState(0)
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
    backspaceExitsOnEmpty: true,
  })

  const displaySkills = useMemo<SkillCommand[]>(() => {
    let list = orderedSkills
    if (sortByTokens) {
      list = [...list].sort((a, b) =>
        estimateSkillFrontmatterTokens(b, bytesPerToken) -
          estimateSkillFrontmatterTokens(a, bytesPerToken),
      )
    }
    if (query) {
      const lower = query.toLowerCase()
      list = list.filter(s => [getCommandName(s), s.description, s.whenToUse]
        .some(text => text?.toLowerCase().includes(lower)))
    }
    return list
  }, [orderedSkills, sortByTokens, query, bytesPerToken])
  const getSkillDetails = (skill: SkillCommand): string[] => {
    const estimatedTokens = estimateSkillFrontmatterTokens(skill, bytesPerToken)
    const tokenDisplay = estimatedTokens < 20 ? '< 20' : `~${formatTokens(Math.round(estimatedTokens / 10) * 10)}`
    const pluginName =
      skill.source === 'plugin'
        ? skill.pluginInfo?.pluginManifest.name
        : undefined
    const sourceLabel = skill.source === 'plugin' || skill.source === 'mcp'
      ? skill.source
      : getSettingSourceName(skill.source as SettingSource)
    const mode = getSkillMode(skill)
    const blockingSource = blockingSources.get(skill.name) ?? null
    const overriddenBy =
      blockingSource !== null
        ? `overridden by ${getSettingSourceDisplayNameLowercase(blockingSource)}`
        : ''
    // ✔ / ◯ is the whole on/off signal; the partial modes are still "on" and
    // carry their word in the details instead of widening a status column.
    const modeWord =
      mode === 'name-only' ? 'name-only' : mode === 'user-only' ? 'user-only' : ''
    // Most telling first: narrow terminals drop trailing details first.
    return [
      isAuthorLocked(skill) ? 'locked by author' : '',
      overriddenBy,
      modeWord,
      pluginName || sourceLabel,
      `${tokenDisplay} tok`,
      !isSettingsToggleableSkill(skill) ? 'read-only' : '',
    ].filter(Boolean)
  }
  const skillDetails = new Map(displaySkills.map(skill => [skill, getSkillDetails(skill)]))
  // Column budget: the row is pointer(2) + icon(2) + name + gap(3) + details,
  // inside the dialog's horizontal padding.
  const rowWidth = Math.max(0, terminalColumns - 6 - 2 - 2 - 3)
  const maxNameWidth = Math.min(50, Math.max(0, ...displaySkills.map(skill => stringWidth(getCommandName(skill)))))
  const maxDetailsWidth = Math.max(0, ...[...skillDetails.values()].map(d => stringWidth(d.join(' · '))))
  const detailsBudget = rowWidth - Math.min(maxNameWidth, Math.max(Math.ceil(rowWidth / 2), rowWidth - maxDetailsWidth))
  const detailsColumnWidth = maxNameWidth + maxDetailsWidth > rowWidth && rowWidth < 12
    ? 0
    : Math.min(detailsBudget, Math.max(0, ...[...skillDetails.values()].map(d => stringWidth(fitDetails(d, detailsBudget)))))
  const nameColumnWidth = Math.max(1, Math.min(maxNameWidth, rowWidth - detailsColumnWidth))

  const clampedIdx =
    displaySkills.length === 0
      ? 0
      : Math.min(Math.max(selectedIdx, 0), displaySkills.length - 1)

  const handleCancel = React.useCallback((): void | false => {
    if (isSavingModeChangesRef.current) return false
    isSavingModeChangesRef.current = true
    setIsSavingModeChanges(true)
    void waitForPendingSkillWrites()
      .then(allWritesSucceeded => {
        const count = changedSkillNamesRef.current.size
        onExit(
          !allWritesSucceeded || failedSkillNamesRef.current.size > 0
            ? 'Failed to save some skill settings'
            : count > 0
              ? `Updated ${count} skill ${plural(count, 'override')}`
              : 'No changes',
          { display: 'system' },
        )
      })
      .finally(() => {
        isSavingModeChangesRef.current = false
        setIsSavingModeChanges(false)
      })
  }, [onExit])

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
      'select:accept': handleToggleSkillMode,
      'select:cancel': handleCancel,
    },
    { context: 'Select', isActive: !isSearchMode },
  )

  useKeybindings(
    {
      'confirm:yes': handleToggleSkillMode,
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
      if (input === '/') {
        event.stopImmediatePropagation()
        setIsSearchMode(true)
        setSelectedIdx(0)
        return
      }
      if (input === 't') {
        event.stopImmediatePropagation()
        setSortByTokens(s => !s)
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
    // While the search box owns the keyboard, keep the row marker but drop
    // the highlight so two pointers don't read as focused at once.
    const isHighlighted = isSelected && !isSearchMode
    const isOn = getSkillMode(skill) !== 'off'
    const details = fitDetails(skillDetails.get(skill) ?? [], detailsColumnWidth)
    return (
      <Box key={`${skill.name}-${skill.source}`}>
        <Text color={isHighlighted ? 'suggestion' : undefined}>
          {isSelected ? '❯ ' : '  '}
        </Text>
        <Box flexShrink={0} marginRight={1}>
          <Text color={isOn ? 'success' : 'inactive'}>
            {isOn ? figures.tick : figures.circle}
          </Text>
        </Box>
        <Box width={nameColumnWidth} flexShrink={0} marginRight={detailsColumnWidth > 0 ? 3 : 0}>
          <Text wrap="truncate-end" color={isHighlighted ? 'suggestion' : undefined}>
            {getCommandName(skill)}
          </Text>
        </Box>
        {detailsColumnWidth > 0 && (
          <Box flexShrink={1} maxWidth={detailsColumnWidth}>
            <Text dimColor wrap="truncate-end">{details}</Text>
          </Box>
        )}
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

  let listElement: React.ReactNode
  if (displaySkills.length === 0 && query) {
    listElement = <Text dimColor>No skills match "{query}"</Text>
  } else {
    listElement = (
      <Box flexDirection="column" overflow="hidden">
        <MoreRow direction="above" count={aboveCount} onPress={() => setSelectedIdx(0)} />
        {displaySkills.slice(windowStart, windowEnd).map((skill, i) =>
          renderSkill(skill, windowStart + i),
        )}
        <MoreRow direction="below" count={belowCount} onPress={() => setSelectedIdx(displaySkills.length - 1)} />
      </Box>
    )
  }

  const subtitleCount = query
    ? `${displaySkills.length}/${skills.length} ${plural(skills.length, 'skill')}`
    : `${skills.length} ${plural(skills.length, 'skill')}`
  const subtitle = isSearchMode
    ? `${subtitleCount} · type to filter · ↓/enter to select · esc to clear`
    : `${subtitleCount}${sortByTokens ? ' · sorted by tokens' : ''} · enter/space to cycle, / to search, t to sort, Esc to close`

  return (
    <Dialog
      title="Skills"
      subtitle={isSavingModeChanges ? `${subtitleCount} · Saving…` : subtitle}
      onCancel={handleCancel}
      hideInputGuide
      isCancelActive={!isSearchMode}
    >
      <Box flexDirection="column">
        <SearchBox
          query={query}
          placeholder="Search skills…"
          isFocused={isSearchMode}
          isTerminalFocused={isTerminalFocused}
          cursorOffset={cursorOffset}
        />
        {listElement}
      </Box>
    </Dialog>
  )
}
