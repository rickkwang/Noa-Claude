/**
 * JSON document piped to the user's `statusLine.command` on stdin.
 *
 * Field names and shapes are a public contract shared with scripts written
 * for Claude Code's status line — keep them compatible. The statusline-setup
 * agent prompt (tools/AgentTool/built-in/statuslineSetup.ts) documents this
 * shape for the model; update both together.
 */

export type StatusLineRateLimitWindow = {
  used_percentage: number
  /** Unix epoch seconds when this window resets */
  resets_at: number
}

export type StatusLineRepo = {
  host: string
  owner: string
  name: string
}

export type StatusLineVimMode = 'INSERT' | 'NORMAL' | 'VISUAL' | 'VISUAL LINE'

export type StatusLineCommandInput = {
  session_id: string
  session_name?: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
  model: {
    id: string
    display_name: string
  }
  workspace: {
    current_dir: string
    project_dir: string
    added_dirs: string[]
    /** Linked git worktree name when cwd is inside one */
    git_worktree?: string
    /** Repository identity parsed from the origin remote */
    repo?: StatusLineRepo
  }
  version: string
  output_style: {
    name: string
  }
  cost: {
    total_cost_usd: number
    total_duration_ms: number
    total_api_duration_ms: number
    total_lines_added: number
    total_lines_removed: number
  }
  context_window: {
    /** Input tokens currently in the context window (incl. cache reads/writes) */
    total_input_tokens: number
    /** Output tokens from the most recent API response */
    total_output_tokens: number
    context_window_size: number
    current_usage: {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens: number
      cache_read_input_tokens: number
    } | null
    used_percentage: number | null
    remaining_percentage: number | null
  }
  exceeds_200k_tokens: boolean
  fast_mode: boolean
  effort?: {
    level: string
  }
  thinking: {
    enabled: boolean
  }
  rate_limits?: {
    five_hour?: StatusLineRateLimitWindow
    seven_day?: StatusLineRateLimitWindow
  }
  vim?: {
    mode: StatusLineVimMode
  }
  agent?: {
    name: string
    type?: string
  }
  remote?: {
    session_id: string
  }
  pr?: {
    number: number
    url: string
    review_state: string
  }
  worktree?: {
    name: string
    path: string
    branch?: string
    original_cwd: string
    original_branch?: string
  }
}
