// @ts-nocheck
import type { LocalCommandResult } from '../../types/command.js'

export async function call(): Promise<LocalCommandResult> {
  return {
    type: 'text',
    value: `The /agents wizard has been removed.

Ask Claude to create or update subagents for you (e.g. "create a code-reviewer subagent that ..."),
or edit the files directly:
  • .noa/agents/       (this project)
  • ~/.noa/agents/     (all projects)`,
  }
}
