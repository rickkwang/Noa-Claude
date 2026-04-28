// @ts-nocheck
import capitalize from 'lodash-es/capitalize.js'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  type Command,
  type CommandBase,
  type CommandResultDisplay,
  getCommandName,
  type PromptCommand,
} from '../../commands.js'
import { Box, Text, useInput, useTerminalFocus } from '../../ink.js'
import { useSearchInput } from '../../hooks/useSearchInput.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import { estimateSkillFrontmatterTokens, getSkillsPath } from '../../skills/loadSkillsDir.js'
import { getDisplayPath } from '../../utils/file.js'
import { formatTokens } from '../../utils/format.js'
import { getSettingSourceName, type SettingSource } from '../../utils/settings/constants.js'
import { plural } from '../../utils/stringUtils.js'
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js'
import { Dialog } from '../design-system/Dialog.js'
import { SearchBox } from '../SearchBox.js'

type SkillCommand = CommandBase & PromptCommand
type SkillSource = SettingSource | 'plugin' | 'mcp'

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

export function SkillsMenu({ onExit, commands }: Props): React.ReactNode {
  const isTerminalFocused = useTerminalFocus()

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

  const [isSearchMode, setIsSearchMode] = useState(false)
  const [sortAlpha, setSortAlpha] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)

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
    const isUserOnly = skill.userInvocable === true && skill.disableModelInvocation === true
    return (
      <Box key={`${skill.name}-${skill.source}`}>
        <Text color={isSelected ? 'suggestion' : undefined}>
          {isSelected ? '❯ ' : '  '}
        </Text>
        <Box width={14}>
          {isUserOnly ? (
            <Text dimColor>{'🔒 user-only'}</Text>
          ) : (
            <Text color="success">{'✔ on'}</Text>
          )}
        </Box>
        <Text color={isSelected ? 'suggestion' : undefined}>
          {getCommandName(skill)}
        </Text>
        <Text dimColor>
          {pluginName ? ` · ${pluginName}` : ` · ${sourceLabel}`} · {tokenDisplay} tok
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
      subtitle={`${subtitleCount} · Enter to use, / to search, t to sort, Esc to close`}
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
