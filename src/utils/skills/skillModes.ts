import type { Command, CommandBase } from '../../types/command.js'

export const SKILL_MODES = [
  'on',
  'name-only',
  'user-only',
  'off',
] as const

export type SkillMode = (typeof SKILL_MODES)[number]

type SkillModeCarrier = Pick<
  CommandBase,
  'disableModelInvocation' | 'isHidden' | 'loadedFrom' | 'nameOnly' | 'userInvocable'
> & {
  type?: string
  name?: string
  baseSkillMode?: SkillMode
}

export function getSkillMode(skill: SkillModeCarrier): SkillMode {
  const userInvocable = skill.userInvocable !== false
  const modelInvocable = skill.disableModelInvocation !== true
  if (userInvocable && modelInvocable && skill.nameOnly === true) {
    return 'name-only'
  }
  if (userInvocable && modelInvocable) return 'on'
  if (userInvocable && !modelInvocable) return 'user-only'
  return 'off'
}

export function applySkillMode<T extends SkillModeCarrier>(
  skill: T,
  mode: SkillMode,
): T {
  if (mode === 'on') {
    skill.userInvocable = true
    skill.disableModelInvocation = false
    skill.nameOnly = false
    skill.isHidden = false
    return skill
  }
  if (mode === 'name-only') {
    skill.userInvocable = true
    skill.disableModelInvocation = false
    skill.nameOnly = true
    skill.isHidden = false
    return skill
  }
  if (mode === 'user-only') {
    skill.userInvocable = true
    skill.disableModelInvocation = true
    skill.nameOnly = false
    skill.isHidden = false
    return skill
  }
  skill.userInvocable = false
  skill.disableModelInvocation = true
  skill.nameOnly = false
  skill.isHidden = true
  return skill
}

export function getBaseSkillMode(skill: SkillModeCarrier): SkillMode {
  return skill.baseSkillMode ?? getSkillMode(skill)
}

export function getNextSkillMode(mode: SkillMode): SkillMode {
  if (mode === 'on') return 'name-only'
  if (mode === 'name-only') return 'user-only'
  if (mode === 'user-only') return 'off'
  return 'on'
}

export function isSettingsToggleableSkill(
  skill: Pick<SkillModeCarrier, 'loadedFrom' | 'type'>,
): boolean {
  return (
    skill.type === 'prompt' &&
    (skill.loadedFrom === 'skills' ||
      skill.loadedFrom === 'commands_DEPRECATED' ||
      skill.loadedFrom === 'plugin')
  )
}

export function applySkillModeOverrideToCommand(
  command: Command,
  overrideMode?: SkillMode,
): Command {
  if (!isSettingsToggleableSkill(command)) {
    return command
  }

  const baseSkillMode = getSkillMode(command)
  const nextCommand: Command = { ...command, baseSkillMode }
  const effectiveMode = overrideMode ?? baseSkillMode

  if (effectiveMode !== baseSkillMode) {
    applySkillMode(nextCommand, effectiveMode)
  }

  return nextCommand
}
