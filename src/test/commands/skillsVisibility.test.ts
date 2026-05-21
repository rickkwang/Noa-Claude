import { describe, expect, test } from 'bun:test'
import type { Command } from '../../commands.js'
import { isSlashCommandToolSkill } from '../../commands.js'

function makePromptCommand(
  overrides: Partial<Command> = {},
): Command {
  return {
    type: 'prompt',
    name: 'example-skill',
    description: 'Example skill',
    hasUserSpecifiedDescription: true,
    contentLength: 1,
    progressMessage: 'running',
    source: 'plugin',
    loadedFrom: 'plugin',
    userInvocable: true,
    disableModelInvocation: false,
    async getPromptForCommand() {
      return []
    },
    ...overrides,
  } as Command
}

describe('isSlashCommandToolSkill', () => {
  test('includes user-only plugin skills because users can still invoke them', () => {
    const skill = makePromptCommand({
      disableModelInvocation: true,
      userInvocable: true,
    })

    expect(isSlashCommandToolSkill(skill)).toBe(true)
  })

  test('excludes off plugin skills because users cannot invoke them', () => {
    const skill = makePromptCommand({
      disableModelInvocation: true,
      userInvocable: false,
      isHidden: true,
    })

    expect(isSlashCommandToolSkill(skill)).toBe(false)
  })

  test('includes legacy commands-as-skills in slash skill listings', () => {
    const skill = makePromptCommand({
      source: 'projectSettings',
      loadedFrom: 'commands_DEPRECATED',
    })

    expect(isSlashCommandToolSkill(skill)).toBe(true)
  })
})
