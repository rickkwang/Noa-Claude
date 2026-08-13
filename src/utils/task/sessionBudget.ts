/**
 * Session-wide budgets for runaway-loop protection, mirroring upstream
 * Claude Code 2.1.212's per-session caps:
 * - Subagent spawns (default 200) — hard failure when exceeded
 * - WebSearch tool calls (default 200) — soft failure (message to the model)
 *
 * Upstream keeps these counters on the taskRegistry object; noa's task
 * framework (utils/task/framework.ts) is a set of free functions with no
 * registry instance, so the counters live here at module scope. They are
 * per-process, which matches per-session for both the TUI and --print.
 * /clear resets both (see commands/clear/conversation.ts).
 */

const DEFAULT_MAX_SUBAGENTS_PER_SESSION = 200
const DEFAULT_MAX_WEB_SEARCHES_PER_SESSION = 200
const DEFAULT_MAX_CONCURRENT_AGENTS = 20

let totalAgentSpawns = 0
let webSearchCalls = 0

function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0) return undefined
  return parsed
}

export function getMaxSubagentsPerSession(): number {
  return (
    parseLimit(process.env.NOA_CLAUDE_MAX_SUBAGENTS_PER_SESSION) ??
    parseLimit(process.env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION) ??
    DEFAULT_MAX_SUBAGENTS_PER_SESSION
  )
}

export function getMaxWebSearchesPerSession(): number {
  return (
    parseLimit(process.env.NOA_CLAUDE_MAX_WEB_SEARCHES_PER_SESSION) ??
    parseLimit(process.env.CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION) ??
    DEFAULT_MAX_WEB_SEARCHES_PER_SESSION
  )
}

/**
 * Cap on simultaneously RUNNING background agents (distinct from the
 * cumulative spawn budget above — that one bounds total spawns, this one
 * bounds pile-up). Each running agent holds an API stream plus possibly MCP
 * connections, and there is no API-layer semaphore, so unbounded background
 * spawns translate directly into rate-limit pressure. Set to 0 to disable.
 */
export function getMaxConcurrentAgents(): number {
  return (
    parseLimit(process.env.NOA_CLAUDE_MAX_CONCURRENT_AGENTS) ??
    parseLimit(process.env.CLAUDE_CODE_MAX_CONCURRENT_AGENTS) ??
    DEFAULT_MAX_CONCURRENT_AGENTS
  )
}

export function getTotalAgentSpawns(): number {
  return totalAgentSpawns
}

export function incrementTotalAgentSpawns(): void {
  totalAgentSpawns++
}

export function decrementTotalAgentSpawns(): void {
  totalAgentSpawns = Math.max(0, totalAgentSpawns - 1)
}

export function getWebSearchCalls(): number {
  return webSearchCalls
}

export function incrementWebSearchCalls(): void {
  webSearchCalls++
}

/** Reset both budgets — called by /clear so a fresh session gets a fresh budget. */
export function resetSessionBudgets(): void {
  totalAgentSpawns = 0
  webSearchCalls = 0
}
