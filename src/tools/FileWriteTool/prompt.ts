// @ts-nocheck
import { FILE_READ_TOOL_NAME } from '../FileReadTool/prompt.js'
import {
  allowsWriteWithoutPriorRead,
  shouldUseCompactSystemPrompt,
} from '../../constants/systemPromptCompact.js'

export const FILE_WRITE_TOOL_NAME = 'Write'
export const DESCRIPTION = 'Write a file to the local filesystem.'

function getPreReadInstruction(): string {
  return `\n- If this is an existing file, you MUST use the ${FILE_READ_TOOL_NAME} tool first to read the file's contents. This tool will fail if you did not read the file first.`
}

export function getWriteToolDescription(model?: string): string {
  const skipsPreRead = allowsWriteWithoutPriorRead(model)

  if (shouldUseCompactSystemPrompt(model)) {
    const preRead = skipsPreRead
      ? ''
      : ` Overwriting an existing file you haven't ${FILE_READ_TOOL_NAME} will fail.`
    return `Writes a file to the local filesystem, overwriting if one exists.

When to use: creating a new file, or fully replacing one you've already ${FILE_READ_TOOL_NAME}.${preRead} For partial changes, use Edit instead.`
  }

  return `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.${skipsPreRead ? '' : getPreReadInstruction()}
- Prefer the Edit tool for modifying existing files \u2014 it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`
}
