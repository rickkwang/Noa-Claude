// Identifies which caller is driving a query() call. The query loop and
// stop-hook handling branch on the values listed explicitly below; everything
// else (forked side-queries like 'compact', 'goal_evaluator',
// 'prompt_suggestion', …) only flows through to analytics, so the union stays
// open via `(string & {})` rather than enumerating ~40 ad-hoc literals.
export type QuerySource =
  // Interactive REPL main thread. Output-style variants append a suffix —
  // gate with startsWith('repl_main_thread'), not equality.
  | 'repl_main_thread'
  | `repl_main_thread:${string}`
  // Agent SDK / headless -p driver.
  | 'sdk'
  // Subagent loops (AgentTool); suffix is the agent type.
  | `agent:${string}`
  // Forked compaction agents — the query loop must never block or
  // re-compact these (they exist to REDUCE the token count).
  | 'compact'
  | 'session_memory'
  // Any other forked side-query.
  | (string & {})
