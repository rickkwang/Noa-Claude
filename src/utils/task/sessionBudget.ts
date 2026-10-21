/**
 * Session-wide budgets for runaway-loop protection, mirroring upstream
 * Claude Code's per-session caps:
 * - Subagent spawns (default 200) — hard failure when exceeded
 * - WebSearch tool calls (default 200) — soft failure (message to the model)
 *
 * Upstream keeps these counters on the taskRegistry object; noa's task
 * framework (utils/task/framework.ts) is a set of free functions with no
 * registry instance, so the counters live here at module scope. They are
 * per-process, which matches per-session for both the TUI and --print.
 * /clear resets both (see commands/clear/conversation.ts).
 */

import { getTotalCostUSD } from '../../bootstrap/state.js'

const DEFAULT_MAX_SUBAGENTS_PER_SESSION = 200
const DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH = 2
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

/**
 * Deepest Agent-tool nesting allowed: 1 = main thread may spawn subagents,
 * 2 = subagents may spawn one more level, and so on. Set to 0 to disable
 * Agent spawns entirely. The default of 2 is a local choice; upstream reads
 * its value from a remote flag that Noa does not fetch.
 */
export function getMaxSubagentSpawnDepth(): number {
  return (
    parseLimit(process.env.NOA_CLAUDE_MAX_SUBAGENT_SPAWN_DEPTH) ??
    parseLimit(process.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH) ??
    DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH
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
 * Cap on simultaneously RUNNING local subagents, foreground and background
 * (distinct from the cumulative spawn budget above). A running parent holds
 * its slot while waiting for descendants; exhausted capacity rejects a spawn
 * rather than queuing it. Backgrounding keeps the existing slot. Set to 0 to
 * disable the cap.
 */
export function getMaxConcurrentAgents(): number {
  return (
    parseLimit(process.env.NOA_CLAUDE_MAX_CONCURRENT_AGENTS) ??
    parseLimit(process.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS) ??
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

/**
 * The main loop checks --max-budget-usd only between its own messages, so a
 * background agent could otherwise keep starting agents after it is spent.
 */
export function assertBudgetAllowsAgentStart(maxBudgetUsd: number | undefined): void {
  if (maxBudgetUsd === undefined || getTotalCostUSD() < maxBudgetUsd) return
  throw new Error(`Budget limit reached ($${getTotalCostUSD().toFixed(2)} spent of the $${maxBudgetUsd} maximum). New agents cannot be started. Complete the remaining work directly with your tools, or wrap up with the results you already have.`)
}

/** Reset both budgets — called by /clear so a fresh session gets a fresh budget. */
export function resetSessionBudgets(): void {
  totalAgentSpawns = 0
  webSearchCalls = 0
}
