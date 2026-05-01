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
