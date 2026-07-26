import { shouldUseCompactSystemPrompt } from '../../constants/systemPromptCompact.js'

export const GLOB_TOOL_NAME = 'Glob'

const LEAN_DESCRIPTION = `Fast file pattern matching. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time.`

export const DESCRIPTION = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead`

export function getDescription(model?: string): string {
  return shouldUseCompactSystemPrompt(model) ? LEAN_DESCRIPTION : DESCRIPTION
}
