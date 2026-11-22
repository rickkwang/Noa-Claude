import { editDistance } from './processUserInput/unknownCommand.js'

export function formatToolNameForError(toolName: unknown): string {
  if (typeof toolName === 'string') {
    return toolName.length > 0 ? toolName : '<empty>'
  }
  try {
    return `<malformed ${typeof toolName}: ${String(toolName)}>`
  } catch {
    return `<malformed ${typeof toolName}>`
  }
}

/** Above this many tools, naming them all in an error is noise. */
const MAX_TOOLS_NAMED_IN_ERROR = 12

/** A one-letter-off guess for a very short name is more likely wrong than helpful. */
const MIN_NAME_LENGTH_FOR_SUGGESTION = 4
const MAX_SUGGESTION_DISTANCE = 2

/** Points a miscased or misspelled tool name at the tool the model likely meant. */
function suggestToolName(
  toolName: string,
  availableTools: readonly { name: string }[],
): string | undefined {
  const lower = toolName.toLowerCase()
  const caseMatches = availableTools.filter(t => t.name.toLowerCase() === lower)
  if (caseMatches.length === 1) {
    return `Tool names are case-sensitive: call ${caseMatches[0]!.name} instead.`
  }
  if (toolName.length < MIN_NAME_LENGTH_FOR_SUGGESTION) return undefined
  let best: string | undefined
  let bestDistance = MAX_SUGGESTION_DISTANCE + 1
  for (const { name } of availableTools) {
    if (Math.abs(name.length - toolName.length) > MAX_SUGGESTION_DISTANCE) {
      continue
    }
    const distance = editDistance(lower, name.toLowerCase())
    if (distance < bestDistance) {
      bestDistance = distance
      best = name
    }
  }
  return best === undefined ? undefined : `Did you mean ${best}?`
}

/**
 * Error for a tool call the session cannot run. A likely intended name is
 * suggested; otherwise a short tool list (--bare, a restricted agent) is named
 * so the model can pick a substitute at once.
 */
export function formatUnknownToolError(
  toolName: unknown,
  availableTools: readonly { name: string }[],
): string {
  const base = `Error: No such tool available: ${formatToolNameForError(toolName)}`
  const suggestion =
    typeof toolName === 'string'
      ? suggestToolName(toolName, availableTools)
      : undefined
  if (suggestion) return `${base}. ${suggestion}`
  if (
    availableTools.length === 0 ||
    availableTools.length > MAX_TOOLS_NAMED_IN_ERROR
  ) {
    return base
  }
  return `${base}. Tools available in this session: ${availableTools.map(t => t.name).join(', ')}.`
}
