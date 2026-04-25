// @ts-nocheck
import capitalize from 'lodash-es/capitalize.js'
import * as React from 'react'
import { useMemo, useState } from 'react'
import {
  type Command,
  type CommandBase,
  type CommandResultDisplay,
  getCommandName,
  type PromptCommand,
} from '../../commands.js'
import { Box, Text } from '../../ink.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import { estimateSkillFrontmatterTokens, getSkillsPath } from '../../skills/loadSkillsDir.js'
import { getDisplayPath } from '../../utils/file.js'
import { formatTokens } from '../../utils/format.js'
import { getSettingSourceName, type SettingSource } from '../../utils/settings/constants.js'
import { plural } from '../../utils/stringUtils.js'
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js'
import { Dialog } from '../design-system/Dialog.js'

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

  const [selectedIdx, setSelectedIdx] = useState(0)
  const clampedIdx =
    orderedSkills.length === 0
      ? 0
      : Math.min(Math.max(selectedIdx, 0), orderedSkills.length - 1)

  const handleCancel = (): void => {
    onExit('Skills dialog dismissed', { display: 'system' })
  }

  const handleConfirm = (): void => {
    const skill = orderedSkills[clampedIdx]
    if (!skill) {
      handleCancel()
      return
    }
    // Fill the prompt with `/<name> ` so the user can add args or press
    // Enter again to execute. `submitNextInput: false` is deliberate —
    // many skills take arguments, and direct execution would surprise.
    onExit(undefined, {
      display: 'skip',
      nextInput: `/${getCommandName(skill)} `,
      submitNextInput: false,
    })
  }

  const navEnabled = orderedSkills.length > 0
  useKeybinding(
    'select:next',
    () =>
      setSelectedIdx(i =>
        orderedSkills.length === 0 ? 0 : (i + 1) % orderedSkills.length,
      ),
    navEnabled,
  )
  useKeybinding(
    'select:previous',
    () =>
      setSelectedIdx(i =>
        orderedSkills.length === 0
          ? 0
          : (i - 1 + orderedSkills.length) % orderedSkills.length,
      ),
    navEnabled,
  )
  useKeybinding('confirm:yes', handleConfirm, navEnabled)

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
    return (
      <Box key={`${skill.name}-${skill.source}`}>
        <Text color={isSelected ? 'suggestion' : undefined}>
          {isSelected ? '❯ ' : '  '}
          {getCommandName(skill)}
        </Text>
        <Text dimColor>
          {pluginName ? ` · ${pluginName}` : ''} · {tokenDisplay} description
          tokens
        </Text>
      </Box>
    )
  }

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

  return (
    <Dialog
      title="Skills"
      subtitle={`${skills.length} ${plural(skills.length, 'skill')}`}
      onCancel={handleCancel}
      hideInputGuide
    >
      <Box flexDirection="column" gap={1}>
        {groupElements}
      </Box>
      <Text dimColor italic>
        ↑/↓ navigate  ·  {' '}
        <ConfigurableShortcutHint
          action="confirm:yes"
          context="Confirmation"
          fallback="↵"
          description="fill"
        />
        {'  ·  '}
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
