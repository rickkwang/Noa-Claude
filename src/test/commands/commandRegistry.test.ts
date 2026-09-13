import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { builtInCommandNames, getCommands } from '../../commands.js'
import { getCwd } from '../../utils/cwd.js'

describe('built-in command registry', () => {
  // COMMANDS() builds /login, which asks how the session authenticates and
  // throws when nothing is configured.
  let originalApiKey: string | undefined

  beforeAll(() => {
    originalApiKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY ??= 'test-key-command-registry'
  })

  afterAll(() => {
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey
    }
  })

  test('registers the session-maintenance commands', () => {
    const names = builtInCommandNames()
    expect(names.has('output-style')).toBe(true)
    expect(names.has('reload-skills')).toBe(true)
    expect(names.has('pause-memory')).toBe(true)
  })

  test('registers the aliases that route to an existing command', () => {
    const names = builtInCommandNames()
    // /undo and /stats are muscle memory from upstream; /cost stays its own
    // command here, so /usage deliberately does not claim it as an alias.
    expect(names.has('undo')).toBe(true)
    expect(names.has('stats')).toBe(true)
    expect(names.has('cost')).toBe(true)
  })

  test('no two commands claim the same name or alias', async () => {
    const commands = await getCommands(getCwd())
    const owners = new Map<string, string>()
    const collisions: string[] = []

    for (const command of commands) {
      for (const handle of [command.name, ...(command.aliases ?? [])]) {
        const owner = owners.get(handle)
        if (owner === undefined) {
          owners.set(handle, command.name)
        } else if (owner === command.name) {
          // Same command claiming one handle twice — an alias repeating its
          // own command's name, which silently shadows nothing but signals a
          // copy-paste slip.
          collisions.push(`/${handle} is claimed twice by ${command.name}`)
        } else {
          collisions.push(`/${handle} claimed by both ${owner} and ${command.name}`)
        }
      }
    }

    expect(collisions).toEqual([])
  })
})
