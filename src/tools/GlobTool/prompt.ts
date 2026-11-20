import { shouldUseCompactSystemPrompt } from '../../constants/systemPromptCompact.js'
import { isAgentSpawnRestricted } from '../../utils/auth.js'
import { getSubagentSteer } from '../../utils/subagentSteer.js'

export const GLOB_TOOL_NAME = 'Glob'

const LEAN_DESCRIPTION = `Fast file pattern matching. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time.`

const DESCRIPTION = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns`

export function getDescription(model?: string): string {
  if (shouldUseCompactSystemPrompt(model)) return LEAN_DESCRIPTION
  // Deliberately stricter than upstream, which gates this on the steer alone: under
  // isAgentSpawnRestricted the Agent tool says not to spawn unless asked, so no nudge toward it.
  if (getSubagentSteer(model) !== 'default' || isAgentSpawnRestricted()) {
    return DESCRIPTION
  }
  return `${DESCRIPTION}
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead (if available)`
}
