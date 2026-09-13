import type { Command } from '../../commands.js'
import { clearSystemPromptSectionCache } from '../../constants/systemPromptSections.js'
import { getSkillDirCommands } from '../../skills/loadSkillsDir.js'
import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { skillChangeDetector } from '../../utils/skills/skillChangeDetector.js'
import { plural } from '../../utils/stringUtils.js'

export const call: LocalCommandCall = async (_args, _context) => {
  const cwd = getCwd()
  const before = fingerprintSkills(await getSkillDirCommands(cwd))

  // Same invalidation the file watcher performs, so both paths stay in sync.
  skillChangeDetector.reloadNow()
  // ...plus the rendered system-prompt sections. session_guidance's text
  // depends on the skill list (whether any skill exists at all, and routing
  // hints keyed off specific skill names) but its cache key does not, so a
  // session that started with no skills would otherwise keep a prompt that
  // never mentions them.
  clearSystemPromptSectionCache()

  const after = fingerprintSkills(await getSkillDirCommands(cwd))

  let added = 0
  let changed = 0
  for (const [name, afterFingerprint] of after) {
    const beforeFingerprint = before.get(name)
    if (!beforeFingerprint) {
      added++
    } else if (beforeFingerprint !== afterFingerprint) {
      changed++
    }
  }
  let removed = 0
  for (const name of before.keys()) {
    if (!after.has(name)) removed++
  }

  const total = `${after.size} ${plural(after.size, 'skill')}`
  if (added === 0 && changed === 0 && removed === 0) {
    return { type: 'text', value: `Reloaded: ${total} · no changes on disk` }
  }
  return {
    type: 'text',
    value:
      `Reloaded: ${total} · +${added}/~${changed}/-${removed}` +
      '\nSkill changes are active in this session.',
  }
}

/** Name → identity of each skill, for the diff. */
function fingerprintSkills(commands: Command[]): Map<string, string> {
  return new Map(
    commands.map(command => [
      command.name,
      `${command.description}|${command.whenToUse ?? ''}|${command.version ?? ''}`,
    ]),
  )
}
