import {
  type Command,
  getCommandName,
  isCommandEnabled,
} from '../../types/command.js'

/** Cap on command names listed to the model in the fallback reminder. */
const MAX_LISTED_COMMANDS = 40

export type UnknownCommandFallbackAttachment = {
  type: 'unknown_command_fallback'
  commandName?: string
  suggestion?: string
  availableCommandNames: string[]
  availableCommandCount: number
}

/** Names safe to echo back to the model verbatim. */
function isPlainCommandName(name: string): boolean {
  return name.length <= 256 && /^[A-Za-z0-9_:.-]+$/.test(name)
}

/** Neutralizes tag openers so user text can't close the wrapping tags. */
export function escapeCommandText(text: string): string {
  return text.replace(/</g, '&lt;')
}

export function truncateCommandText(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Commands a user could have meant: visible and enabled. */
export function getSuggestableCommands(commands: Command[]): Command[] {
  return commands.filter(cmd => !cmd.isHidden && isCommandEnabled(cmd))
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = row
  }
  return prev[b.length]!
}

/** Closest command name or alias within `maxDistance` edits. */
export function findClosestCommandName(
  name: string,
  commands: Command[],
  maxDistance = 2,
): string | undefined {
  let best: string | undefined
  let bestDistance = maxDistance + 1
  for (const candidate of commands.flatMap(cmd => [
    getCommandName(cmd),
    ...(cmd.aliases ?? []),
  ])) {
    if (Math.abs(candidate.length - name.length) > maxDistance) continue
    const distance = editDistance(name, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best
}

/**
 * In non-interactive sessions an unknown command goes to the model as a plain
 * request, with this note so it neither pretends the command ran nor silently
 * ends the turn.
 */
export function createUnknownCommandFallback(
  commandName: string,
  suggestableCommands: Command[],
): UnknownCommandFallbackAttachment {
  const invocable = suggestableCommands.filter(
    cmd => cmd.type === 'prompt' && !cmd.disableModelInvocation,
  )
  const suggestion = findClosestCommandName(commandName, invocable)
  return {
    type: 'unknown_command_fallback',
    commandName: isPlainCommandName(commandName) ? commandName : undefined,
    suggestion:
      suggestion !== undefined && isPlainCommandName(suggestion)
        ? suggestion
        : undefined,
    availableCommandNames: invocable
      .map(getCommandName)
      .filter(isPlainCommandName)
      .slice(0, MAX_LISTED_COMMANDS),
    availableCommandCount: suggestableCommands.length,
  }
}

export function renderUnknownCommandFallback(
  attachment: UnknownCommandFallbackAttachment,
): string {
  const commandName =
    attachment.commandName !== undefined &&
    isPlainCommandName(attachment.commandName)
      ? attachment.commandName
      : undefined
  const listed = [...new Set(attachment.availableCommandNames)].filter(
    isPlainCommandName,
  )
  const suggestion =
    attachment.suggestion !== undefined &&
    isPlainCommandName(attachment.suggestion)
      ? attachment.suggestion
      : undefined
  const unlisted = Math.max(0, attachment.availableCommandCount - listed.length)
  const available =
    listed.length === 0
      ? unlisted > 0
        ? `This session has ${unlisted} slash ${unlisted === 1 ? 'command' : 'commands'}, but none can be named here.`
        : 'No slash commands are available in this session.'
      : `Slash commands available in this session: ${listed.map(name => `/${name}`).join(', ')}${unlisted > 0 ? `, and ${unlisted} more` : ''}.`

  return [
    commandName === undefined
      ? "The user's message starts with a slash command, but no command with that name is available in this session, so it did not run."
      : `The user's message starts with the slash command /${commandName}, but no command with that name is available in this session, so it did not run.`,
    suggestion === undefined
      ? undefined
      : `The closest available command is /${suggestion}. Ask the user before running it.`,
    available,
    'Treat the message as a plain request and do the task with the tools you have. If the task needs that command, tell the user it is not installed in this session. The user can add it as an organization plugin or a project skill. Do not give installation steps you are not sure of. Do not say the command ran.',
  ]
    .filter(line => line !== undefined)
    .join(' ')
}
