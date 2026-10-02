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

/**
 * Error for a tool call the session cannot run. A short tool list (--bare,
 * a restricted agent) is named so the model can pick a substitute at once.
 */
export function formatUnknownToolError(
  toolName: unknown,
  availableTools: readonly { name: string }[],
): string {
  const base = `Error: No such tool available: ${formatToolNameForError(toolName)}`
  if (
    availableTools.length === 0 ||
    availableTools.length > MAX_TOOLS_NAMED_IN_ERROR
  ) {
    return base
  }
  return `${base}. Tools available in this session: ${availableTools.map(t => t.name).join(', ')}.`
}
