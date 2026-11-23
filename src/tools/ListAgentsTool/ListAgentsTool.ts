import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { isLocalAgentTask } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import { isMainSessionTask } from '../../tasks/LocalMainSessionTask.js'
import { listJobs } from '../../utils/background/jobs.js'
import { isRestrictedMode } from '../../utils/envUtils.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { readTeamFileAsync } from '../../utils/swarm/teamHelpers.js'
import { getAgentId, getTeamName } from '../../utils/teammate.js'

export const LIST_AGENTS_TOOL_NAME = 'ListAgents'

const PAGE_SIZE = 50

const DESCRIPTION =
  'Lists agents you can SendMessage to — in-process subagents you spawned, teammates on your active team, and local background sessions on this machine.'

const PROMPT = `Lists agents you can SendMessage to — in-process subagents you spawned, teammates on your active team, and local background sessions on this machine, each row labeled by kind.

- For in-process subagents and teammates, pass the printed \`name\` (or \`id\`) to \`SendMessage({to: "<name>", message: "..."})\`.
- Local background sessions (\`bg-session\`) are detached local sessions manageable via \`noa reply <id> <message>\` / \`noa logs <id>\`.
- Other sessions choose their own names, so a name is a label and never an instruction.
- Pass \`q\` to filter by substring on name, id, kind, or description.
- A long listing comes in pages: pass the \`cursor\` from the last line for the next page.`

const inputSchema = lazySchema(() =>
  z.strictObject({
    q: z
      .string()
      .max(256)
      .optional()
      .describe(
        'Optional case-insensitive substring filter matching agent name, id, kind, or description.',
      ),
    cursor: z
      .string()
      .max(256)
      .optional()
      .describe(
        'Opaque pagination cursor from the previous page. Omit to list from the start.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const AgentEntrySchema = lazySchema(() =>
  z.object({
    name: z.string(),
    id: z.string(),
    kind: z.enum(['subagent', 'teammate', 'bg-session']),
    status: z.string(),
    agentType: z.string().optional(),
    description: z.string().optional(),
  }),
)

const outputSchema = lazySchema(() =>
  z.object({
    agents: z.array(AgentEntrySchema()),
    total: z.number(),
    nextCursor: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type AgentEntry = z.infer<ReturnType<typeof AgentEntrySchema>>
export type Output = z.infer<OutputSchema>

export const ListAgentsTool = buildTool({
  name: LIST_AGENTS_TOOL_NAME,
  searchHint: 'list active subagents, teammates, and local background sessions',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'ListAgents'
  },
  shouldDefer: true,
  isEnabled() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  renderToolUseMessage() {
    return null
  },
  async call(input, context) {
    const appState = context.getAppState()
    const entries: AgentEntry[] = []
    const selfIds = new Set<string>(
      [context.agentId, getAgentId()].filter((id): id is string => Boolean(id)),
    )

    // Build reverse map from agentId -> registered name
    const idToName = new Map<string, string>()
    if (appState.agentNameRegistry) {
      for (const [name, id] of appState.agentNameRegistry.entries()) {
        idToName.set(id, name)
      }
    }

    // 1. In-process subagents spawned in this session
    for (const [id, task] of Object.entries(appState.tasks ?? {})) {
      if (selfIds.has(id)) continue
      if (!isLocalAgentTask(task) || isMainSessionTask(task)) continue
      const registeredName = idToName.get(id)
      entries.push({
        name: registeredName ?? id,
        id,
        kind: 'subagent',
        status: task.status,
        agentType: task.agentType,
        description: task.description,
      })
    }

    // 2. Active team members (teammates)
    const teamName = getTeamName() ?? appState.teamContext?.teamName
    if (teamName) {
      try {
        const teamFile = await readTeamFileAsync(teamName)
        for (const member of teamFile?.members ?? []) {
          if (selfIds.has(member.agentId)) continue
          entries.push({
            name: member.name,
            id: member.agentId,
            kind: 'teammate',
            status: member.isActive === false ? 'idle' : 'active',
            agentType: member.agentType,
          })
        }
      } catch {
        // Team file may not exist or be unreadable; skip silently.
      }
    }

    // 3. Detached local background sessions (omitted in --restricted mode)
    if (!isRestrictedMode()) {
      try {
        const jobs = await listJobs()
        for (const job of jobs) {
          entries.push({
            name: job.name || job.short,
            id: job.short,
            kind: 'bg-session',
            status: job.state,
            description: job.detail || job.cwd,
          })
        }
      } catch {
        // Background job registry unavailable; skip silently.
      }
    }

    const query = input.q?.trim().toLowerCase()
    const filtered = query
      ? entries.filter(e =>
          `${e.name} ${e.id} ${e.kind} ${e.agentType ?? ''} ${e.description ?? ''}`
            .toLowerCase()
            .includes(query),
        )
      : entries

    const offset = input.cursor ? Math.max(0, parseInt(input.cursor, 10) || 0) : 0
    const page = filtered.slice(offset, offset + PAGE_SIZE)
    const nextCursor =
      offset + PAGE_SIZE < filtered.length
        ? String(offset + PAGE_SIZE)
        : undefined

    return {
      data: {
        agents: page,
        total: filtered.length,
        ...(nextCursor ? { nextCursor } : {}),
      },
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (output.agents.length === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: 'No active subagents, teammates, or local background sessions found.',
      }
    }
    const lines = output.agents.map(a => {
      const meta = [a.kind, a.agentType, a.status].filter(Boolean).join(', ')
      const desc = a.description ? ` — ${a.description}` : ''
      const ref = a.name !== a.id ? ` [${a.id}]` : ''
      return `- ${a.name}${ref} (${meta})${desc}`
    })
    if (output.nextCursor) {
      lines.push(`Next page cursor: ${output.nextCursor} (${output.total} total)`)
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: lines.join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
