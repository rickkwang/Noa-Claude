import { registerBundledSkill } from '../bundledSkills.js'

const FEWER_PERMISSION_PROMPTS_DESCRIPTION =
  'Scan your transcripts for common read-only Bash and MCP tool calls, then add a prioritized allowlist to project .noa/settings.json to reduce permission prompts.'

const FEWER_PERMISSION_PROMPTS_PROMPT = `# Fewer Permission Prompts

Reduce repetitive permission prompts by mining local session transcripts for safe, frequently used read-only Bash and MCP tool calls, then adding approved rules to the project's \`.noa/settings.json\` (or \`.noa/settings.local.json\` if the user prefers personal-only rules).

## Step 1: Locate Transcripts and Current Allowlist

1. Find session transcripts for this project under \`\${CLAUDE_CONFIG_DIR:-~/.noa}/projects/\` (JSONL files matching the current repo path).
2. Read the existing permission rules in \`.noa/settings.json\`, \`.noa/settings.local.json\`, and \`\${CLAUDE_CONFIG_DIR:-~/.noa}/settings.json\` so you do not suggest rules that are already allowed or explicitly denied.

## Step 2: Mine Frequent Read-Only Tool Calls

Scan recent transcripts (e.g. with a short read-only \`node\` / \`bun\` / \`python3 -I\` one-liner) for \`tool_use\` blocks:
- **Read-only Bash commands**: group by command prefix (e.g. \`git status\`, \`git diff\`, \`git log\`, \`bun test\`, \`npm test\`, \`rg\`, \`ls\`, \`tsc --noEmit\`, \`cargo check\`).
  - **Exclude** anything destructive, mutating, or arbitrary-code-executing: never suggest \`rm\`, \`git push\`, \`git reset\`, \`chmod\`, \`curl | sh\`, \`bash -c\`, \`node -e\`, \`python -c\`, or broad wildcards like \`Bash(*)\`.
- **Read-only MCP tools**: group by exact tool name (e.g. \`mcp__<server>__<read_tool>\`) for clearly read-only operations (\`get_*\`, \`list_*\`, \`search_*\`, \`read_*\`, \`query_*\`).
  - **Exclude** mutating MCP tools (\`create_*\`, \`update_*\`, \`delete_*\`, \`send_*\`, \`post_*\`, \`execute_*\`).

## Step 3: Present a Prioritized Allowlist and Apply Only Approved Rules

1. Rank candidate rules by observed frequency (highest first), showing:
   - Exact rule syntax (e.g. \`Bash(git log *)\`, \`Bash(bun test *)\`, \`mcp__docs__search\`)
   - Observed count across transcripts
   - Why it is safe / read-only
2. Ask the user which rules to add and whether to write to \`.noa/settings.json\` (shared with the repo) or \`.noa/settings.local.json\` (local-only).
3. Merge approved rules into \`permissions.allow\` without clobbering existing keys or formatting, then summarize what was added.
`

export function registerFewerPermissionPromptsSkill(): void {
  registerBundledSkill({
    name: 'fewer-permission-prompts',
    description: FEWER_PERMISSION_PROMPTS_DESCRIPTION,
    userInvocable: true,
    async getPromptForCommand(args: string) {
      const parts: string[] = [FEWER_PERMISSION_PROMPTS_PROMPT.trimEnd()]
      if (args.trim()) {
        parts.push(`## User Request\n\n${args.trim()}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
