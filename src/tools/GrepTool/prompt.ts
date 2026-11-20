// @ts-nocheck
import { AGENT_TOOL_NAME } from '../AgentTool/constants.js'
import { BASH_TOOL_NAME } from '../BashTool/toolName.js'
import { shouldUseCompactSystemPrompt } from '../../constants/systemPromptCompact.js'
import { isAgentSpawnRestricted } from '../../utils/auth.js'
import { getSubagentSteer } from '../../utils/subagentSteer.js'

export const GREP_TOOL_NAME = 'Grep'

export function getDescription(model?: string): string {
  if (shouldUseCompactSystemPrompt(model)) {
    return `Content search built on ripgrep. Prefer this over \`grep\`/\`rg\` via ${BASH_TOOL_NAME} — results integrate with the permission UI and file links.

- Full regex syntax (e.g. "log.*Error", "function\\s+\\w+"). Ripgrep, not grep — escape literal braces (\`interface\\{\\}\`).
- Filter with \`glob\` (e.g. "**/*.tsx") or \`type\` (e.g. "js", "py", "rust").
- \`output_mode\`: "content" (matching lines), "files_with_matches" (paths only, default), or "count".
- \`multiline: true\` for patterns that span lines.`
  }

  // Deliberately stricter than upstream, which gates this on the steer alone: under
  // isAgentSpawnRestricted the Agent tool says not to spawn unless asked, so no nudge toward it.
  const delegationHint =
    getSubagentSteer(model) === 'default' && !isAgentSpawnRestricted()
      ? `  - Use ${AGENT_TOOL_NAME} tool (if available) for open-ended searches requiring multiple rounds\n`
      : ''

  return `A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use ${GREP_TOOL_NAME} for search tasks. NEVER invoke \`grep\` or \`rg\` as a ${BASH_TOOL_NAME} command. The ${GREP_TOOL_NAME} tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
${delegationHint}  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use \`interface\\{\\}\` to find \`interface{}\` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like \`struct \\{[\\s\\S]*?field\`, use \`multiline: true\`
`
}
