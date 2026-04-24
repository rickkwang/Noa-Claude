# Operating Guide

Last updated: 2026-04-13

This document merges the runtime, session, worktree, agent, and progress-artifact notes into one operational guide.

## Runtime Health

The primary runtime inspection surfaces are `/status` and `/doctor`.

Runtime behavior switches are driven by environment variables:

- `NOA_CLAUDE_NO_FLICKER` controls the fullscreen anti-flicker REPL layout
- `NOA_CLAUDE_DISABLE_MOUSE` keeps fullscreen layout but skips mouse tracking
- `NOA_CLAUDE_DISABLE_MOUSE_CLICKS` keeps mouse tracking but ignores clicks and drags
- `CLAUDE_CODE_FORK_SUBAGENT=1` enables fork-subagent behavior on external builds (internal builds keep the default behavior)

### `/status`

Use `/status` to inspect current runtime state:

- CLI entry
- config directory and settings candidates
- backend mode and base URL
- worktree metadata
- MCP summary
- LSP state
- plugin state
- search tool state
- sandbox runtime compatibility
- running/pending agent visibility from `/agents`

### `/doctor`

Use `/doctor` when something is wrong or unclear.

It is intended to answer:

- is this installation healthy
- which layer is failing
- what action should the user take next

It is part of the Noa Claude runtime inspection surface and should be read as a local installation health check.

### MCP Healthcheck Degradation

`noa mcp list` keeps startup/list operations responsive when slow MCP servers are present:

- direct/project/user servers use `CLAUDE_AGENT_MCP_HEALTHCHECK_TIMEOUT_MS`
- plugin-like servers use `CLAUDE_AGENT_MCP_PLUGIN_HEALTHCHECK_TIMEOUT_MS`
- timed out servers are marked as `timeout(degraded, Nms)` instead of blocking the whole command

Important visibility rule:

- `/mcp` and `mcp list` show MCP servers, not total enabled plugins
- plugins that only provide skills/agents/hooks and no MCP server do not appear in MCP server lists

## Session Continuity

Long-running work depends on these paths staying aligned:

- `/compact`
- `--resume`
- transcript and session metadata persistence
- repo-local progress artifacts

The project-local progress artifact lives at:

- `.claude-agent/progress.md`

### Progress Artifacts

Use a project-local path inside the product namespace:

- `.claude-agent/progress.md`

Recommended structure:

```md
# Progress

## Objective
One sentence describing the current task.

## Done
- Completed item

## Remaining
- Next item

## Risks
- Current risk or open question

## Next Step
One concrete next action.
```

## Worktrees

Worktrees are the preferred isolation mechanism for parallel repository tasks.

The product should treat worktree context as first-class state:

- current worktree name
- worktree branch
- worktree path
- original cwd

## Agents

This product supports local subagents through `/agents`.

Agents can come from these scopes:

- built-in
- user settings
- project settings
- local settings
- plugin sources
- managed policy sources

The `/agents` UI resolves precedence for you.

## Auto-fix

File edits can automatically trigger lint and test commands via the auto-fix hook (configured in `settings.json` under `autoFix`).

When enabled, the following workflow executes after each file edit:

1. Collect modified files by tool (Bash, Edit, Write, Grep, Glob)
2. Run configured lint/test commands
3. On lint failure: present linter output with fix options
4. On test failure: pause for user decision to retry, skip, or abort

## Verification

Repository-level verification for these operational surfaces:

- `bun run check:runtime`
- `bun run smoke:engine`
- `bun run smoke:engine:live` when validating a real provider path

Live smoke prerequisites:

- `ANTHROPIC_API_KEY` must be configured
- optional `ANTHROPIC_BASE_URL` for non-default provider endpoints
- optional `CLAUDE_AGENT_SMOKE_LIVE_TIMEOUT_MS` to tune timeout

CI entrypoint:

- `.github/workflows/smoke-engineering-live.yml` (manual dispatch + weekly schedule)

## Failure-Mode Checklist

Use these as the first-line regression targets for agent/runtime changes:

- resume and continue after compaction
- interrupted turns and auto-resume
- MCP startup degradation and timeout fallback
- permission rejection and subsequent retry
- remote-session reconnect after stale or dropped transport
- tool execution ordering when concurrent read-only work is allowed

## Performance Baselines

Track these as release-gating regressions, not just ad hoc metrics:

- cold start time
- time to first token
- time to first tool availability
- resume latency from existing transcript
- non-interactive `--print` completion time

