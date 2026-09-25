// @ts-nocheck
import { AGENT_TOOL_NAME } from '../AgentTool/constants.js'

export const DESCRIPTION = 'Send a message to another agent'

// Without agent teams the tool only continues subagents, so it gets its own
// prompt instead of the teammate one.
const SUBAGENT_ONLY_PROMPT = `
# SendMessage

Send a message to a subagent you spawned with ${AGENT_TOOL_NAME}, continuing it with its context intact.

\`\`\`json
{"to": "<agentId from the ${AGENT_TOOL_NAME} result>", "summary": "fix the failing test", "message": "the null check broke login; fix it and rerun the tests"}
\`\`\`

Address the agent by the \`agentId\` from its ${AGENT_TOOL_NAME} result. A running agent gets the message at its next tool round; a finished or stopped one resumes from its transcript in the background and notifies you when it finishes. An agent the user stopped is not resumed. Your plain text output is NOT visible to other agents — to reach one, you MUST call this tool.
`.trim()

export function getPrompt(agentTeamsEnabled: boolean): string {
  if (!agentTeamsEnabled) return SUBAGENT_ONLY_PROMPT
  return `
# SendMessage

Send a message to another agent.

\`\`\`json
{"to": "researcher", "summary": "assign task 1", "message": "start on task #1"}
\`\`\`

| \`to\` | |
|---|---|
| \`"researcher"\` | Teammate by name |
| \`"*"\` | Broadcast to all teammates — expensive (linear in team size), use only when everyone genuinely needs it |

Your plain text output is NOT visible to other agents — to communicate, you MUST call this tool. Messages from teammates are delivered automatically; you don't check an inbox. Refer to teammates by name, never by UUID. When relaying, don't quote the original — it's already rendered to the user.

## Protocol responses (legacy)

If you receive a JSON message with \`type: "shutdown_request"\` or \`type: "plan_approval_request"\`, respond with the matching \`_response\` type — echo the \`request_id\`, set \`approve\` true/false:

\`\`\`json
{"to": "team-lead", "message": {"type": "shutdown_response", "request_id": "...", "approve": true}}
{"to": "researcher", "message": {"type": "plan_approval_response", "request_id": "...", "approve": false, "feedback": "add error handling"}}
\`\`\`

Approving shutdown terminates your process. Rejecting plan sends the teammate back to revise. Don't originate \`shutdown_request\` unless asked. Don't send structured JSON status messages — use TaskUpdate.
`.trim()
}
